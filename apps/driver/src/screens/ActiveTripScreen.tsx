import React, { useEffect, useState } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity,
    Alert, Linking, Platform, Dimensions,
    Modal, TextInput, KeyboardAvoidingView, ScrollView,
    ActivityIndicator, Image,
} from 'react-native';
// AsyncStorage handled dynamically for web/adjutant compatibility
const getAsyncStorage = () => {
    try {
        return require('@react-native-async-storage/async-storage').default;
    } catch {
        return {
            getItem: async () => null,
            setItem: async () => {},
            removeItem: async () => {},
        };
    }
};
const AsyncStorage = getAsyncStorage();
import MapView, { Marker, Polyline, PROVIDER_DEFAULT, UrlTile } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import Reanimated, {
    useSharedValue, withSpring, withTiming, withRepeat, withSequence,
    useAnimatedStyle, interpolate, Easing,
} from 'react-native-reanimated';
import { supabase } from '../../../../shared/supabase';
import { ENV } from '../../../../shared/env';
import { useLocationTracking } from '../hooks/useLocationTracking';
import { updateRideStatus } from '../services/api';
import { Ionicons } from '@expo/vector-icons';
import { StopWaitHUD } from '../components/StopWaitHUD';

// Blueberry Luxe — Gold Edition (Driver)
const COLORS = {
    bgPrimary: '#0D0B1E',
    bgSecondary: '#1A1508',
    gradientStart: '#1A1200',
    gradientEnd: '#0D0B1E',
    purple: '#7B5CF0',
    purpleDark: '#5B3FD0',
    purpleLight: '#9B7CF0',
    gold: '#FFD700',
    goldDark: '#B8860B',
    goldLight: '#FFEC8B',
    amber: '#FFB000',
    amberSoft: 'rgba(255,176,0,0.1)',
    white: '#FFFFFF',
    textSecondary: 'rgba(255,255,255,0.6)',
    textMuted: 'rgba(255,255,255,0.4)',
    glassBg: 'rgba(255,255,255,0.06)',
    glassBorder: 'rgba(123,92,240,0.3)',
    success: '#00FF94',
    warning: '#F59E0B',
    error: '#EF4444',
};

const { height } = Dimensions.get('window');
const CARD_HEIGHT = 260;

const DRIVER_SHARE = 0.81;

const PHASES = ['En Route', 'Arrived', 'In Progress'];
function getPhaseIndex(status: string): number {
    if (status === 'assigned') return 0;
    if (status === 'arrived') return 1;
    if (status === 'in_progress') return 2;
    return 0;
}

function statusText(status: string): string {
    if (status === 'assigned') return 'En route to pickup';
    if (status === 'arrived') return 'Waiting for rider';
    if (status === 'in_progress') return 'Heading to destination';
    return '';
}

function decodePolyline(encoded: string) {
    if (!encoded) return [];
    let poly: { latitude: number; longitude: number }[] = [];
    let index = 0, len = encoded.length;
    let lat = 0, lng = 0;
    while (index < len) {
        let b, shift = 0, result = 0;
        do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
        let dlat = ((result & 1) ? ~(result >> 1) : (result >> 1)); lat += dlat;
        shift = 0; result = 0;
        do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
        let dlng = ((result & 1) ? ~(result >> 1) : (result >> 1)); lng += dlng;
        poly.push({ latitude: (lat / 1e5), longitude: (lng / 1e5) });
    }
    return poly;
}

