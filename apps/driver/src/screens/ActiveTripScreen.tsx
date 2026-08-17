import React, { useEffect, useState } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity,
    Alert, Linking, Platform,
    Modal, TextInput, KeyboardAvoidingView, ScrollView,
    ActivityIndicator, Image,
} from 'react-native';
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
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { supabase } from '@gtaxi/core';
import { ENV } from '@g868/shared/env';
import { useLocationTracking } from '../hooks/useLocationTracking';
import { updateRideStatus } from '../services/api';
import { Ionicons } from '@expo/vector-icons';
import { VOICES } from '@gtaxi/design-system';
import { LiquidGlass } from '@gtaxi/design-system/native';
import { ghostBorder, elevationGlow } from '@gtaxi/design-system/utils/style-rules';
import { NavigationAndStatusControl } from '../components/NavigationAndStatusControl';

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
    const [cashConfirmed, setCashConfirmed] = useState(false);
    const [cashConfirming, setCashConfirming] = useState(false);
    const [safeMarked, setSafeMarked] = useState(false);
    const [safeMarking, setSafeMarking] = useState(false);

    let intakeCh: any = null;

    useEffect(() => {
        const fetchData = async () => {
            const { data } = await supabase
                .from('rides')
                .select('*, rider:rider_id(id, raw_user_meta_data, full_name, phone_number)')
                .eq('id', rideId)
                .single();

            if (data) {
                setRide(data);
                setRider(data.rider);
                await AsyncStorage.setItem('active_ride_id', rideId);
                if (data.route_geometry) setRouteCoords(decodePolyline(data.route_geometry));

                const { data: order } = await supabase
                    .from('orders')
                    .select('id')
                    .eq('ride_id', rideId)
                    .maybeSingle();
                if (order) {
                    (data as any).order_id = order.id;
                }

                if (data.order_id) {
                    const { data: items } = await supabase
                        .from('order_items')
                        .select('*')
                        .eq('order_id', data.order_id);
                    if (items) setOrderItems(items);

                    const { data: logs } = await supabase.from('merchant_intake_logs').select('photo_urls').eq('order_id', data.order_id).maybeSingle();
                    if (logs?.photo_urls?.length > 0) setHasMerchantPhoto(true);

                    intakeCh = supabase.channel(`intake_${data.order_id}`)
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
            .on('postgres_changes', { event: '*', schema: 'public', table: 'ride_stops', filter: `ride_id=eq.${rideId}` }, () => { fetchStops(); })
            .subscribe();

        const subEvents = supabase.channel(`ride_events_${rideId}`)
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ride_events', filter: `ride_id=eq.${rideId}` }, (payload) => {
                if (payload.new.event_type === 'stop_added') {
                    const stopName = payload.new.metadata?.place_name || 'New Stop';
                    Alert.alert('NEW STOP ADDED', `Rider added ${stopName} to the route. Rerouting...`);
                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                    (async () => {
                            const { data } = await supabase.from('ride_stops')
                                .select('*')
                                .eq('ride_id', rideId)
                                .order('stop_order', { ascending: true });
                            if (data) { setStops(data); fetchNewRoute(data); }
                        })().catch((err) => console.error('ride_stops fetch failed:', err));
                }
            })
            .subscribe();

        const beforeRemoveListener = navigation.addListener('beforeRemove', (e: any) => {
            if (ride?.status === 'completed' || ride?.status === 'cancelled' || ride?.status === 'closed') return;
            e.preventDefault();
            Alert.alert('Active Trip', 'You are currently in an active trip. Please complete or cancel the trip through the official protocol before leaving this screen.', [{ text: 'Stay in Trip', style: 'cancel' }]);
        });

        return () => {
            sub.unsubscribe();
            subStops.unsubscribe();
            subEvents.unsubscribe();
            if (intakeCh) intakeCh.unsubscribe();
            beforeRemoveListener();
        };
    }, [rideId]);

    useEffect(() => {
        const orderId = ride?.order_id;
        if (!orderId) return;

        (async () => {
            const { data } = await supabase.from('orders').select('status').eq('id', orderId).single();
            if (data?.status === 'ready_for_pickup') {
                Alert.alert('PACKAGE READY', 'Merchant confirmed the order is ready for pickup.');
            }
        })().catch((err) => console.error('order status check failed:', err));

        const orderCh = supabase
            .channel(`order_sync_${orderId}`)
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${orderId}` }, (payload: any) => {
                if (payload.new?.status === 'ready_for_pickup') {
                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                    Alert.alert('PACKAGE READY', 'Merchant confirmed the order is ready for pickup.');
                }
            })
            .subscribe();

        return () => { orderCh.unsubscribe(); };
    }, [ride?.order_id]);

    const fetchNewRoute = async (currentStops: any[]) => {
        if (!ride || !location) return;
        const coords = (location as any).coords;
        const waypoints = currentStops.filter(s => s.status === 'pending').map(s => `${s.lng},${s.lat}`).join(';');
        const dest = `${ride?.dropoff_lng || 0},${ride?.dropoff_lat || 0}`;
        const points = `${coords.longitude},${coords.latitude};${waypoints ? waypoints + ';' : ''}${dest}`;

        try {
            const resp = await fetch(`https://api.mapbox.com/directions/v5/mapbox/driving/${points}?geometries=polyline&access_token=${ENV.MAPBOX_PUBLIC_TOKEN}`);
            const json = await resp.json();
            if (json.routes && json.routes[0]) {
                const newCoords = decodePolyline(json.routes[0].geometry);
                setRouteCoords(newCoords);
                await supabase.functions.invoke('update_ride_status', { body: { ride_id: rideId, route_geometry: json.routes[0].geometry } });
            }
        } catch (err) {
            console.error("Reroute fetch failed:", err);
            Alert.alert('Map Error', 'Could not reroute. Check your connection.');
        }
    };

    const handleStatusChange = async (newStatus: string, pin?: string, entStatus?: string) => {
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

        const payload: any = {};
        if (entStatus) payload.entertainment_status = entStatus;

        if (Object.keys(payload).length === 0) return true;

        const { error } = await supabase.functions.invoke('update_ride_status', { body: { ride_id: rideId, ...payload } });

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
                if (!lat || !lng) { Alert.alert('GPS Required'); return; }
                const { data, error } = await updateRideStatus(rideId, 'completed', lat, lng);
                if (error) Alert.alert('Error');
                else if (data) {
                    await AsyncStorage.removeItem('active_ride_id');
                    setRide((prev: any) => ({
                        ...prev,
                        status: 'completed',
                        driver_payout_cents: data.driver_payout_cents ?? prev.driver_payout_cents,
                        total_fare_cents: data.total_fare_cents ?? prev.total_fare_cents,
                    }));
                }
            }}
        ]);
    };

    const handleDeliveryConfirmPickup = async () => {
        Alert.alert('Confirm Pickup', 'Collected all items from merchant?', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Confirm', onPress: async () => {
                const lat = (location as any)?.coords?.latitude;
                const lng = (location as any)?.coords?.longitude;
                if (!lat || !lng) { Alert.alert('GPS Required', 'Location required to start trip'); return; }
                const { error } = await updateRideStatus(rideId, 'in_progress', lat, lng);
                if (error) { Alert.alert('Error', error.message); return; }
                setRide((prev: any) => ({ ...prev, status: 'in_progress' }));
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
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
                } catch { Alert.alert('Failed'); }
                finally { setIsSosLoading(false); }
            }}
        ]);
    };

    const handleEntertainmentAccept = async () => { await handleStatusChange(ride?.status, undefined, 'accepted'); };
    const handleEntertainmentReject = async () => { await handleStatusChange(ride?.status, undefined, 'rejected'); };

    const openNavigation = () => {
        if (!ride) return;
        const dest = ride?.status === 'assigned' ? `${ride?.pickup_lat},${ride?.pickup_lng}` : `${ride?.dropoff_lat},${ride?.dropoff_lng}`;
        Alert.alert('Navigation', 'Choose your navigation app', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Waze', onPress: () => { Linking.openURL(`waze://?ll=${dest}&navigate=yes`).catch(() => { Alert.alert('Error', 'Waze is not installed.'); }); }},
            { text: 'Google / Apple Maps', onPress: () => { const url = Platform.select({ ios: `maps://app?daddr=${dest}`, android: `google.navigation:q=${dest}` }); if (url) Linking.openURL(url); }}
        ]);
    };

    const currentLat = (location as any)?.coords?.latitude || ride?.pickup_lat || 0;
    const currentLng = (location as any)?.coords?.longitude || ride?.pickup_lng || 0;

    if (!ride) {
        return (
            <View style={{ flex: 1, backgroundColor: SURFACE.base, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
                <ActivityIndicator size="large" color={VOICES.driver.accent} />
                <Text style={{ marginTop: 16, color: VOICES.driver.textMuted, fontSize: 15 }}>Loading your trip...</Text>
            </View>
        );
    }

    if (ride?.status === 'completed' || ride?.status === 'closed') {
        const payoutCents = ride?.driver_payout_cents;
        const earnings = payoutCents != null ? (payoutCents / 100).toFixed(2) : '--';
        const isCash = ride?.payment_method === 'cash' || ride?.payment_method === null || ride?.payment_method === undefined;

        if (isCash && !cashConfirmed) {
            return (
                <View style={[s.root, { justifyContent: 'center', padding: 24 }]}>
                    <LinearGradient colors={['#1a3a2a', '#0d2818']} style={StyleSheet.absoluteFillObject} />
                    <LiquidGlass voice="driver" style={s.completedCardBlur} accentEdge>
                        <View style={s.completedCardInner}>
                            <View style={[s.successCircle, { borderColor: VOICES.driver.gold }]}>
                                <Ionicons name="cash-outline" size={44} color={VOICES.driver.gold} />
                            </View>
                            <Text style={s.completedTitle}>Cash Collected?</Text>
                            <Text style={s.cashPromptText}>
                                Did the rider pay you TTD ${earnings} in cash?{'\n'}
                                Confirm to complete settlement.
                            </Text>
                            <View style={s.cashConfirmActions}>
                                <TouchableOpacity
                                    style={[s.dashBtn, { flex: 1 }]}
                                    onPress={async () => {
                                        setCashConfirming(true);
                                        try {
                                            const { data: orderData } = await supabase
                                                .from('orders')
                                                .select('id')
                                                .eq('ride_id', rideId)
                                                .maybeSingle();
                                            if (orderData?.id) {
                                                await supabase.functions.invoke('confirm_cash_collection', { body: { order_id: orderData.id } });
                                            } else {
                                                const { error } = await supabase.functions.invoke('update_ride_status', { body: { ride_id: rideId, cash_confirmed: true } });
                                                if (error) console.error('cash confirm fallback failed:', error);
                                            }
} catch (err) { console.error('cash confirmation error:', err); Alert.alert('Cash Error', 'Cash receipt recorded but confirmation may not have synced.'); }
        finally { setCashConfirming(false); setCashConfirmed(true); }
                                    }}
                                    accessibilityLabel="Confirm cash collected"
                                    accessibilityRole="button"
                                >
                                    <LinearGradient
                                        colors={[VOICES.driver.gold, '#B8860B']}
                                        style={s.dashBtnGradient}
                                        start={{ x: 0, y: 0 }}
                                        end={{ x: 1, y: 1 }}
                                    >
                                        {cashConfirming ? (
                                            <ActivityIndicator color={SURFACE.base} />
                                        ) : (
                                            <>
                                                <Ionicons name="cash-outline" size={18} color={SURFACE.base} style={{ marginRight: 6 }} />
                                                <Text style={s.dashBtnText}>CONFIRM CASH COLLECTED</Text>
                                            </>
                                        )}
                                    </LinearGradient>
                                </TouchableOpacity>
                            </View>
                        </View>
                    </LiquidGlass>
                </View>
            );
        }

        return (
            <View style={[s.root, { justifyContent: 'center', padding: 24 }]}>
                <LinearGradient colors={[VOICES.driver.accent, VOICES.driver.accentDark]} style={StyleSheet.absoluteFillObject} />
                <LiquidGlass voice="driver" style={s.completedCardBlur} accentEdge>
                    <View style={s.completedCardInner}>
                        <View style={s.successCircle}>
                            <Ionicons name="checkmark-circle" size={48} color={VOICES.driver.gold} />
                        </View>
                        <Text style={s.completedTitle}>Trip Completed!</Text>
                        <View style={s.earningsBlock}>
                            <Text style={s.earningsLabelSmall}>Your earnings</Text>
                            <Text style={s.earningsValueLarge}>TTD ${earnings}</Text>
                        </View>
                        {safeMarked ? (
                            <View style={s.safeConfirmedRow}>
                                <Ionicons name="shield-checkmark" size={18} color={VOICES.driver.gold} style={{ marginRight: 6 }} />
                                <Text style={s.safeConfirmedText}>Marked safe — thank you</Text>
                            </View>
                        ) : (
                            <TouchableOpacity
                                style={[s.dashBtn, { marginBottom: 12 }]}
                                disabled={safeMarking}
                                onPress={async () => {
                                    setSafeMarking(true);
                                    try {
                                        const { error } = await supabase.rpc('mark_ride_safe', { p_ride_id: rideId });
                                        if (error) { console.error('mark_ride_safe failed:', error); Alert.alert('Could not mark safe', 'Please try again.'); }
                                        else { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); setSafeMarked(true); }
                                    } catch (err) { console.error('mark_ride_safe error:', err); Alert.alert('Could not mark safe', 'Please try again.'); }
                                    finally { setSafeMarking(false); }
                                }}
                                accessibilityLabel="Mark yourself safe"
                                accessibilityRole="button"
                            >
                                <LinearGradient colors={[VOICES.driver.gold, '#B8860B']} style={s.dashBtnGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
                                    {safeMarking ? (
                                        <ActivityIndicator color={SURFACE.base} />
                                    ) : (
                                        <>
                                            <Ionicons name="shield-checkmark-outline" size={18} color={SURFACE.base} style={{ marginRight: 6 }} />
                                            <Text style={s.dashBtnText}>I'M SAFE / LEFT THE AREA</Text>
                                        </>
                                    )}
                                </LinearGradient>
                            </TouchableOpacity>
                        )}
                        <TouchableOpacity style={s.dashBtn} onPress={() => navigation.reset({ index: 0, routes: [{ name: 'Dashboard' }] })} accessibilityLabel="Back to dashboard" accessibilityRole="button">
                            <LinearGradient colors={[VOICES.driver.accent, VOICES.driver.accentDark]} style={s.dashBtnGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
                                <Text style={s.dashBtnText}>Back to Dashboard</Text>
                            </LinearGradient>
                        </TouchableOpacity>
                    </View>
                </LiquidGlass>
            </View>
        );
    }

    return (
        <View style={s.root} pointerEvents="box-none">
            <LinearGradient colors={[VOICES.driver.accent, VOICES.driver.accentDark]} style={StyleSheet.absoluteFillObject} />

            <MapView
                style={StyleSheet.absoluteFillObject}
                provider={PROVIDER_DEFAULT}
                initialRegion={{ latitude: currentLat, longitude: currentLng, latitudeDelta: 0.05, longitudeDelta: 0.05 }}
            >
                {ENV.MAPBOX_PUBLIC_TOKEN && (
                    <UrlTile urlTemplate={`https://api.mapbox.com/styles/v1/mapbox/dark-v11/tiles/256/{z}/{x}/{y}@2x?access_token=${ENV.MAPBOX_PUBLIC_TOKEN}`} shouldReplaceMapContent maximumZ={19} />
                )}
                <Marker coordinate={{ latitude: currentLat, longitude: currentLng }}>
                    <View style={s.driverMarker}>
                        <Ionicons name="car-sport" size={22} color={VOICES.driver.accent} />
                    </View>
                </Marker>
                {ride && (
                    <Marker coordinate={{ latitude: ride?.status === 'assigned' ? ride?.pickup_lat || 0 : ride?.dropoff_lat || 0, longitude: ride?.status === 'assigned' ? ride?.pickup_lng || 0 : ride?.dropoff_lng || 0 }}>
                        <View style={s.destMarker} />
                    </Marker>
                )}
                {routeCoords.length > 0 && <Polyline coordinates={routeCoords} strokeColor={VOICES.driver.accent} strokeWidth={4} />}
            </MapView>

            <NavigationAndStatusControl
                ride={ride}
                rider={rider}
                location={location}
                signalStatus={signalStatus}
                stops={stops}
                orderItems={orderItems}
                isQuietRide={isQuietRide}
                hasMerchantPhoto={hasMerchantPhoto}
                routeCoords={routeCoords}
                onArrived={handleArrived}
                onVerifyPickup={() => setShowPinModal(true)}
                onComplete={handleComplete}
                onCancel={handleCancel}
                onSOS={handleSOS}
                onOpenNavigation={openNavigation}
                onChat={() => navigation.navigate('Chat', { rideId, rider })}
                onCall={() => { if (rider?.phone_number) { Linking.openURL(`tel:${rider.phone_number}`); } else { Alert.alert('No Number', 'This rider has no phone number on file. Use chat instead.'); }}}
                onDeliveryConfirmPickup={handleDeliveryConfirmPickup}
                onEntertainmentAccept={handleEntertainmentAccept}
                onEntertainmentReject={handleEntertainmentReject}
            />

            <Modal visible={showPinModal} transparent animationType="fade">
                <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={s.modalOverlay}>
                    <LiquidGlass voice="driver" style={s.modalContent}>
                        <Text style={s.modalTitle}>ENTER VERIFICATION PIN</Text>
                        <TextInput style={s.pinInput} keyboardType="number-pad" maxLength={4} value={pinInput} onChangeText={setPinInput} placeholder="0000" placeholderTextColor="rgba(255,255,255,0.2)" autoFocus />
                        <View style={s.modalActions}>
                            <TouchableOpacity style={s.modalCancel} onPress={() => setShowPinModal(false)} accessibilityLabel="Cancel PIN entry" accessibilityRole="button">
                                <Text style={s.modalCancelText}>CANCEL</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={s.modalConfirm} onPress={async () => { if (await handleStatusChange('in_progress', pinInput)) setShowPinModal(false); }} accessibilityLabel="Verify passenger PIN" accessibilityRole="button">
                                <Text style={s.modalConfirmText}>VERIFY</Text>
                            </TouchableOpacity>
                        </View>
                    </LiquidGlass>
                </KeyboardAvoidingView>
            </Modal>
        </View>
    );
}

const SURFACE = { base: '#0B0E12' };

const s = StyleSheet.create({
    root: {
        flex: 1,
        backgroundColor: SURFACE.base,
    },
    completedCardBlur: {
        borderWidth: 0,
    },
    completedCardInner: {
        padding: 28,
        alignItems: 'center',
    },
    completedTitle: {
        fontSize: 22,
        fontWeight: '800',
        color: '#FFF',
        textAlign: 'center',
        marginTop: 16,
        fontFamily: 'SpaceGrotesk-Bold',
    },
    earningsLabelSmall: {
        fontSize: 12,
        fontWeight: '800',
        color: VOICES.driver.gold,
        letterSpacing: 1.5,
        marginBottom: 8,
        fontFamily: 'SpaceGrotesk-Bold',
    },
    earningsValueLarge: {
        fontSize: 42,
        fontWeight: '800',
        color: VOICES.driver.gold,
        letterSpacing: -0.5,
        fontFamily: 'SpaceGrotesk-Bold',
    },
    dashBtn: {
        width: '100%',
        borderRadius: 16,
        overflow: 'hidden',
        marginTop: 24,
        ...elevationGlow(4),
    },
    dashBtnGradient: {
        paddingVertical: 16,
        alignItems: 'center',
    },
    dashBtnText: {
        fontSize: 16,
        fontWeight: '800',
        color: SURFACE.base,
        letterSpacing: 0.5,
        fontFamily: 'SpaceGrotesk-Bold',
    },
    safeConfirmedRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 12,
    },
    safeConfirmedText: {
        fontSize: 14,
        fontWeight: '700',
        color: VOICES.driver.gold,
        letterSpacing: 0.3,
    },
    driverMarker: {
        width: 40,
        height: 40,
        borderRadius: 14,
        backgroundColor: SURFACE.base,
        borderWidth: 2,
        borderColor: VOICES.driver.accent,
        alignItems: 'center',
        justifyContent: 'center',
    },
    destMarker: {
        width: 14,
        height: 14,
        borderRadius: 4,
        backgroundColor: VOICES.driver.accent,
    },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(20,17,34,0.95)',
        justifyContent: 'center',
        padding: 20,
    },
    modalContent: {
        padding: 28,
        borderWidth: 0,
    },
    modalTitle: {
        fontSize: 18,
        fontWeight: '800',
        color: '#FFF',
        textAlign: 'center',
        marginBottom: 20,
        fontFamily: 'SpaceGrotesk-Bold',
    },
    pinInput: {
        width: '100%',
        height: 70,
        fontSize: 42,
        textAlign: 'center',
        color: VOICES.driver.accent,
        marginVertical: 20,
        letterSpacing: 12,
        fontFamily: 'SpaceGrotesk-Bold',
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
        backgroundColor: 'rgba(255,255,255,0.04)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.12)',
    },
    modalCancelText: {
        fontSize: 15,
        fontWeight: '700',
        color: 'rgba(255,255,255,0.6)',
        fontFamily: 'SpaceGrotesk-Bold',
    },
    modalConfirm: {
        flex: 1,
        height: 52,
        backgroundColor: VOICES.driver.accent,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
        ...elevationGlow(4),
    },
    modalConfirmText: {
        fontSize: 15,
        fontWeight: '800',
        color: SURFACE.base,
        fontFamily: 'SpaceGrotesk-Bold',
    },
    successCircle: {
        width: 80, height: 80, borderRadius: 40,
        backgroundColor: 'rgba(255,200,0,0.12)',
        borderWidth: 2, borderColor: VOICES.driver.gold,
        alignItems: 'center', justifyContent: 'center',
        alignSelf: 'center', marginBottom: 16,
    },
    earningsBlock: {
        alignItems: 'center', paddingVertical: 16,
        paddingHorizontal: 24, borderRadius: 16,
        backgroundColor: 'rgba(255,255,255,0.06)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.1)',
        marginTop: 1,
    },
    cashPromptText: {
        fontSize: 15,
        fontWeight: '600',
        color: 'rgba(255,255,255,0.7)',
        textAlign: 'center',
        lineHeight: 22,
        marginTop: 8,
        marginBottom: 4,
        fontFamily: 'SpaceGrotesk-Bold',
    },
    cashConfirmActions: {
        width: '100%',
        marginTop: 20,
    },
});
