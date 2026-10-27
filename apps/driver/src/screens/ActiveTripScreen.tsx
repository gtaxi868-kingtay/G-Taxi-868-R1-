import React, { useEffect, useRef, useState } from 'react';
import {
    View, Text, StyleSheet,
    Alert, Linking, Platform,
    Modal, TextInput, KeyboardAvoidingView,
    ActivityIndicator,
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
import * as Haptics from 'expo-haptics';
import { supabase } from '@gtaxi/core';
import { GuardianSosPanel } from '../components/GuardianSosPanel';
import { ENV } from '@g868/shared/env';
import { useLocationTracking } from '../hooks/useLocationTracking';
import { updateRideStatus, setLocationTrackingMode } from '../services/api';
import { Ionicons } from '@expo/vector-icons';
import { NavigationAndStatusControl } from '../components/NavigationAndStatusControl';
import { StatusBar } from 'expo-status-bar';
import { Button, Pop, Txt, FONT, SPACE, useTheme } from '../ui/kit';
import { DRIVE_COLORS, ttd } from '../theme/drive';

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

// supabase.functions.invoke never throws on a 4xx/5xx; the refusal is in
// `error` (reason in its response body) or in data.success === false.
// Every safety/money action below must check this before telling the
// driver it worked.
async function serverFailure(res: { data: any; error: any }): Promise<string | null> {
    if (res.error) {
        try {
            const body = await res.error.context?.json?.();
            return body?.error || body?.message || res.error.message || 'Request failed';
        } catch {
            return res.error.message || 'Request failed';
        }
    }
    if (res.data && res.data.success === false) return res.data.error || 'Request failed';
    return null;
}


// Read by the hotel's Airport Pickups screen to say the guest never came.
export const NO_SHOW_REASON = 'Airport guest no-show: driver waited 30+ minutes and could not reach the guest';

export function ActiveTripScreen({ route, navigation }: any) {
    // Location every 5 s while on a job; every 20 s otherwise (Phase 4 cost control).
    useEffect(() => {
        setLocationTrackingMode('trip');
        return () => setLocationTrackingMode('idle');
    }, []);

    const { rideId } = route.params;
    const insets = useSafeAreaInsets();
    const { location, signalStatus } = useLocationTracking();

    const [ride, setRide] = useState<any>(null);
    const [rider, setRider] = useState<any>(null);
    const [routeCoords, setRouteCoords] = useState<any[]>([]);
    const [isSosLoading, setIsSosLoading] = useState(false);
    const [sosPanel, setSosPanel] = useState<{ guardianPhone: string | null } | null>(null);
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
    const [pinError, setPinError] = useState<string | null>(null);
    const m = useTheme();
    // The leave-guard below is registered once, so it must read the latest
    // status through a ref. It used to read `ride` from the first render
    // (always null), which blocked "Back to Drive" even after the trip was
    // completed or cancelled and left the driver stuck on this screen.
    const statusRef = useRef<string | null>(null);
    const leavingRef = useRef(false);
    useEffect(() => { statusRef.current = ride?.status ?? null; }, [ride?.status]);

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

        let leftTrip = false;
        const applyRideRow = async (row: any) => {
            if (!row || leftTrip) return;
            setRide((prev: any) => ({ ...prev, ...row }));
            if (row.status === 'cancelled') {
                leftTrip = true;
                leavingRef.current = true;
                Alert.alert('Trip cancelled', 'The rider cancelled this trip. You are back online for new trips.');
                await AsyncStorage.removeItem('active_ride_id');
                navigation.reset({ index: 0, routes: [{ name: 'Dashboard' }] });
            }
        };
        // Live channels miss changes made in their first seconds and say
        // nothing when they drop, so re-read the ride once connected and
        // every 20 s as a safety net (a rider cancel can't go unnoticed).
        const rereadRide = async () => {
            const { data } = await supabase.from('rides').select('*').eq('id', rideId).maybeSingle();
            applyRideRow(data);
        };
        const sub = supabase.channel(`ride_${rideId}`)
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rides', filter: `id=eq.${rideId}` }, (payload) => {
                applyRideRow(payload.new);
            })
            .subscribe((status) => { if (status === 'SUBSCRIBED') rereadRide(); });
        const ridePoll = setInterval(rereadRide, 20000);

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
            const st = statusRef.current;
            if (leavingRef.current || st === 'completed' || st === 'cancelled' || st === 'closed') return;
            e.preventDefault();
            Alert.alert('You are on a trip', 'Finish or cancel the trip with the buttons on screen before leaving.', [{ text: 'Stay on trip', style: 'cancel' }]);
        });

        return () => {
            clearInterval(ridePoll);
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
                Alert.alert('No GPS yet', 'Wait a moment for your location, then try again.');
                return false;
            }

            const { error } = await updateRideStatus(rideId, newStatus, lat, lng, pin);

            if (error) {
                // A wrong PIN is shown inside the PIN box instead of a pop-up.
                if (!pin) Alert.alert('Not updated', error.message || 'Check your signal and try again.');
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
        Alert.alert(ride?.order_id ? 'Mark delivered?' : 'Complete this trip?', ride?.order_id ? 'Only once the customer has the order.' : 'Only once the rider is out of the car.', [
            { text: 'Not yet', style: 'cancel' },
            { text: ride?.order_id ? 'Delivered' : 'Complete', onPress: async () => {
                const lat = (location as any)?.coords?.latitude;
                const lng = (location as any)?.coords?.longitude;
                if (!lat || !lng) { Alert.alert('No GPS yet', 'Wait a moment for your location, then try again.'); return; }
                const { data, error } = await updateRideStatus(rideId, 'completed', lat, lng);
                if (error) Alert.alert('Trip not completed', (error as any)?.message || 'Check your signal and try again.');
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

    const cancelWith = async (reason?: string) => {
        // Leave the trip only once the server has cancelled it;
        // otherwise the rider would be left on a trip we walked away from.
        const res = await supabase.functions.invoke('cancel_ride', { body: reason ? { ride_id: rideId, reason } : { ride_id: rideId } });
        const failure = await serverFailure(res);
        if (failure) {
            Alert.alert('Could not cancel', failure);
            return;
        }
        await AsyncStorage.removeItem('active_ride_id');
        leavingRef.current = true;
        navigation.reset({ index: 0, routes: [{ name: 'Dashboard' }] });
    };

    const handleCancel = () => {
        // Airport pickup, driver already at the meeting point: the hotel must
        // learn the guest never came, not just "cancelled" (airport SOP §5).
        if (ride?.metadata?.is_airport_pickup && ride?.status === 'arrived') {
            Alert.alert('Guest not here?', 'Only after waiting 30 minutes past pickup time and trying the guest twice and the hotel once.', [
                { text: 'Keep waiting', style: 'cancel' },
                { text: "Guest didn't come", style: 'destructive', onPress: () => cancelWith(NO_SHOW_REASON) },
                { text: 'Other reason', onPress: () => cancelWith() },
            ]);
            return;
        }
        Alert.alert('Cancel Trip', 'Are you sure?', [
            { text: 'No', style: 'cancel' },
            { text: 'Yes', style: 'destructive', onPress: () => cancelWith() },
        ]);
    };

    const handleSOS = async () => {
        Alert.alert('EMERGENCY', 'Send an SOS to G Guardian?', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'SEND SOS', style: 'destructive', onPress: async () => {
                // Call buttons first: a person is one tap away whatever
                // happens to the request below.
                setSosPanel({ guardianPhone: null });
                setIsSosLoading(true);
                try {
                    const res = await supabase.functions.invoke('trigger_emergency', { body: { ride_id: rideId } });
                    if (res.data?.guardian_phone) setSosPanel({ guardianPhone: res.data.guardian_phone });
                } catch (err) {
                    console.error('SOS request failed (panel still shown):', err);
                }
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
            // Waze's universal link opens the Waze app when installed and Waze in
            // the browser otherwise (the old waze:// link failed without the app).
            { text: 'Waze', onPress: () => { Linking.openURL(`https://waze.com/ul?ll=${dest}&navigate=yes`).catch(() => { Alert.alert('Error', 'Could not open Waze.'); }); }},
            { text: 'Google / Apple Maps', onPress: () => { const url = Platform.select({ ios: `maps://app?daddr=${dest}`, android: `google.navigation:q=${dest}` }); if (url) Linking.openURL(url); }}
        ]);
    };

    const currentLat = (location as any)?.coords?.latitude || ride?.pickup_lat || 0;
    const currentLng = (location as any)?.coords?.longitude || ride?.pickup_lng || 0;

    const backToDrive = () => {
        leavingRef.current = true;
        navigation.reset({ index: 0, routes: [{ name: 'Dashboard' }] });
    };

    if (!ride) {
        return (
            <View style={[s.root, s.center, { backgroundColor: m.page }]}>
                <StatusBar style="light" />
                <ActivityIndicator size="large" color={m.accent} />
                <Txt tone="dim" style={{ marginTop: SPACE.lg }}>Loading your trip…</Txt>
            </View>
        );
    }

    if (ride?.status === 'completed' || ride?.status === 'closed') {
        const payoutCents = ride?.driver_payout_cents;
        const isCash = ride?.payment_method === 'cash' || ride?.payment_method === null || ride?.payment_method === undefined;
        // What the rider actually hands over: the full fare (NOT the driver's
        // share -- this prompt used to show driver_payout_cents, so a driver
        // following it collected ~20% too little and still owed the platform
        // its cut), plus any earlier cancellation fee carried onto this ride.
        const carriedFeeCents = Number(ride?.metadata?.carried_fee_cents) || 0;
        const collectCents = (ride?.total_fare_cents || 0) + carriedFeeCents;

        const confirmCash = async () => {
            setCashConfirming(true);
            try {
                const { data: orderData } = await supabase
                    .from('orders')
                    .select('id')
                    .eq('ride_id', rideId)
                    .maybeSingle();
                if (orderData?.id) {
                    const res = await supabase.functions.invoke('confirm_cash_collection', { body: { order_id: orderData.id } });
                    const failure = await serverFailure(res);
                    if (failure) {
                        Alert.alert('Cash not recorded', failure + '\nTry again.');
                        return;
                    }
                }
                // A plain cash ride is already booked when the trip
                // completes (complete_ride -> settle_cash_ride); there is
                // nothing more to send.
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                setCashConfirmed(true);
            } catch (err) {
                console.error('cash confirmation error:', err);
                Alert.alert('Cash not recorded', 'Could not confirm the cash. Check your signal and try again.');
            } finally {
                setCashConfirming(false);
            }
        };

        if (isCash && !cashConfirmed) {
            return (
                <View style={[s.root, s.done, { backgroundColor: m.page }]}>
                    <StatusBar style="light" />
                    <Pop>
                        <View style={[s.bigIcon, { backgroundColor: 'rgba(244,206,119,0.14)', borderColor: DRIVE_COLORS.money }]}>
                            <Ionicons name="cash" size={44} color={DRIVE_COLORS.money} />
                        </View>
                        <Txt variant="overline" tone="dim" style={s.centerText}>COLLECT FROM THE RIDER</Txt>
                        <Text style={[s.bigMoney, { color: DRIVE_COLORS.money }]} adjustsFontSizeToFit numberOfLines={1}>{ttd(collectCents)}</Text>
                        <Txt tone="dim" style={s.centerText}>in cash</Txt>
                        {carriedFeeCents > 0 ? (
                            <Txt variant="caption" tone="faint" style={[s.centerText, { marginTop: SPACE.sm }]}>
                                Includes {ttd(carriedFeeCents)} the rider owes from an earlier cancelled trip.
                            </Txt>
                        ) : null}
                        <View style={[s.payoutRow, { backgroundColor: m.field }]}>
                            <Txt tone="dim">Your share</Txt>
                            <Txt variant="headline" style={{ color: DRIVE_COLORS.money }}>{payoutCents != null ? ttd(payoutCents) : '…'}</Txt>
                        </View>
                    </Pop>
                    <Button title="I have the cash" icon="checkmark-circle" color={DRIVE_COLORS.online} onPress={confirmCash} loading={cashConfirming} style={{ marginTop: SPACE.xxl }} />
                </View>
            );
        }

        return (
            <View style={[s.root, s.done, { backgroundColor: m.page }]}>
                <StatusBar style="light" />
                <Pop>
                    <View style={[s.bigIcon, { backgroundColor: 'rgba(47,208,138,0.14)', borderColor: DRIVE_COLORS.online }]}>
                        <Ionicons name="checkmark" size={48} color={DRIVE_COLORS.online} />
                    </View>
                    <Txt variant="hero" style={s.centerText}>Trip done</Txt>
                    <Txt tone="dim" style={[s.centerText, { marginTop: SPACE.xl }]}>You earned</Txt>
                    <Text style={[s.bigMoney, { color: DRIVE_COLORS.money }]} adjustsFontSizeToFit numberOfLines={1}>{payoutCents != null ? ttd(payoutCents) : '…'}</Text>
                </Pop>
                <View style={{ marginTop: SPACE.xxl, gap: SPACE.md }}>
                    {safeMarked ? (
                        <View style={s.safeRow}>
                            <Ionicons name="shield-checkmark" size={18} color={DRIVE_COLORS.online} />
                            <Txt variant="bodyStrong" style={{ color: DRIVE_COLORS.online, marginLeft: 6 }}>Marked safe. Thank you.</Txt>
                        </View>
                    ) : (
                        <Button
                            title="I'm safe and leaving the area"
                            icon="shield-checkmark"
                            variant="secondary"
                            loading={safeMarking}
                            onPress={async () => {
                                setSafeMarking(true);
                                try {
                                    const { error } = await supabase.rpc('mark_ride_safe', { p_ride_id: rideId });
                                    if (error) { console.error('mark_ride_safe failed:', error); Alert.alert('Not marked safe', 'Please try again.'); }
                                    else { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); setSafeMarked(true); }
                                } catch (err) { console.error('mark_ride_safe error:', err); Alert.alert('Not marked safe', 'Please try again.'); }
                                finally { setSafeMarking(false); }
                            }}
                        />
                    )}
                    <Button title="Back to Drive" icon="navigate" color={DRIVE_COLORS.online} onPress={backToDrive} />
                </View>
            </View>
        );
    }

    const target = ride?.status === 'assigned'
        ? { latitude: ride?.pickup_lat || 0, longitude: ride?.pickup_lng || 0 }
        : { latitude: ride?.dropoff_lat || 0, longitude: ride?.dropoff_lng || 0 };

    return (
        <View style={[s.root, { backgroundColor: m.page }]} pointerEvents="box-none">
            <StatusBar style="light" />
            <MapView
                style={StyleSheet.absoluteFillObject}
                provider={PROVIDER_DEFAULT}
                initialRegion={{ latitude: currentLat, longitude: currentLng, latitudeDelta: 0.05, longitudeDelta: 0.05 }}
                mapPadding={{ top: insets.top + 70, bottom: 360, left: 0, right: 0 }}
                showsCompass={false}
                toolbarEnabled={false}
            >
                {ENV.MAPBOX_PUBLIC_TOKEN ? (
                    <UrlTile urlTemplate={`https://api.mapbox.com/styles/v1/mapbox/${m.mapStyle}/tiles/256/{z}/{x}/{y}@2x?access_token=${ENV.MAPBOX_PUBLIC_TOKEN}`} shouldReplaceMapContent maximumZ={19} />
                ) : null}
                {routeCoords.length > 0 ? <Polyline coordinates={routeCoords} strokeColor={DRIVE_COLORS.cyan} strokeWidth={5} /> : null}
                <Marker coordinate={{ latitude: currentLat, longitude: currentLng }} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
                    <View style={s.driverMarker}>
                        <Ionicons name="car-sport" size={20} color="#08090D" />
                    </View>
                </Marker>
                <Marker coordinate={target} tracksViewChanges={false}>
                    <View style={[s.destMarker, { backgroundColor: ride?.status === 'assigned' ? DRIVE_COLORS.online : DRIVE_COLORS.money }]}>
                        <Ionicons name={ride?.status === 'assigned' ? 'person' : 'flag'} size={14} color="#08090D" />
                    </View>
                </Marker>
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
                onVerifyPickup={() => { setPinError(null); setPinInput(''); setShowPinModal(true); }}
                onComplete={handleComplete}
                onCancel={handleCancel}
                onSOS={handleSOS}
                onOpenNavigation={openNavigation}
                onChat={() => navigation.navigate('Chat', { rideId, rider })}
                onCall={() => { if (rider?.phone_number) { Linking.openURL(`tel:${rider.phone_number}`); } else { Alert.alert('No phone number', 'This rider has no number on file. Send a message instead.'); } }}
                onDeliveryConfirmPickup={handleDeliveryConfirmPickup}
                onEntertainmentAccept={handleEntertainmentAccept}
                onEntertainmentReject={handleEntertainmentReject}
            />

            {sosPanel && rideId ? (
                <View style={{ position: 'absolute', left: 16, right: 16, top: insets.top + 76 }}>
                    <GuardianSosPanel
                        rideId={rideId}
                        guardianPhone={sosPanel.guardianPhone}
                        lat={(location as any)?.coords?.latitude ?? null}
                        lng={(location as any)?.coords?.longitude ?? null}
                        showContactHint={false}
                        onClose={() => setSosPanel(null)}
                    />
                </View>
            ) : null}

            <Modal visible={showPinModal} transparent animationType="fade" onRequestClose={() => setShowPinModal(false)}>
                <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={s.modalOverlay}>
                    <View style={[s.modalCard, { backgroundColor: m.tile, borderColor: m.chipBorder }]}>
                        <Txt variant="title" style={s.centerText}>Rider's PIN</Txt>
                        <Txt tone="dim" style={s.centerText}>Ask the rider for the 4 digits on their screen.</Txt>
                        <TextInput
                            style={[s.pinInput, { color: m.ink, backgroundColor: m.field, borderColor: pinError ? DRIVE_COLORS.danger : 'transparent' }]}
                            keyboardType="number-pad"
                            maxLength={4}
                            value={pinInput}
                            onChangeText={(t) => { setPinInput(t.replace(/\D/g, '')); setPinError(null); }}
                            placeholder="····"
                            placeholderTextColor={m.faint}
                            autoFocus
                            accessibilityLabel="Rider PIN"
                        />
                        {pinError ? <Txt variant="caption" tone="danger" style={s.centerText}>{pinError}</Txt> : null}
                        <View style={s.modalActions}>
                            <Button title="Back" variant="secondary" onPress={() => setShowPinModal(false)} style={{ flex: 1 }} />
                            <Button
                                title="Start trip"
                                color={DRIVE_COLORS.online}
                                disabled={pinInput.length !== 4}
                                onPress={async () => {
                                    if (await handleStatusChange('in_progress', pinInput)) { setShowPinModal(false); setPinInput(''); }
                                    else setPinError('That PIN did not work. Check it with the rider.');
                                }}
                                style={{ flex: 2 }}
                            />
                        </View>
                    </View>
                </KeyboardAvoidingView>
            </Modal>
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1 },
    center: { alignItems: 'center', justifyContent: 'center', padding: SPACE.xxl },
    done: { justifyContent: 'center', paddingHorizontal: SPACE.xxl },
    centerText: { textAlign: 'center' },
    bigIcon: { width: 96, height: 96, borderRadius: 48, borderWidth: 3, alignSelf: 'center', alignItems: 'center', justifyContent: 'center', marginBottom: SPACE.xl },
    bigMoney: { fontFamily: FONT.roundBlack, fontSize: 56, lineHeight: 64, textAlign: 'center', fontVariant: ['tabular-nums'] },
    payoutRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: SPACE.xl, paddingHorizontal: SPACE.lg, height: 52, borderRadius: 16 },
    safeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 48 },
    driverMarker: { width: 38, height: 38, borderRadius: 19, backgroundColor: DRIVE_COLORS.cyan, borderWidth: 3, borderColor: '#08090D', alignItems: 'center', justifyContent: 'center' },
    destMarker: { width: 30, height: 30, borderRadius: 15, borderWidth: 3, borderColor: '#08090D', alignItems: 'center', justifyContent: 'center' },
    modalOverlay: { flex: 1, backgroundColor: 'rgba(8,9,13,0.85)', justifyContent: 'center', padding: SPACE.xl },
    modalCard: { borderRadius: 24, borderWidth: 2, padding: SPACE.xl, gap: SPACE.sm },
    pinInput: { height: 76, borderRadius: 18, borderWidth: 2, fontFamily: FONT.roundBlack, fontSize: 40, textAlign: 'center', letterSpacing: 16, marginVertical: SPACE.md },
    modalActions: { flexDirection: 'row', gap: SPACE.md, marginTop: SPACE.sm },
});