export function ActiveTripScreen({ route, navigation }: any) {
    const { rideId } = route.params;
    const insets = useSafeAreaInsets();
    const { location, signalStatus } = useLocationTracking();

    const [ride, setRide] = useState<any>(null);
    const [rider, setRider] = useState<any>(null);
    const [routeCoords, setRouteCoords] = useState<any[]>([]);
    const [isSosLoading, setIsSosLoading] = useState(false);
    const [pinInput, setPinInput] = useState('');
    const [showPinModal, setShowPinModal] = useState(false);
    const [pinType, setPinType] = useState<'Rider' | 'Merchant' | 'Delivery'>('Rider');
    const [orderItems, setOrderItems] = useState<any[]>([]);
    const [stops, setStops] = useState<any[]>([]);
    const [isQuietRide, setIsQuietRide] = useState(false);
    const [hasMerchantPhoto, setHasMerchantPhoto] = useState(false);

    const cardY = useSharedValue(CARD_HEIGHT);
    const phaseWidth = useSharedValue(0);
    const statusOp = useSharedValue(1);
    const sosRing = useSharedValue(0);

    useEffect(() => {
        cardY.value = withSpring(0, { damping: 18, stiffness: 160 });
        sosRing.value = withRepeat(
            withSequence(
                withTiming(1, { duration: 1200, easing: Easing.out(Easing.cubic) }),
                withTiming(0, { duration: 400 })
            ),
            -1, false
        );
    }, []);

    useEffect(() => {
        if (!ride?.status) return;
        const idx = getPhaseIndex(ride?.status);
        phaseWidth.value = withSpring(idx / 2, { damping: 16, stiffness: 140 });
        statusOp.value = withSequence(
            withTiming(0, { duration: 200 }),
            withTiming(1, { duration: 250 })
        );
    }, [ride?.status]);

    useEffect(() => {
        const fetchData = async () => {
            const { data } = await supabase
                .from('rides')
                .select('*, rider:rider_id(id, raw_user_meta_data, name, phone_number)')
                .eq('id', rideId)
                .single();
            
            if (data) {
                setRide(data);
                setRider(data.rider);
                await AsyncStorage.setItem('active_ride_id', rideId); // Phase 11: Ensure BG knows we are active
                if (data.route_geometry) setRouteCoords(decodePolyline(data.route_geometry));

                if (data.order_id) {
                    const { data: items } = await supabase
                        .from('order_items')
                        .select('*')
                        .eq('order_id', data.order_id);
                    if (items) setOrderItems(items);

                    // Real-Time Trust Layer: Watch for intake photo
                    const { data: logs } = await supabase.from('merchant_intake_logs').select('photo_urls').eq('order_id', data.order_id).maybeSingle();
                    if (logs?.photo_urls?.length > 0) setHasMerchantPhoto(true);

                    supabase.channel(`intake_${data.order_id}`)
                        .on('postgres_changes', { event: '*', schema: 'public', table: 'merchant_intake_logs', filter: `order_id=eq.${data.order_id}` }, (p: any) => {
                            if (p.new.photo_urls?.length > 0) setHasMerchantPhoto(true);
                        })
                        .subscribe();
                }

                if (data.rider_id) {
                    const { data: aiPrefs } = await supabase
                        .from('rider_ai_preferences')
                        .select('quiet_ride')
                        .eq('user_id', data.rider_id)
                        .maybeSingle();
                    if (aiPrefs?.quiet_ride) setIsQuietRide(true);
                }
            }
        };

        fetchData();

        const sub = supabase.channel(`ride_${rideId}`)
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rides', filter: `id=eq.${rideId}` }, async (payload) => {
                setRide(payload.new);
                if (payload.new.status === 'cancelled') {
                    Alert.alert('Trip Cancelled', 'The rider cancelled the trip.');
                    await AsyncStorage.removeItem('active_ride_id');
                    navigation.reset({ index: 0, routes: [{ name: 'Dashboard' }] });
                }
            })
            .subscribe();

        const fetchStops = async () => {
            const { data: stopData } = await supabase
                .from('ride_stops')
                .select('*')
                .eq('ride_id', rideId)
                .order('stop_order', { ascending: true });
            if (stopData) setStops(stopData);
        };
        fetchStops();

        const subStops = supabase.channel(`stops_${rideId}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'ride_stops', filter: `ride_id=eq.${rideId}` }, () => {
                fetchStops();
            })
            .subscribe();

        const subEvents = supabase.channel(`ride_events_${rideId}`)
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ride_events', filter: `ride_id=eq.${rideId}` }, (payload) => {
                if (payload.new.event_type === 'stop_added') {
                    const stopName = payload.new.metadata?.place_name || 'New Stop';
                    Alert.alert('NEW STOP ADDED', `Rider added ${stopName} to the route. Rerouting...`);
                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                    
                    // Logic for real-time Mapbox reroute:
                    supabase.from('ride_stops')
                        .select('*')
                        .eq('ride_id', rideId)
                        .order('stop_order', { ascending: true })
                        .then(({ data }) => {
                            if (data) {
                                setStops(data);
                                fetchNewRoute(data);
                            }
                        });
                }
            })
            .subscribe();

        const beforeRemoveListener = navigation.addListener('beforeRemove', (e: any) => {
            // Allow navigation if the trip is completed or cancelled
            if (ride?.status === 'completed' || ride?.status === 'cancelled' || ride?.status === 'closed') {
                return;
            }

            e.preventDefault();
            Alert.alert(
                'Active Trip',
                'You are currently in an active trip. Please complete or cancel the trip through the official protocol before leaving this screen.',
                [{ text: 'Stay in Trip', style: 'cancel' }]
            );
        });

        return () => { 
            sub.unsubscribe();
            subStops.unsubscribe();
            subEvents.unsubscribe();
            beforeRemoveListener();
        };
    }, [rideId]);

    const fetchNewRoute = async (currentStops: any[]) => {
        if (!ride || !location) return;
        const coords = (location as any).coords;
        const waypoints = currentStops
            .filter(s => s.status === 'pending')
            .map(s => `${s.lng},${s.lat}`)
            .join(';');
        
        const dest = `${ride?.dropoff_lng || 0},${ride?.dropoff_lat || 0}`;
        const points = `${coords.longitude},${coords.latitude};${waypoints ? waypoints + ';' : ''}${dest}`;

        try {
            const resp = await fetch(`https://api.mapbox.com/directions/v5/mapbox/driving/${points}?geometries=polyline&access_token=${ENV.MAPBOX_PUBLIC_TOKEN}`);
            const json = await resp.json();
            if (json.routes && json.routes[0]) {
                const newCoords = decodePolyline(json.routes[0].geometry);
                setRouteCoords(newCoords);
                // Sync to DB so Rider/Admin also see the new path
                await supabase.from('rides').update({ route_geometry: json.routes[0].geometry }).eq('id', rideId);
            }
        } catch (err) {
            console.error("Reroute fetch failed:", err);
        }
    };

    const handleStatusChange = async (newStatus: string, pin?: string, entStatus?: string) => {
        // Use Edge Function for 'arrived' and 'in_progress' to enforce GPS/PIN validation
        if (newStatus === 'arrived' || newStatus === 'in_progress') {
            const lat = (location as any)?.coords?.latitude;
            const lng = (location as any)?.coords?.longitude;

            if (!lat || !lng) {
                Alert.alert('GPS Required', 'Location required to update status');
                return false;
            }

            const { error } = await updateRideStatus(rideId, newStatus, lat, lng, pin);

            if (error) {
                Alert.alert('Error', error.message || 'Failed to update status');
                return false;
            }

            // Optimistic update for entertainment status if provided
            const updatePayload: any = { status: newStatus };
            if (entStatus) updatePayload.entertainment_status = entStatus;
            if (newStatus === 'in_progress' && ride?.arrived_at) {
                const diffMs = Date.now() - new Date(ride?.arrived_at).getTime();
                const totalSeconds = Math.max(0, Math.floor(diffMs / 1000));
                updatePayload.pickup_wait_seconds = totalSeconds;
            }

            setRide((prev: any) => ({ ...prev, ...updatePayload }));
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            return true;
        }

        // For other status changes (entertainment, etc), use direct update
        const payload: any = {};
        if (entStatus) payload.entertainment_status = entStatus;

        if (Object.keys(payload).length === 0) {
            return true; // Nothing to update
        }

        const { error } = await supabase
            .from('rides')
            .update(payload)
            .eq('id', rideId);

        if (!error) {
            setRide((prev: any) => ({ ...prev, ...payload }));
            return true;
        } else {
            Alert.alert('Error', error.message);
            return false;
        }
    };

    const handleArrived = async () => { await handleStatusChange('arrived'); };

    const handleComplete = async () => {
        Alert.alert('Complete Trip', 'End this trip?', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Complete', onPress: async () => {
                const lat = (location as any)?.coords?.latitude;
                const lng = (location as any)?.coords?.longitude;
                if (!lat || !lng) {
                    Alert.alert('GPS Required');
                    return;
                }
                const { error } = await updateRideStatus(rideId, 'completed', lat, lng);
                if (error) Alert.alert('Error');
                else {
                    await AsyncStorage.removeItem('active_ride_id');
                    setRide((prev: any) => ({ ...prev, status: 'completed' }));
                }
            }}
        ]);
    };

    const handleCancel = () => {
        Alert.alert('Cancel Trip', 'Are you sure?', [
            { text: 'No', style: 'cancel' },
            { text: 'Yes', style: 'destructive', onPress: async () => {
                await AsyncStorage.removeItem('active_ride_id');
                await supabase.functions.invoke('cancel_ride', { body: { ride_id: rideId } });
                navigation.reset({ index: 0, routes: [{ name: 'Dashboard' }] });
            }}
        ]);
    };

    const handleSOS = async () => {
        Alert.alert('EMERGENCY', 'Trigger SOS?', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'TRIGGER SOS', style: 'destructive', onPress: async () => {
                setIsSosLoading(true);
                try {
                    await supabase.functions.invoke('trigger_emergency', { body: { ride_id: rideId } });
                    Alert.alert('SOS Triggered');
                } catch {
                    Alert.alert('Failed');
                } finally { setIsSosLoading(false); }
            }}
        ]);
    };

    const openNavigation = () => {
        if (!ride) return;
        const dest = ride?.status === 'assigned' ? `${ride?.pickup_lat},${ride?.pickup_lng}` : `${ride?.dropoff_lat},${ride?.dropoff_lng}`;
        
        Alert.alert('Navigation', 'Choose your navigation app', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Waze', onPress: () => {
                Linking.openURL(`waze://?ll=${dest}&navigate=yes`).catch(() => {
                    Alert.alert('Error', 'Waze is not installed.');
                });
            }},
            { text: 'Google / Apple Maps', onPress: () => {
                const url = Platform.select({ ios: `maps://app?daddr=${dest}`, android: `google.navigation:q=${dest}` });
                if (url) Linking.openURL(url);
            }}
        ]);
    };

    const currentLat = (location as any)?.coords?.latitude || ride?.pickup_lat || 0;
    const currentLng = (location as any)?.coords?.longitude || ride?.pickup_lng || 0;

    const cardStyle = useAnimatedStyle(() => ({ transform: [{ translateY: cardY.value }] }));
    const phaseBarStyle = useAnimatedStyle(() => ({ width: `${phaseWidth.value * 100}%` as any }));
    const statusBubbleStyle = useAnimatedStyle(() => ({ opacity: statusOp.value }));
    const sosRingStyle = useAnimatedStyle(() => ({
        opacity: interpolate(sosRing.value, [0, 1], [0, 0.7]),
        transform: [{ scale: interpolate(sosRing.value, [0, 1], [1, 1.8]) }]
    }));

    if (!ride) {
        return (
            <View style={{ flex: 1, backgroundColor: COLORS.bgPrimary, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
                <ActivityIndicator size="large" color={COLORS.gold} />
                <Text style={{ marginTop: 16, color: COLORS.textMuted, fontSize: 15 }}>Loading your trip...</Text>
            </View>
        );
    }

    if (ride?.status === 'completed' || ride?.status === 'closed') {
        const fare = ride?.total_fare_cents ? ride?.total_fare_cents / 100 : 0;
        const earnings = (fare * DRIVER_SHARE).toFixed(2);
        return (
            <View style={[s.root, { justifyContent: 'center', padding: 24 }]}>
                <LinearGradient 
                    colors={[COLORS.gold, COLORS.goldDark]} 
                    style={StyleSheet.absoluteFillObject}
                />
                <BlurView intensity={30} tint="dark" style={s.completedCardBlur}>
                    <View style={s.completedCardInner}>
                        <View style={s.successCircle}>
                            <Ionicons name="checkmark-circle" size={48} color={COLORS.success} />
                        </View>
                        <Text style={s.completedTitle}>Trip Completed!</Text>
                        <View style={s.earningsBlock}>
                            <Text style={s.earningsLabelSmall}>YOUR EARNINGS</Text>
                            <Text style={s.earningsValueLarge}>TTD ${earnings}</Text>
                        </View>
                        <TouchableOpacity style={s.dashBtn} onPress={() => navigation.reset({ index: 0, routes: [{ name: 'Dashboard' }] })}>
                            <LinearGradient
                                colors={[COLORS.gold, COLORS.goldDark]}
                                style={s.dashBtnGradient}
                                start={{ x: 0, y: 0 }}
                                end={{ x: 1, y: 1 }}
                            >
                                <Text style={s.dashBtnText}>Back to Dashboard</Text>
                            </LinearGradient>
                        </TouchableOpacity>
                    </View>
                </BlurView>
            </View>
        );
    }

    const riderName = rider?.name || rider?.raw_user_meta_data?.name || 'Rider';

    return (
        <View style={s.root}>
            {/* Deep Gradient Background */}
            <LinearGradient
                colors={[COLORS.gold, COLORS.goldDark]}
                style={StyleSheet.absoluteFillObject}
            />
            
            <MapView
                style={StyleSheet.absoluteFillObject} 
                provider={PROVIDER_DEFAULT}
                initialRegion={{ latitude: currentLat, longitude: currentLng, latitudeDelta: 0.05, longitudeDelta: 0.05 }}
            >
                <UrlTile urlTemplate={`https://api.mapbox.com/styles/v1/mapbox/dark-v11/tiles/256/{z}/{x}/{y}@2x?access_token=${ENV.MAPBOX_PUBLIC_TOKEN}`} shouldReplaceMapContent maximumZ={19} />
                <Marker coordinate={{ latitude: currentLat, longitude: currentLng }}>
                    <View style={s.driverMarker}>
                        <Ionicons name="car-sport" size={22} color={COLORS.gold} />
                    </View>
                </Marker>
                {ride && (
                    <Marker coordinate={{ 
                        latitude: ride?.status === 'assigned' ? ride?.pickup_lat || 0 : ride?.dropoff_lat || 0, 
                        longitude: ride?.status === 'assigned' ? ride?.pickup_lng || 0 : ride?.dropoff_lng || 0 
                    }}>
                        <View style={s.destMarker} />
                    </Marker>
                )}
                {routeCoords.length > 0 && <Polyline coordinates={routeCoords} strokeColor={COLORS.gold} strokeWidth={4} />}
            </MapView>

            {/* Status Bubble */}
            <Reanimated.View style={[s.statusBubble, { top: insets.top + 16 }, statusBubbleStyle]}>
                <BlurView intensity={20} tint="dark" style={s.statusBadge}>
                    <View style={[s.statusDot, { 
                        backgroundColor: ride?.status === 'assigned' ? COLORS.warning : COLORS.gold 
                    }]} />
                    <Text style={s.statusText}>{statusText(ride?.status || 'assigned').toUpperCase()}</Text>
                </BlurView>
                
                {/* Signal Health HUD */}
                <BlurView intensity={20} tint="dark" style={[s.signalChip, { 
                    marginTop: 8,
                    borderColor: signalStatus === 'lock' ? 'rgba(0,255,148,0.3)' : 
                                signalStatus === 'dead_reckoning' ? 'rgba(245,158,11,0.4)' : 'rgba(239,68,68,0.3)' 
                }]}>
                    <Ionicons 
                        name={signalStatus === 'lock' ? "radio-outline" : signalStatus === 'dead_reckoning' ? "pulse-outline" : "alert-circle-outline"} 
                        size={12} 
                        color={signalStatus === 'lock' ? COLORS.success : signalStatus === 'dead_reckoning' ? COLORS.warning : COLORS.error} 
                    />
                    <Text style={[s.signalText, { 
                        color: signalStatus === 'lock' ? COLORS.success : signalStatus === 'dead_reckoning' ? COLORS.warning : COLORS.error 
                    }]}>
                        {signalStatus === 'lock' ? 'GPS LOCK' : signalStatus === 'dead_reckoning' ? 'SIGNAL SURVIVAL' : 'NO SIGNAL'}
                    </Text>
                </BlurView>
            </Reanimated.View>

            {/* SOS Button */}
            <View style={[s.sosWrap, { top: insets.top + 12 }]}>
                <Reanimated.View style={[s.sosRing, sosRingStyle]} />
                <TouchableOpacity style={s.sosBtn} onPress={handleSOS}>
                    <Text style={s.sosText}>SOS</Text>
                </TouchableOpacity>
            </View>

            {/* Cancel Button */}
            <TouchableOpacity style={[s.cancelBtn, { top: insets.top + 12, left: 20 }]} onPress={handleCancel}>
                <Ionicons name="close" size={20} color={COLORS.textMuted} />
            </TouchableOpacity>

            {/* Bottom Card */}
            <Reanimated.View style={[s.cardOuter, cardStyle]}>
                <BlurView intensity={30} tint="dark" style={s.cardBlur}>
                    <View style={[s.cardInner, { paddingBottom: insets.bottom + 20 }]}>
                        {/* Phase Track */}
                        <View style={s.phaseTrackWrap}>
                            <View style={s.phaseTrackBg} />
                            <Reanimated.View style={[s.phaseTrackFill, phaseBarStyle]} />
                            <View style={s.phaseLabels}>
                                {PHASES.map((label, i) => {
                                    const active = i <= getPhaseIndex(ride?.status || 'assigned');
                                    return (
                                        <View key={label} style={s.phaseItem}>
                                            <View style={[s.phaseDot, { 
                                                backgroundColor: active ? COLORS.gold : COLORS.glassBg, 
                                                borderColor: active ? COLORS.gold : COLORS.glassBorder 
                                            }]} />
                                            <Text style={[s.phaseLabel, { 
                                                color: active ? COLORS.gold : COLORS.textMuted,
                                                fontWeight: active ? '800' : '500',
                                            }]}>{label.toUpperCase()}</Text>
                                        </View>
                                    );
                                })}
                            </View>
                        </View>

                    {ride?.status === 'arrived' && ride?.arrived_at && (
                        <IsolatedWaitHUD arrivedAt={ride?.arrived_at} type="PICKUP" />
                    )}

                    {stops.length > 0 && stops.map((stop) => (
                        (stop.status === 'arrived' || stop.status === 'completed') && (
                            <StopWaitHUD key={stop.id} stopId={stop.id} isActive={stop.status === 'arrived'} />
                        )
                    ))}

                    {orderItems.length > 0 && (
                        <View style={s.logisticsHud}>
                            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                                {orderItems.map((item, idx) => (
                                    <View key={idx} style={s.itemChip}>
                                        <Text style={s.itemChipText}>{item.product_name} x{item.quantity}</Text>
                                    </View>
                                ))}
                            </ScrollView>
                        </View>
                    )}

                    {isQuietRide && (
                        <View style={s.quietRideBanner}>
                            <Ionicons name="volume-mute" size={16} color={COLORS.gold} />
                            <Text style={s.quietRideText}>QUIET RIDE PREFERRED</Text>
                        </View>
                    )}

                    {ride?.entertainment_url && ride?.entertainment_status === 'pending' && (
                        <EntertainmentHUD 
                            url={ride?.entertainment_url}
                            onAccept={() => handleStatusChange(ride?.status, undefined, 'accepted')}
                            onReject={() => handleStatusChange(ride?.status, undefined, 'rejected')}
                        />
                    )}

                    <View style={s.riderRow}>
                        <View style={s.riderAvatar}>
                            <Text style={s.riderAvatarText}>{riderName.charAt(0).toUpperCase()}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                            <Text style={s.riderName}>{riderName}</Text>
                            <Text style={s.riderSubtext}>
                                ⭐ 5.0 · {ride?.payment_method === 'cash' ? 'CASH' : 'CARD'}
                            </Text>
                        </View>
                        <TouchableOpacity style={s.msgBtn} onPress={() => navigation.navigate('Chat', { rideId, rider })}>
                            <Ionicons name="chatbubble-outline" size={20} color="#FFF" />
                        </TouchableOpacity>
                    </View>

                    <View style={s.actionRow}>
                        <TouchableOpacity style={s.navBtn} onPress={openNavigation}>
                            <Ionicons name="navigate-outline" size={20} color={COLORS.gold} />
                        </TouchableOpacity>
                        
                        {ride?.status === 'assigned' && (
                            <TouchableOpacity style={[s.mainBtn, { backgroundColor: COLORS.success }]} onPress={handleArrived}>
                                <Text style={s.mainBtnText}>I'VE ARRIVED</Text>
                            </TouchableOpacity>
                        )}
                        {ride?.status === 'arrived' && (
                            <TouchableOpacity 
                                style={[s.mainBtn, { backgroundColor: (ride?.order_id && !hasMerchantPhoto) ? 'rgba(255,255,255,0.05)' : COLORS.gold }]} 
                                onPress={() => {
                                    if (ride?.order_id && !hasMerchantPhoto) {
                                        Alert.alert('PHOTO REQUIRED', 'Merchant must upload intake photo.');
                                        return;
                                    }
                                    setShowPinModal(true);
                                }}
                            >
                                <Text style={s.mainBtnText}>
                                    {(ride?.order_id && !hasMerchantPhoto) ? 'AWAITING PHOTO' : 'VERIFY & PICKUP'}
                                </Text>
                            </TouchableOpacity>
                        )}
                        {ride?.status === 'in_progress' && (
                            <TouchableOpacity style={[s.mainBtn, { backgroundColor: COLORS.warning }]} onPress={handleComplete}>
                                <Text style={s.mainBtnText}>COMPLETE TRIP</Text>
                            </TouchableOpacity>
                        )}
                    </View>
                    </View>
                </BlurView>
            </Reanimated.View>

            <Modal visible={showPinModal} transparent animationType="fade">
                <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={s.modalOverlay}>
                    <BlurView tint="dark" intensity={100} style={s.modalContent}>
                        <Text style={s.modalTitle}>ENTER VERIFICATION PIN</Text>
                        <TextInput style={s.pinInput} keyboardType="number-pad" maxLength={4} value={pinInput} onChangeText={setPinInput} placeholder="0000" placeholderTextColor="rgba(255,255,255,0.2)" autoFocus />
                        <View style={s.modalActions}>
                            <TouchableOpacity style={s.modalCancel} onPress={() => setShowPinModal(false)}>
                                <Text style={s.modalCancelText}>CANCEL</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={s.modalConfirm} onPress={async () => { if (await handleStatusChange('in_progress', pinInput)) setShowPinModal(false); }}>
                                <Text style={s.modalConfirmText}>VERIFY</Text>
                            </TouchableOpacity>
                        </View>
                    </BlurView>
                </KeyboardAvoidingView>
            </Modal>
        </View>
    );
}

function IsolatedWaitHUD({ arrivedAt, type = 'PICKUP' }: { arrivedAt: string; type?: 'PICKUP' | 'STOP' }) {
    const [seconds, setSeconds] = React.useState(0);
    useEffect(() => {
        const start = new Date(arrivedAt).getTime();
        const int = setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 1000);
        return () => clearInterval(int);
    }, [arrivedAt]);
    
    const graceLimit = type === 'PICKUP' ? 180 : 0;
    const isGrace = seconds < graceLimit;
    const billableSeconds = Math.max(0, seconds - graceLimit);
    const mins = Math.floor(seconds / 60);
    const fee = ((billableSeconds / 60) * 90) / 100;
    
    return (
        <View style={s.waitHud}>
            <View style={s.waitInfo}>
                <Text style={[s.waitLabel, { color: isGrace ? COLORS.gold : COLORS.warning }]}>
                    {type === 'PICKUP' ? (isGrace ? 'ARRIVAL GRACE' : 'PICKUP WAITING') : 'STOP WAITING'}
                </Text>
                <Text style={s.waitTimer}>
                    {mins}:{ (seconds % 60).toString().padStart(2, '0') }
                </Text>
            </View>
            <View style={[s.waitFeeBadge, isGrace && { backgroundColor: 'rgba(0,229,255,0.1)', borderColor: COLORS.gold, borderWidth: 1 }]}>
                <Text style={[s.waitFeeText, { color: isGrace ? COLORS.gold : COLORS.bgPrimary }]}>
                    {isGrace ? 'FREE' : `+$${fee.toFixed(2)}`}
                </Text>
            </View>
        </View>
    );
}

