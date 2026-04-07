import React, { useEffect, useState } from 'react';
import {
    View, StyleSheet, TouchableOpacity,
    Alert, Linking, Platform, Dimensions,
    Modal, TextInput, KeyboardAvoidingView, ScrollView,
    ActivityIndicator,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
import { Txt } from '../design-system/primitives';
import { GlassCard, BRAND, VOICES, RADIUS, SEMANTIC, GRADIENTS, StatusBadge } from '../design-system';
import { Ionicons } from '@expo/vector-icons';
import { StopWaitHUD } from '../components/StopWaitHUD';

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
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rides', filter: `id=eq.${rideId}` }, (payload) => {
                setRide(payload.new);
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

        return () => { 
            sub.unsubscribe();
            subStops.unsubscribe();
            subEvents.unsubscribe();
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

    const handleStatusChange = async (newStatus: string, _pin?: string, entStatus?: string) => {
        const payload: any = { status: newStatus };
        if (entStatus) payload.entertainment_status = entStatus;

        if (ride?.status === 'arrived' && newStatus === 'in_progress' && ride?.arrived_at) {
            const diffMs = Date.now() - new Date(ride?.arrived_at).getTime();
            const totalSeconds = Math.max(0, Math.floor(diffMs / 1000));
            // Record specifically for the pickup clock
            payload.pickup_wait_seconds = totalSeconds;
        }

        const { error } = await supabase
            .from('rides')
            .update(payload)
            .eq('id', rideId);

        if (!error) {
            setRide((prev: any) => ({ ...prev, ...payload }));
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
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
            <View style={{ flex: 1, backgroundColor: '#0A0718', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
                <ActivityIndicator size="large" color={BRAND.cyan} />
                <Txt variant="bodyReg" weight="regular" color={VOICES.driver.textMuted} style={{ marginTop: 16 }}>Loading your trip...</Txt>
            </View>
        );
    }

    if (ride?.status === 'completed' || ride?.status === 'closed') {
        const fare = ride?.total_fare_cents ? ride?.total_fare_cents / 100 : 0;
        const earnings = (fare * DRIVER_SHARE).toFixed(2);
        return (
            <View style={[s.root, { justifyContent: 'center', padding: 24 }]}>
                <LinearGradient colors={['#1A1530', '#0A0718', '#000000']} style={s.completedCard}>
                    <View style={s.successCircle}>
                        <Ionicons name="checkmark-circle" size={48} color={SEMANTIC.success} />
                    </View>
                    <Txt variant="headingL" weight="heavy" color="#FFF" style={{ textAlign: 'center' }}>Trip Completed!</Txt>
                    <View style={s.earningsBlock}>
                        <Txt variant="caption" weight="heavy" color={BRAND.cyan}>YOUR EARNINGS</Txt>
                        <Txt weight="heavy" color={BRAND.cyan} style={{ fontSize: 48 }}>TTD ${earnings}</Txt>
                    </View>
                    <TouchableOpacity style={s.dashBtn} onPress={() => navigation.reset({ index: 0, routes: [{ name: 'Dashboard' }] })}>
                        <Txt variant="bodyBold" weight="heavy" color="#0A0718">Back to Dashboard</Txt>
                    </TouchableOpacity>
                </LinearGradient>
            </View>
        );
    }

    const riderName = rider?.name || rider?.raw_user_meta_data?.name || 'Rider';

    return (
        <View style={s.root}>
            <MapView
                style={StyleSheet.absoluteFillObject} provider={PROVIDER_DEFAULT}
                initialRegion={{ latitude: currentLat, longitude: currentLng, latitudeDelta: 0.05, longitudeDelta: 0.05 }}
            >
                <UrlTile urlTemplate={`https://api.mapbox.com/styles/v1/mapbox/dark-v11/tiles/256/{z}/{x}/{y}@2x?access_token=${ENV.MAPBOX_PUBLIC_TOKEN}`} shouldReplaceMapContent maximumZ={19} />
                <Marker coordinate={{ latitude: currentLat, longitude: currentLng }}>
                    <View style={s.driverMarker}><Ionicons name="car-sport" size={22} color={BRAND.cyan} /></View>
                </Marker>
                {ride && (
                    <Marker coordinate={{ latitude: ride?.status === 'assigned' ? ride?.pickup_lat || 0 : ride?.dropoff_lat || 0, longitude: ride?.status === 'assigned' ? ride?.pickup_lng || 0 : ride?.dropoff_lng || 0 }}>
                        <View style={s.destMarker} />
                    </Marker>
                )}
                {routeCoords.length > 0 && <Polyline coordinates={routeCoords} strokeColor={BRAND.cyan} strokeWidth={4} />}
            </MapView>

            <Reanimated.View style={[s.statusBubble, { top: insets.top + 16 }, statusBubbleStyle]}>
                <StatusBadge 
                    status={ride?.status === 'assigned' ? 'searching' : 'live'} 
                    label={statusText(ride?.status || 'assigned').toUpperCase()} 
                />
                
                {/* Signal Health HUD (Phase 11) */}
                <View style={[s.signalChip, { 
                    marginTop: 8,
                    borderColor: signalStatus === 'lock' ? 'rgba(16,185,129,0.3)' : 
                                    signalStatus === 'dead_reckoning' ? 'rgba(245,158,11,0.4)' : 'rgba(239,68,68,0.3)' 
                }]}>
                    <Ionicons 
                        name={signalStatus === 'lock' ? "radio-outline" : signalStatus === 'dead_reckoning' ? "pulse-outline" : "alert-circle-outline"} 
                        size={12} 
                        color={signalStatus === 'lock' ? SEMANTIC.success : signalStatus === 'dead_reckoning' ? SEMANTIC.warning : SEMANTIC.danger} 
                    />
                    <Txt variant="caption" weight="heavy" color={signalStatus === 'lock' ? SEMANTIC.success : signalStatus === 'dead_reckoning' ? SEMANTIC.warning : SEMANTIC.danger} style={{ marginLeft: 4, fontSize: 10 }}>
                        {signalStatus === 'lock' ? 'GPS LOCK' : signalStatus === 'dead_reckoning' ? 'SIGNAL SURVIVAL' : 'NO SIGNAL'}
                    </Txt>
                </View>
            </Reanimated.View>

            <View style={[s.sosWrap, { top: insets.top + 12 }]}>
                <Reanimated.View style={[s.sosRing, sosRingStyle]} />
                <TouchableOpacity style={s.sosBtn} onPress={handleSOS}>
                    <Txt variant="bodyBold" weight="heavy" color="#FFF">SOS</Txt>
                </TouchableOpacity>
            </View>

            <TouchableOpacity style={[s.cancelBtn, { top: insets.top + 12, left: 20 }]} onPress={handleCancel}>
                <Ionicons name="close" size={20} color={VOICES.driver.textMuted} />
            </TouchableOpacity>

            <Reanimated.View style={[s.cardOuter, cardStyle]}>
                <GlassCard variant="driver" style={StyleSheet.flatten([s.cardInner, { paddingBottom: insets.bottom + 20 }])}>
                    <View style={s.phaseTrackWrap}>
                        <View style={s.phaseTrackBg} />
                        <Reanimated.View style={[s.phaseTrackFill, phaseBarStyle]} />
                        <View style={s.phaseLabels}>
                            {PHASES.map((label, i) => {
                                const active = i <= getPhaseIndex(ride?.status || 'assigned');
                                return (
                                    <View key={label} style={s.phaseItem}>
                                        <View style={[s.phaseDot, { backgroundColor: active ? BRAND.cyan : 'rgba(255,255,255,0.05)', borderColor: active ? BRAND.cyan : 'rgba(255,255,255,0.1)' }]} />
                                        <Txt variant="caption" weight={active ? "heavy" : "regular"} color={active ? BRAND.cyan : VOICES.driver.textMuted} style={{ marginTop: 5 }}>{label.toUpperCase()}</Txt>
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
                                        <Txt variant="caption" weight="heavy" color="#FFF">{item.product_name} x{item.quantity}</Txt>
                                    </View>
                                ))}
                            </ScrollView>
                        </View>
                    )}

                    {isQuietRide && (
                        <View style={s.quietRideBanner}>
                            <Ionicons name="volume-mute" size={16} color={BRAND.cyan} />
                            <Txt variant="caption" weight="heavy" color={BRAND.cyan} style={{ marginLeft: 8 }}>QUIET RIDE PREFERRED</Txt>
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
                            <Txt variant="headingM" weight="heavy" color={BRAND.cyan}>{riderName.charAt(0).toUpperCase()}</Txt>
                        </View>
                        <View style={{ flex: 1 }}>
                            <Txt variant="bodyBold" weight="heavy" color="#FFF">{riderName}</Txt>
                            <Txt variant="caption" weight="regular" color={VOICES.driver.textMuted}>
                                ⭐ 5.0 · {ride?.payment_method === 'cash' ? 'CASH' : 'CARD'}
                            </Txt>
                        </View>
                        <TouchableOpacity style={s.msgBtn} onPress={() => navigation.navigate('Chat', { rideId, rider })}>
                            <Ionicons name="chatbubble-outline" size={20} color="#FFF" />
                        </TouchableOpacity>
                    </View>

                    <View style={s.actionRow}>
                        <TouchableOpacity style={s.navBtn} onPress={openNavigation}>
                            <Ionicons name="navigate-outline" size={20} color={BRAND.cyan} />
                        </TouchableOpacity>
                        
                        {ride?.status === 'assigned' && (
                            <TouchableOpacity style={[s.mainBtn, { backgroundColor: SEMANTIC.success }]} onPress={handleArrived}>
                                <Txt variant="bodyBold" weight="heavy" color="#0A0718">I'VE ARRIVED</Txt>
                            </TouchableOpacity>
                        )}
                        {ride?.status === 'arrived' && (
                            <TouchableOpacity 
                                style={[s.mainBtn, { backgroundColor: (ride?.order_id && !hasMerchantPhoto) ? 'rgba(255,255,255,0.05)' : BRAND.cyan }]} 
                                onPress={() => {
                                    if (ride?.order_id && !hasMerchantPhoto) {
                                        Alert.alert('PHOTO REQUIRED', 'Merchant must upload intake photo.');
                                        return;
                                    }
                                    setShowPinModal(true);
                                }}
                            >
                                <Txt variant="bodyBold" weight="heavy" color="#0A0718">
                                    {(ride?.order_id && !hasMerchantPhoto) ? 'AWAITING PHOTO' : 'VERIFY & PICKUP'}
                                </Txt>
                            </TouchableOpacity>
                        )}
                        {ride?.status === 'in_progress' && (
                            <TouchableOpacity style={[s.mainBtn, { backgroundColor: SEMANTIC.warning }]} onPress={handleComplete}>
                                <Txt variant="bodyBold" weight="heavy" color="#0A0718">COMPLETE TRIP</Txt>
                            </TouchableOpacity>
                        )}
                    </View>
                </GlassCard>
            </Reanimated.View>

            <Modal visible={showPinModal} transparent animationType="fade">
                <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={s.modalOverlay}>
                    <BlurView tint="dark" intensity={100} style={s.modalContent}>
                        <Txt variant="headingM" weight="heavy" color="#FFF">ENTER VERIFICATION PIN</Txt>
                        <TextInput style={s.pinInput} keyboardType="number-pad" maxLength={4} value={pinInput} onChangeText={setPinInput} placeholder="0000" placeholderTextColor="rgba(255,255,255,0.1)" autoFocus />
                        <View style={s.modalActions}>
                            <TouchableOpacity style={s.modalCancel} onPress={() => setShowPinModal(false)}>
                                <Txt variant="bodyBold" weight="heavy" color={VOICES.driver.textMuted}>CANCEL</Txt>
                            </TouchableOpacity>
                            <TouchableOpacity style={s.modalConfirm} onPress={async () => { if (await handleStatusChange('in_progress', pinInput)) setShowPinModal(false); }}>
                                <Txt variant="bodyBold" weight="heavy" color="#0A0718">VERIFY</Txt>
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
                <Txt variant="caption" weight="heavy" color={isGrace ? BRAND.cyan : SEMANTIC.warning}>
                    {type === 'PICKUP' ? (isGrace ? 'ARRIVAL GRACE' : 'PICKUP WAITING') : 'STOP WAITING'}
                </Txt>
                <Txt weight="heavy" color="#FFF" style={{ fontSize: 24 }}>
                    {mins}:{ (seconds % 60).toString().padStart(2, '0') }
                </Txt>
            </View>
            <View style={[s.waitFeeBadge, isGrace && { backgroundColor: 'rgba(0,255,194,0.1)', borderColor: BRAND.cyan, borderWidth: 1 }]}>
                <Txt variant="caption" weight="heavy" color={isGrace ? BRAND.cyan : '#0A0718'}>
                    {isGrace ? 'FREE' : `+$${fee.toFixed(2)}`}
                </Txt>
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
                <Txt variant="caption" weight="heavy" color={BRAND.cyan} style={{ letterSpacing: 1.5 }}>
                    🎵 RIDER SUGGESTION
                </Txt>
                <Txt variant="bodyBold" weight="heavy" color="#FFF" numberOfLines={1} style={{ marginTop: 4 }}>
                    {isYoutube ? 'YOUTUBE PLAYLIST' : isSpotify ? 'SPOTIFY MIX' : 'ENTERTAINMENT LINK'}
                </Txt>
                <Txt variant="caption" weight="regular" color={VOICES.driver.textMuted} numberOfLines={1}>{url}</Txt>
            </View>
            <View style={{ flexDirection: 'row', gap: 10 }}>
                <TouchableOpacity style={[s.actionBtnSmall, { backgroundColor: 'rgba(239,68,68,0.1)' }]} onPress={onReject}>
                    <Ionicons name="close" size={18} color={SEMANTIC.danger} />
                </TouchableOpacity>
                <TouchableOpacity style={[s.actionBtnSmall, { backgroundColor: 'rgba(16,185,129,0.1)' }]} onPress={onAccept}>
                    <Ionicons name="checkmark" size={18} color={SEMANTIC.success} />
                </TouchableOpacity>
            </View>
        </View>
    );
}


const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: '#0A0718' },
    signalChip: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'center',
        backgroundColor: 'rgba(5,5,10,0.85)',
        paddingHorizontal: 12,
        paddingVertical: 4,
        borderRadius: 12,
        borderWidth: 1,
    },
    quietRideBanner: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,255,194,0.1)', borderRadius: 12, padding: 10, marginBottom: 12 },
    statusBubble: { position: 'absolute', alignSelf: 'center', zIndex: 10, alignItems: 'center' },
    sosWrap: { position: 'absolute', right: 20, zIndex: 10 },
    sosRing: { position: 'absolute', width: 60, height: 60, borderRadius: 30, backgroundColor: SEMANTIC.danger },
    sosBtn: { width: 60, height: 60, borderRadius: 30, backgroundColor: SEMANTIC.danger, alignItems: 'center', justifyContent: 'center' },
    cancelBtn: { position: 'absolute', width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
    driverMarker: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#0A0718', borderWidth: 2, borderColor: BRAND.cyan, alignItems: 'center', justifyContent: 'center' },
    destMarker: { width: 12, height: 12, borderRadius: 3, backgroundColor: BRAND.cyan },
    cardOuter: { position: 'absolute', bottom: 0, left: 0, right: 0, height: CARD_HEIGHT },
    cardInner: { flex: 1 },
    phaseTrackWrap: { marginBottom: 16 },
    phaseTrackBg: { height: 4, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 2 },
    phaseTrackFill: { position: 'absolute', height: 4, backgroundColor: BRAND.cyan, borderRadius: 2 },
    phaseLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
    phaseItem: { alignItems: 'center' },
    phaseDot: { width: 10, height: 10, borderRadius: 5, borderWidth: 2 },
    riderRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
    riderAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,255,194,0.1)', alignItems: 'center', justifyContent: 'center' },
    msgBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' },
    actionRow: { flexDirection: 'row', gap: 12 },
    navBtn: { width: 50, height: 50, borderRadius: 25, backgroundColor: 'rgba(0,255,194,0.1)', alignItems: 'center', justifyContent: 'center' },
    mainBtn: { flex: 1, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center' },
    completedCard: { borderRadius: 24, padding: 24, alignItems: 'center' },
    successCircle: { width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(16,185,129,0.1)', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
    earningsBlock: { alignItems: 'center', marginVertical: 20 },
    dashBtn: { width: '100%', height: 56, backgroundColor: BRAND.cyan, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
    waitHud: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'rgba(245,158,11,0.05)', padding: 12, borderRadius: 16, marginBottom: 14, borderWidth: 1, borderColor: 'rgba(245,158,11,0.1)' },
    waitInfo: { flex: 1 },
    waitFeeBadge: { backgroundColor: SEMANTIC.warning, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
    logisticsHud: { marginBottom: 12 },
    itemChip: { backgroundColor: 'rgba(255,255,255,0.05)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, marginRight: 8 },
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center', padding: 20 },
    modalContent: { padding: 32, borderRadius: 32, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', overflow: 'hidden' },
    pinInput: { width: '100%', height: 80, fontSize: 48, textAlign: 'center', color: BRAND.cyan, marginVertical: 24, letterSpacing: 10, fontFamily: Platform.OS === 'ios' ? 'Avenir Next' : 'sans-serif' },
    modalActions: { flexDirection: 'row', gap: 12, width: '100%' },
    modalCancel: { flex: 1, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
    modalConfirm: { flex: 1, height: 56, backgroundColor: BRAND.cyan, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
    entertainmentCard: {
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: 'rgba(0,255,194,0.05)',
        borderRadius: 16, padding: 14, marginBottom: 14,
        borderWidth: 1, borderColor: 'rgba(0,255,194,0.1)',
    },
    actionBtnSmall: {
        width: 44, height: 44, borderRadius: 22,
        alignItems: 'center', justifyContent: 'center',
    },
});