function EntertainmentHUD({ url, onAccept, onReject }: { url: string; onAccept: () => void; onReject: () => void }) {
    const isYoutube = url.includes('youtube.com') || url.includes('youtu.be');
    const isSpotify = url.includes('spotify.com');

    return (
        <View style={s.entertainmentCard}>
            <View style={{ flex: 1 }}>
                <Text style={s.entertainmentTitle}>🎵 RIDER SUGGESTION</Text>
                <Text style={s.entertainmentSubtitle} numberOfLines={1}>
                    {isYoutube ? 'YOUTUBE PLAYLIST' : isSpotify ? 'SPOTIFY MIX' : 'ENTERTAINMENT LINK'}
                </Text>
                <Text style={s.entertainmentUrl} numberOfLines={1}>{url}</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 10 }}>
                <TouchableOpacity style={[s.actionBtnSmall, { backgroundColor: 'rgba(239,68,68,0.1)' }]} onPress={onReject}>
                    <Ionicons name="close" size={18} color={COLORS.error} />
                </TouchableOpacity>
                <TouchableOpacity style={[s.actionBtnSmall, { backgroundColor: 'rgba(0,255,148,0.1)' }]} onPress={onAccept}>
                    <Ionicons name="checkmark" size={18} color={COLORS.success} />
                </TouchableOpacity>
            </View>
        </View>
    );
}


const s = StyleSheet.create({
    // Root
    root: { 
        flex: 1, 
        backgroundColor: COLORS.bgPrimary,
    },

    // Loading State
    loadingIndicator: {
        marginBottom: 20,
    },
    loadingText: {
        fontSize: 15,
        fontWeight: '500',
        color: COLORS.textMuted,
        marginTop: 16,
    },

    // Completed Trip State
    completedCardBlur: {
        borderRadius: 28,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: COLORS.glassBorder,
    },
    completedCardInner: {
        padding: 28,
        backgroundColor: 'rgba(22,11,50,0.6)',
        alignItems: 'center',
    },
    completedTitle: {
        fontSize: 22,
        fontWeight: '800',
        color: COLORS.white,
        textAlign: 'center',
        marginTop: 16,
    },
    earningsLabelSmall: {
        fontSize: 12,
        fontWeight: '800',
        color: COLORS.gold,
        letterSpacing: 1.5,
        marginBottom: 8,
    },
    earningsValueLarge: {
        fontSize: 42,
        fontWeight: '800',
        color: COLORS.gold,
        letterSpacing: -0.5,
    },
    dashBtn: {
        width: '100%',
        borderRadius: 16,
        overflow: 'hidden',
        marginTop: 24,
        shadowColor: COLORS.gold,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 4,
    },
    dashBtnGradient: {
        paddingVertical: 16,
        alignItems: 'center',
    },
    dashBtnText: {
        fontSize: 16,
        fontWeight: '800',
        color: COLORS.bgPrimary,
        letterSpacing: 0.5,
    },

    // Status Badge
    statusBubble: { 
        position: 'absolute', 
        alignSelf: 'center', 
        zIndex: 10, 
        alignItems: 'center',
    },
    statusBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 14,
        paddingVertical: 8,
        backgroundColor: 'rgba(22,11,50,0.9)',
        borderRadius: 20,
        borderWidth: 1,
        borderColor: COLORS.glassBorder,
    },
    statusDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
    },
    statusText: {
        fontSize: 12,
        fontWeight: '800',
        color: COLORS.white,
        letterSpacing: 1,
    },

    // Signal Chip
    signalChip: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'center',
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 12,
        borderWidth: 1,
        gap: 4,
    },
    signalText: {
        fontSize: 10,
        fontWeight: '800',
        letterSpacing: 0.5,
    },

    // SOS Button
    sosWrap: { 
        position: 'absolute', 
        right: 20, 
        zIndex: 10,
    },
    sosRing: { 
        position: 'absolute', 
        width: 56, 
        height: 56, 
        borderRadius: 16, 
        backgroundColor: COLORS.error,
    },
    sosBtn: { 
        width: 56, 
        height: 56, 
        borderRadius: 16, 
        backgroundColor: COLORS.error, 
        alignItems: 'center', 
        justifyContent: 'center',
        shadowColor: COLORS.error,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.4,
        shadowRadius: 8,
        elevation: 4,
    },
    sosText: {
        fontSize: 13,
        fontWeight: '800',
        color: COLORS.white,
        letterSpacing: 0.5,
    },

    // Cancel Button
    cancelBtn: { 
        position: 'absolute', 
        width: 40, 
        height: 40, 
        borderRadius: 14, 
        backgroundColor: 'rgba(22,11,50,0.8)', 
        alignItems: 'center', 
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: COLORS.glassBorder,
    },

    // Map Markers
    driverMarker: { 
        width: 40, 
        height: 40, 
        borderRadius: 14, 
        backgroundColor: COLORS.bgPrimary, 
        borderWidth: 2, 
        borderColor: COLORS.gold, 
        alignItems: 'center', 
        justifyContent: 'center',
        shadowColor: COLORS.gold,
        shadowOffset: { width: 0, height: 0 },
        shadowRadius: 8,
        shadowOpacity: 0.5,
    },
    destMarker: { 
        width: 14, 
        height: 14, 
        borderRadius: 4, 
        backgroundColor: COLORS.gold,
        shadowColor: COLORS.gold,
        shadowOffset: { width: 0, height: 0 },
        shadowRadius: 6,
        shadowOpacity: 0.5,
    },

    // Bottom Card
    cardOuter: { 
        position: 'absolute', 
        bottom: 0, 
        left: 0, 
        right: 0, 
        height: CARD_HEIGHT,
    },
    cardBlur: {
        borderTopLeftRadius: 32,
        borderTopRightRadius: 32,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: COLORS.glassBorder,
    },
    cardInner: { 
        flex: 1,
        backgroundColor: 'rgba(22,11,50,0.6)',
        padding: 20,
    },

    // Phase Track
    phaseTrackWrap: { 
        marginBottom: 16,
    },
    phaseTrackBg: { 
        height: 4, 
        backgroundColor: COLORS.glassBg, 
        borderRadius: 2,
    },
    phaseTrackFill: { 
        position: 'absolute', 
        height: 4, 
        backgroundColor: COLORS.gold, 
        borderRadius: 2,
    },
    phaseLabels: { 
        flexDirection: 'row', 
        justifyContent: 'space-between', 
        marginTop: 8,
    },
    phaseItem: { 
        alignItems: 'center',
    },
    phaseDot: { 
        width: 10, 
        height: 10, 
        borderRadius: 5, 
        borderWidth: 2,
    },
    phaseLabel: {
        fontSize: 10,
        letterSpacing: 0.5,
        marginTop: 4,
    },

    // Quiet Ride Banner
    quietRideBanner: { 
        flexDirection: 'row', 
        alignItems: 'center', 
        backgroundColor: 'rgba(0,229,255,0.08)', 
        borderRadius: 12, 
        padding: 10, 
        marginBottom: 12,
        borderWidth: 1,
        borderColor: 'rgba(0,229,255,0.15)',
        gap: 8,
    },
    quietRideText: {
        fontSize: 12,
        fontWeight: '800',
        color: COLORS.gold,
        letterSpacing: 0.5,
    },

    // Rider Info
    riderRow: { 
        flexDirection: 'row', 
        alignItems: 'center', 
        gap: 12, 
        marginBottom: 16,
    },
    riderAvatar: { 
        width: 44, 
        height: 44, 
        borderRadius: 14, 
        backgroundColor: 'rgba(0,229,255,0.1)', 
        alignItems: 'center', 
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: 'rgba(0,229,255,0.2)',
    },
    riderAvatarText: {
        fontSize: 20,
        fontWeight: '800',
        color: COLORS.gold,
    },
    riderName: {
        fontSize: 17,
        fontWeight: '800',
        color: COLORS.white,
        letterSpacing: -0.3,
    },
    riderSubtext: {
        fontSize: 13,
        fontWeight: '500',
        color: COLORS.textMuted,
        marginTop: 2,
    },
    msgBtn: { 
        width: 44, 
        height: 44, 
        borderRadius: 14, 
        backgroundColor: COLORS.glassBg, 
        alignItems: 'center', 
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: COLORS.glassBorder,
    },

    // Action Row
    actionRow: { 
        flexDirection: 'row', 
        gap: 12,
    },
    navBtn: { 
        width: 50, 
        height: 50, 
        borderRadius: 14, 
        backgroundColor: 'rgba(0,229,255,0.1)', 
        alignItems: 'center', 
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: 'rgba(0,229,255,0.2)',
    },
    mainBtn: { 
        flex: 1, 
        height: 50, 
        borderRadius: 14, 
        alignItems: 'center', 
        justifyContent: 'center',
        shadowColor: COLORS.gold,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 4,
    },
    mainBtnText: {
        fontSize: 15,
        fontWeight: '800',
        color: COLORS.bgPrimary,
        letterSpacing: 0.5,
    },

    // Logistics HUD
    logisticsHud: { 
        marginBottom: 12,
    },
    itemChip: { 
        backgroundColor: COLORS.glassBg, 
        paddingHorizontal: 12, 
        paddingVertical: 6, 
        borderRadius: 10, 
        marginRight: 8,
        borderWidth: 1,
        borderColor: COLORS.glassBorder,
    },
    itemChipText: {
        fontSize: 13,
        fontWeight: '700',
        color: COLORS.white,
    },

    // Entertainment Card
    entertainmentCard: {
        flexDirection: 'row', 
        alignItems: 'center',
        backgroundColor: 'rgba(0,229,255,0.05)',
        borderRadius: 16, 
        padding: 14, 
        marginBottom: 14,
        borderWidth: 1, 
        borderColor: 'rgba(0,229,255,0.15)',
    },
    entertainmentTitle: {
        fontSize: 11,
        fontWeight: '800',
        color: COLORS.gold,
        letterSpacing: 1.5,
    },
    entertainmentSubtitle: {
        fontSize: 15,
        fontWeight: '700',
        color: COLORS.white,
        marginTop: 4,
    },
    entertainmentUrl: {
        fontSize: 12,
        fontWeight: '500',
        color: COLORS.textMuted,
    },
    actionBtnSmall: {
        width: 44, 
        height: 44, 
        borderRadius: 14,
        alignItems: 'center', 
        justifyContent: 'center',
    },

    // Wait HUD
    waitHud: { 
        flexDirection: 'row', 
        justifyContent: 'space-between', 
        alignItems: 'center', 
        backgroundColor: 'rgba(245,158,11,0.08)', 
        padding: 12, 
        borderRadius: 16, 
        marginBottom: 14, 
        borderWidth: 1, 
        borderColor: 'rgba(245,158,11,0.2)',
    },
    waitInfo: { 
        flex: 1,
    },
    waitLabel: {
        fontSize: 11,
        fontWeight: '800',
        letterSpacing: 0.5,
        marginBottom: 2,
    },
    waitTimer: {
        fontSize: 24,
        fontWeight: '800',
        color: COLORS.white,
        letterSpacing: -0.5,
    },
    waitFeeBadge: { 
        paddingHorizontal: 12, 
        paddingVertical: 6, 
        borderRadius: 8,
    },
    waitFeeText: {
        fontSize: 12,
        fontWeight: '800',
    },

    // Modal
    modalOverlay: { 
        flex: 1, 
        backgroundColor: 'rgba(13,11,30,0.95)', 
        justifyContent: 'center', 
        padding: 20,
    },
    modalContent: { 
        padding: 28, 
        borderRadius: 28, 
        borderWidth: 1, 
        borderColor: COLORS.glassBorder, 
        overflow: 'hidden',
        backgroundColor: COLORS.bgSecondary,
    },
    modalTitle: {
        fontSize: 18,
        fontWeight: '800',
        color: COLORS.white,
        textAlign: 'center',
        marginBottom: 20,
    },
    pinInput: { 
        width: '100%', 
        height: 70, 
        fontSize: 42, 
        textAlign: 'center', 
        color: COLORS.gold, 
        marginVertical: 20, 
        letterSpacing: 12,
        fontFamily: Platform.OS === 'ios' ? 'Avenir Next' : 'sans-serif',
    },
    modalActions: { 
        flexDirection: 'row', 
        gap: 12, 
        width: '100%',
    },
    modalCancel: { 
        flex: 1, 
        height: 52, 
        borderRadius: 14, 
        alignItems: 'center', 
        justifyContent: 'center',
        backgroundColor: COLORS.glassBg,
        borderWidth: 1,
        borderColor: COLORS.glassBorder,
    },
    modalCancelText: {
        fontSize: 15,
        fontWeight: '700',
        color: COLORS.textMuted,
    },
    modalConfirm: { 
        flex: 1, 
        height: 52, 
        backgroundColor: COLORS.gold, 
        borderRadius: 14, 
        alignItems: 'center', 
        justifyContent: 'center',
        shadowColor: COLORS.gold,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 4,
    },
    modalConfirmText: {
        fontSize: 15,
        fontWeight: '800',
        color: COLORS.bgPrimary,
    },
    successCircle: { 
        width: 80, height: 80, borderRadius: 40,
        backgroundColor: 'rgba(0,200,81,0.15)',
        borderWidth: 2, borderColor: '#00C851',
        alignItems: 'center', justifyContent: 'center',
        alignSelf: 'center', marginBottom: 16
    },
    earningsBlock: {
        alignItems: 'center', paddingVertical: 16,
        paddingHorizontal: 24, borderRadius: 16,
        backgroundColor: 'rgba(255,255,255,0.06)',
        borderWidth: 1, borderColor: 'rgba(123,92,240,0.3)',
        marginTop: 1
    },
});




