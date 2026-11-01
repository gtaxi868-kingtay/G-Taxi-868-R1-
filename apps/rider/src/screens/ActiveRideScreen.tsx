import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity, Alert, Pressable,
    Linking, useWindowDimensions, Platform, Image as RNImage, AppState,
    Modal, TextInput, KeyboardAvoidingView,
    ActivityIndicator, Share
} from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_DEFAULT, UrlTile } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import Reanimated, {
    useSharedValue, withTiming, withRepeat,
    useAnimatedStyle, Easing, FadeInUp
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { toast } from '../components/Toast';
import { BRAND_GRADIENT, Button, Card, Field, GUTTER, Loading, RADIUS, Screen, SPACE, Txt, useTheme } from '../ui/kit';
import { ENV } from '@g868/shared/env';
import { supabase, supportWhatsAppLink } from '@gtaxi/core';
import { useRideSubscription } from '../services/realtime';
import { fetchDriverDetails } from '../services/realtime';
import { useRideSession } from '../hooks/useRideSession';
import { GuardianSosPanel } from '../components/GuardianSosPanel';
import { CancelReasonSheet } from '../components/CancelReasonSheet';


const getCategoryEmoji = (cat: string) => {
    const map: Record<string, string> = {
        restaurant: '\uD83C\uDF7D',
        grocery: '\uD83D\uDED2',
        pharmacy: '\uD83D\uDC8A',
        laundry: '\uD83E\uDDF4',
        barber: '\uD83D\uDC88',
        salon: '\uD83D\uDC87',
        bakery: '\uD83E\uDD50',
        pizza: '\uD83C\uDF55',
        seafood: '\uD83E\uDD90',
        creole: '\uD83C\uDF7D',
        bank: '\uD83C\uDFE6',
        local: '\uD83C\uDF7D',
        indian: '\uD83C\uDF7D',
        chinese: '\uD83C\uDF7D',
        american: '\uD83C\uDF7D',
        hotel: '\uD83C\uDFE8',
        carwash: '\uD83D\uDEF9',
    };
    return map[cat] || '\uD83C\uDFEA';
};

const DARK_MAP_STYLE = [
    { elementType: 'geometry', stylers: [{ color: '#0B0814' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#B9AEFF' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#0B0814' }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#1C1626' }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0E1A24' }] },
    { featureType: 'poi', stylers: [{ visibility: 'off' }] }
];

interface DriverMarkerProps {
    coordinate: { latitude: number; longitude: number };
    rotation: number;
}

const DriverMarker = ({ coordinate, rotation }: DriverMarkerProps) => {
    const pulse = useSharedValue(0);
    useEffect(() => {
        pulse.value = withRepeat(
            withTiming(1, { duration: 1500, easing: Easing.out(Easing.ease) }),
            -1
        );
    }, []);

    const pulseStyle = useAnimatedStyle(() => ({
        opacity: 1 - pulse.value,
        transform: [{ scale: 1 + pulse.value * 1.5 }],
    }));

    return (
        <Marker coordinate={coordinate} anchor={{ x: 0.5, y: 0.5 }} rotation={rotation}>
            <View style={{ alignItems: 'center', justifyContent: 'center' }}>
                <Reanimated.View style={[pulseStyle, {
                    position: 'absolute',
                    width: 40,
                    height: 40,
                    borderRadius: 20,
                    backgroundColor: 'rgba(139,124,255,0.3)',
                }]} />
                <View style={{
                    width: 16,
                    height: 16,
                    borderRadius: 8,
                    backgroundColor: '#8B7CFF',
                    borderWidth: 2,
                    borderColor: '#FFFFFF',
                }} />
            </View>
        </Marker>
    );
};

interface ActiveRideRouteParams {
    rideId: string;
    paymentMethod?: string;
}

export function ActiveRideScreen({ route, navigation }: { route: { params: ActiveRideRouteParams }, navigation: any }) {
    const { width, height } = useWindowDimensions();
    const { rideId, paymentMethod } = route.params;
    const insets = useSafeAreaInsets();

    const [ride, setRide] = useState<any>(null);
    const [driver, setDriver] = useState<any>(null);
    const [driverLocation, setDriverLocation] = useState<any>(null);
    const [isSosLoading, setIsSosLoading] = useState(false);
    // G Guardian panel: set the moment SOS is confirmed, so 'Call G Guardian'
    // is on screen before the server even answers.
    const [sosPanel, setSosPanel] = useState<{ guardianPhone: string | null } | null>(null);
    const [reasonOpen, setReasonOpen] = useState(false);
    // iOS will not present a Modal while an Alert is still animating closed,
    // and will drop an Alert shown while a Modal is closing. Each waits for
    // the other to finish (code review 2026-10-18).
    const UI_SETTLE_MS = 400;
    const openReasonSheet = () => setTimeout(() => setReasonOpen(true), UI_SETTLE_MS);
    const [aiInsight, setAiInsight] = useState<string | null>(null);
    const [aiSuggestionsEnabled, setAiSuggestionsEnabled] = useState(true);
    const [musicModalVisible, setMusicModalVisible] = useState(false);
    const [musicUrl, setMusicUrl] = useState('');
    const [isMusicLoading, setIsMusicLoading] = useState(false);
    const [location, setLocation] = useState<Location.LocationObject | null>(null);

    const [signalStatus, setSignalStatus] = useState<'ok' | 'stale' | 'lost'>('ok');
    // Fix 4: Ref to hold the location watcher so it can be cleaned up on unmount
    const locationWatcherRef = useRef<{ remove: () => void } | null>(null);

    const [merchants, setMerchants] = useState<any[]>([]);
    const [merchantsLoading, setMerchantsLoading] = useState(false);
    const [selectedMerchant, setSelectedMerchant] = useState<any>(null);
    const [addingStop, setAddingStop] = useState(false);

    const { reattachDriverChannel } = useRideSession({
        rideId,
        rideStatus: ride?.status,
        driverId: driver?.id,
        location,
        aiSuggestionsEnabled,
        onDriverLocationUpdate: (lat, lng) => setDriverLocation({ latitude: lat, longitude: lng }),
        onSignalStatusChange: setSignalStatus,
        onAiInsight: (msg) => {
            setAiInsight(msg);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        },
    });

    const { rideUpdate: updatedRide } = useRideSubscription(rideId);
    const hasArrivalNotifiedRef = useRef(false);
    const aiStopsSuggestedRef = useRef(false);

    const sosPulse = useSharedValue(1);
    const statusOpacity = useSharedValue(0);

    useEffect(() => {
        fetchInitialData();
        statusOpacity.value = withTiming(1, { duration: 800 });
        sosPulse.value = withRepeat(
            withTiming(1.3, { duration: 1000, easing: Easing.inOut(Easing.ease) }),
            -1, true
        );

        const appStateSub = AppState.addEventListener('change', (nextState) => {
            if (nextState === 'active') {
                reattachDriverChannel();
                fetchInitialData();
            }
        });

        const eventsChannel = supabase
            .channel(`ride_events_${rideId}`)
            .on(
                'postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'ride_events', filter: `ride_id=eq.${rideId}` },
                (payload: any) => {
                    if (payload.new?.event_type === 'ai_insight') {
                        setAiInsight(payload.new.metadata?.message || "Analyzing logistics...");
                        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                    }
                }
            )
            .subscribe();

        // Fix 4: Location watcher stored in ref for proper cleanup
        (async () => {
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') return;

            const loc = await Location.getCurrentPositionAsync({});
            setLocation(loc);

            const watcher = await Location.watchPositionAsync(
                { accuracy: Location.Accuracy.Balanced, distanceInterval: 10 },
                (newLoc) => setLocation(newLoc)
            );
            locationWatcherRef.current = watcher;
        })();

        const beforeRemoveListener = navigation.addListener('beforeRemove', (e: any) => {
            // Allow navigation if the ride is actually finished
            if (ride?.status === 'completed' || ride?.status === 'closed' || ride?.status === 'cancelled') {
                return;
            }

            // Prevent default behavior of leaving the screen
            e.preventDefault();

            Alert.alert(
                'Active Ride',
                'You have an active ride in progress. Please use the SOS button for emergencies or wait for the ride to complete.',
                [
                    { text: 'Stay in Ride', style: 'cancel', onPress: () => { } },
                ]
            );
        });

        return () => {
            appStateSub.remove();
            eventsChannel.unsubscribe();
            beforeRemoveListener();
            // Fix 4: Remove location watcher on unmount
            locationWatcherRef.current?.remove();
        };
    }, []);

    useEffect(() => {
        if (updatedRide) {
            setRide((prev: any) => ({ ...prev, ...updatedRide }));
            if (updatedRide.status === 'completed' || updatedRide.status === 'closed') {
                // Fire-and-forget: Update user memory for AI personalization
                const rideLat = updatedRide.dropoff_lat || ride?.dropoff_lat;
                const rideLng = updatedRide.dropoff_lng || ride?.dropoff_lng;
                let direction = 'unknown';
                if (rideLat && rideLng) {
                    if (rideLat > 10.65) direction = 'north';
                    else if (rideLat < 10.65) direction = 'south';
                    else if (rideLng > -61.5) direction = 'east';
                    else direction = 'west';
                }

                // Log memory update attempt (silent fail OK)
                // console.log('MEMORY UPDATE: Attempting for ride', rideId);

                supabase.functions.invoke('update_user_memory', {
                    body: {
                        user_id: ride?.rider_id,
                        ride_id: rideId,
                        direction,
                        hour: new Date().getHours(),
                        day_of_week: new Date().getDay(),
                        payment_method: updatedRide.payment_method || ride?.payment_method,
                        had_stop: (ride?.stops?.length || 0) > 0
                    }
                }).catch((err: any) => {
                    // Silent fail — memory update is non-critical
                    // console.log('MEMORY UPDATE: Silent fail:', err?.message || err);
                });

                navigation.replace('Rating', {
                    driver,
                    fare: { total_fare_cents: updatedRide.total_fare_cents || ride?.total_fare_cents },
                    rideId,
                    paymentMethod: paymentMethod || updatedRide.payment_method
                });
            } else if (updatedRide.status === 'cancelled') {
                Alert.alert('Ride Cancelled', 'The driver had to cancel this trip.');
                navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
            } else if (updatedRide.status === 'arrived' && !hasArrivalNotifiedRef.current) {
                // FIX F7: Driver arrival notification
                hasArrivalNotifiedRef.current = true;
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                // Burst haptics
                for (let i = 0; i < 3; i++) {
                    setTimeout(() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                    }, i * 300);
                }
                Alert.alert(
                    "Your driver has arrived! 🚖",
                    `${driver?.name || 'Your driver'} is waiting at the pickup location.`,
                    [{ text: "OK", style: "default" }]
                );
            }
        }
    }, [updatedRide]);

    // Fetch AI preferences on mount
    useEffect(() => {
        const fetchAiPrefs = async () => {
            const { data } = await supabase
                .from('rider_ai_preferences')
                .select('ai_suggestions_enabled')
                .eq('user_id', ride?.rider_id)
                .maybeSingle();
            if (data && data.ai_suggestions_enabled === false) {
                setAiSuggestionsEnabled(false);
            }
        };
        fetchAiPrefs();
    }, [ride?.rider_id]);

    useEffect(() => {
        if (ride?.status !== 'in_progress' || aiStopsSuggestedRef.current || !rideId) return;
        aiStopsSuggestedRef.current = true;
        supabase.functions.invoke('ai_suggest_stops', { body: { ride_id: rideId } }).catch(() => {});
    }, [ride?.status, rideId]);

    const openWhatsAppSupport = async () => {
        Linking.openURL(await supportWhatsAppLink('I need help with my ride'));
    };

    const handleCancelRide = () => {
        // Same rule as the server (cancel_ride_atomic): the TT$5 fee applies
        // only once the driver has arrived, or has been on the way for 10+
        // minutes since accepting. Before that, cancelling is free.
        const minutesOnTheWay = ride?.assigned_at
            ? (Date.now() - new Date(ride.assigned_at).getTime()) / 60000
            : 0;
        const feeApplies = ride?.status === 'arrived'
            || (ride?.status === 'assigned' && minutesOnTheWay >= 10);

        if (feeApplies) {
            Alert.alert(
                "Cancel this ride?",
                ride?.status === 'arrived'
                    ? "Your driver is already at your pickup.\nA TTD 5.00 cancellation fee will be charged and paid to the driver."
                    : "Your driver has been on the way for over 10 minutes.\nA TTD 5.00 cancellation fee will be charged and paid to the driver.",
                [
                    { text: "Keep My Ride", style: "cancel" },
                    { text: "Cancel Anyway", style: "destructive", onPress: openReasonSheet }
                ]
            );
        } else if (ride?.status === 'assigned') {
            const freeMins = Math.max(1, Math.ceil(10 - minutesOnTheWay));
            Alert.alert(
                "Cancel this ride?",
                `Your driver is on the way. Cancelling is free for about ${freeMins} more minute${freeMins === 1 ? '' : 's'}, or until they arrive.`,
                [
                    { text: "Keep My Ride", style: "cancel" },
                    { text: "Cancel for free", style: "destructive", onPress: openReasonSheet }
                ]
            );
        } else {
            Alert.alert(
                "Cancel this ride?",
                "Are you sure you want to cancel?",
                [
                    { text: "No", style: "cancel" },
                    { text: "Yes, Cancel", style: "destructive", onPress: openReasonSheet }
                ]
            );
        }
    };

    const executeCancelRide = async (reasonCode: string | null) => {
        setReasonOpen(false);
        try {
            const { data, error } = await supabase.functions.invoke('cancel_ride', {
                body: { ride_id: rideId, reason_code: reasonCode ?? undefined }
            });

            if (error) throw error;

            navigation.replace('Home');
            setTimeout(() => Alert.alert("Ride Cancelled", "Your ride has been cancelled."), UI_SETTLE_MS);
        } catch (err) {
            console.error('Cancel failed:', err);
            setTimeout(() => Alert.alert("Error", "Could not cancel ride. Please try again."), UI_SETTLE_MS);
        }
    };

    const fetchInitialData = async () => {
        const { data, error } = await supabase
            .from('rides')
            .select(`
                *,
                driver:driver_id(
                    id, name, vehicle_model, plate_number, vehicle_type, rating, lat, lng
                )
            `)
            .eq('id', rideId)
            .single();

        if (error) {
            console.error('[ActiveRideScreen] rides query failed:', error.message);
            Alert.alert("Error", "Could not load ride details. Please try again.");
            return;
        }

        if (data) {
            setRide(data);
            setDriver(data.driver);
            setDriverLocation({ latitude: data.driver?.lat, longitude: data.driver?.lng });
        }
    };

    const fetchNearbyMerchants = useCallback(async () => {
        if (!ride?.pickup_lat || !ride?.pickup_lng) return;
        setMerchantsLoading(true);
        try {
            const { data, error } = await supabase.functions.invoke('get_nearby_merchants', {
                body: { ride_id: rideId }
            });
            if (!error && data?.success && data?.data?.merchants) {
                setMerchants(data.data.merchants);
            }
        } catch (err) {
            console.error('Failed to fetch merchants:', err);
        } finally {
            setMerchantsLoading(false);
        }
    }, [ride?.pickup_lat, ride?.pickup_lng, rideId]);

    useEffect(() => {
        if (ride && ['assigned', 'arrived', 'in_progress'].includes(ride.status)) {
            fetchNearbyMerchants();
        }
    }, [ride?.status, fetchNearbyMerchants]);

    const handleAddMerchantStop = async (merchant: any) => {
        if (addingStop) return;
        setAddingStop(true);
        try {
            const { data, error } = await supabase.functions.invoke('add_merchant_stop', {
                body: { ride_id: rideId, merchant_id: merchant.id }
            });
            if (error || !data?.success) {
                Alert.alert('Error', data?.error || 'Failed to add stop');
                return;
            }
            setSelectedMerchant(null);
            setAiInsight(`Stop added at ${merchant.name}! Route updated.`);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } catch (err) {
            console.error('Add stop failed:', err);
            Alert.alert('Error', 'Could not add stop');
        } finally {
            setAddingStop(false);
        }
    };

    const handleSkipUnfinishedStops = async () => {
        Alert.alert(
            'Unfinished Stops',
            'You have merchant stops not yet visited. Skip them and complete the ride?',
            [
                { text: 'Keep Stops', style: 'cancel' },
                {
                    text: 'Skip All', style: 'destructive',
                    onPress: async () => {
                        await supabase.functions.invoke('skip_ride_stop', {
                            body: { ride_id: rideId, skip_all: true }
                        }).catch(() => {});
                        Alert.alert('Stops Skipped', 'You can complete the ride now.');
                    }
                }
            ]
        );
    };

    const handleMusicSuggestion = async () => {
        if (!musicUrl.includes('spotify.com') && !musicUrl.includes('youtube.com') && !musicUrl.includes('youtu.be')) {
            Alert.alert("Invalid Link", "Please provide a valid Spotify or YouTube link.");
            return;
        }

        if (!rideId) {
            Alert.alert("Error", "No active ride session found.");
            return;
        }
        setIsMusicLoading(true);
        // Riders cannot update rides directly (no grant; RLS only allows a
        // cancel). rider_set_ride_options changes just these fields on the
        // rider's own live ride.
        const { data, error } = await supabase.rpc('rider_set_ride_options', { p_ride_id: rideId, p_entertainment_url: musicUrl });
        setIsMusicLoading(false);
        if (error || !(data as any)?.success) {
            Alert.alert("Couldn't send it", (data as any)?.error || "Could not send suggestion. Please try again.");
        } else {
            setMusicModalVisible(false);
            setAiInsight("Music suggestion sent! Waiting for driver approval...");
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
    };

    const handleShareMirror = async () => {
        try {
            const mirrorUrl = `${ENV.SUPABASE_URL}/functions/v1/mirror_ride?ride_id=${rideId}`;
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            
            await Share.share({
                title: 'G-TAXI Guardian Shield',
                message: `I'm on a G-TAXI ride with ${driver?.name || 'a driver'}. Monitor my live progress here: ${mirrorUrl}`,
                url: mirrorUrl
            });
        } catch (error) {
            console.error(error);
        }
    };

    const toggleSafeEntry = async () => {
        try {
            const nextValue = !ride?.safe_entry;
            const { data, error } = await supabase.rpc('rider_set_ride_options', { p_ride_id: rideId, p_safe_entry: nextValue });

            if (!error && (data as any)?.success) {
                setRide((prev: any) => ({ ...prev, safe_entry: nextValue }));
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                setAiInsight(nextValue ? "Safe Entry Mode ACTIVE. Driver is instructed to wait for you." : "Safe Entry Mode disabled.");
            } else {
                // Used to fail silently: the rider tapped a safety switch and nothing happened.
                Alert.alert("Safe Entry", (data as any)?.error || "Couldn't change Safe Entry right now. Please try again.");
            }
        } catch (error) {
            console.error(error);
        }
    };

    const handleSOS = () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        Alert.alert("SOS EMERGENCY", "Send an SOS to G Guardian?", [
            { text: "Cancel", style: "cancel" },
            {
                text: "SEND SOS", style: "destructive", onPress: async () => {
                    // Show the call buttons first: a person is one tap away
                    // whatever happens to the network request below.
                    // Wait for the alert to finish closing: iOS drops a Modal
                    // presented while an Alert is still animating out.
                    setTimeout(() => setSosPanel(prev => prev ?? { guardianPhone: null }), UI_SETTLE_MS);
                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                    if (!rideId) return;
                    setIsSosLoading(true);
                    try {
                        // 503 (nobody reached by message yet) still returns the
                        // guardian number in the body; the panel works either way.
                        const { data } = await supabase.functions.invoke('trigger_emergency', {
                            body: { ride_id: rideId }
                        });
                        if (data?.guardian_phone) setSosPanel({ guardianPhone: data.guardian_phone });
                    } catch (err) {
                        console.error("SOS request failed (panel still shown):", err);
                    } finally {
                        setIsSosLoading(false);
                    }
                }
            }
        ]);
    };

    const getStatusType = () => {
        if (!ride) return 'searching';
        if (ride?.status === 'assigned') return 'assigned';
        if (ride?.status === 'arrived') return 'live';
        if (ride?.status === 'in_progress') return 'live';
        return 'searching';
    };

    const statusStyle = useAnimatedStyle(() => ({ opacity: statusOpacity.value }));
    const sosAnim = useAnimatedStyle(() => ({ transform: [{ scale: sosPulse.value }] }));

    const step = ride?.status === 'assigned' || ride?.status === 'arrived' ? 1 : 2;

    const m = useTheme();
    const night = m.key === 'night';
    const tileStyle = night ? 'navigation-night-v1' : 'light-v11';
    const [cardH, setCardH] = useState(300);

    const statusLabel = ride?.status === 'assigned' ? 'Driver on the way'
        : ride?.status === 'arrived' ? 'Your driver is here'
        : ride?.status === 'in_progress' ? 'On your way'
        : 'Connecting';
    const statusColor = ride?.status === 'in_progress' ? '#2FB57C' : ride?.status === 'arrived' ? '#F5A524' : '#8B7CFF';

    if (!ride) {
        return (
            <Screen scroll={false}>
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                    <Loading />
                    <Txt variant="body" tone="dim">Connecting to your ride…</Txt>
                </View>
            </Screen>
        );
    }

    const action = (icon: any, label: string, onPress: () => void, color?: string) => (
        <Pressable key={label} accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
            style={({ pressed }) => ({ flex: 1, alignItems: 'center', opacity: pressed ? 0.7 : 1 })}>
            <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: m.field, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name={icon} size={20} color={color || m.ink} />
            </View>
            <Txt variant="caption" tone="dim" numberOfLines={1} style={{ marginTop: 6 }}>{label}</Txt>
        </Pressable>
    );

    return (
        <View style={{ flex: 1, backgroundColor: m.page }}>
            <StatusBar style={m.statusBar} />

            <MapView
                style={StyleSheet.absoluteFillObject}
                provider={PROVIDER_DEFAULT}
                customMapStyle={night ? DARK_MAP_STYLE : []}
                initialRegion={{ latitude: ride?.pickup_lat || 10.66, longitude: ride?.pickup_lng || -61.51, latitudeDelta: 0.05, longitudeDelta: 0.05 }}
                mapPadding={{ top: insets.top + 64, right: 0, bottom: cardH, left: 0 }}
                userInterfaceStyle={night ? 'dark' : 'light'}
            >
                {ENV.MAPBOX_PUBLIC_TOKEN && (
                    <UrlTile key={tileStyle} urlTemplate={`https://api.mapbox.com/styles/v1/mapbox/${tileStyle}/tiles/256/{z}/{x}/{y}@2x?access_token=${ENV.MAPBOX_PUBLIC_TOKEN}`} shouldReplaceMapContent={true} />
                )}
                {driverLocation && <DriverMarker coordinate={driverLocation} rotation={driver?.heading || 0} />}
                <Marker coordinate={{ latitude: ride?.pickup_lat || 0, longitude: ride?.pickup_lng || 0 }}>
                    <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: '#8B7CFF', borderWidth: 3, borderColor: '#FFFFFF' }} />
                </Marker>
                <Marker coordinate={{ latitude: ride?.dropoff_lat || 0, longitude: ride?.dropoff_lng || 0 }}>
                    <View style={{ width: 16, height: 16, borderRadius: 4, backgroundColor: night ? '#E9CFA6' : '#21152E', borderWidth: 3, borderColor: '#FFFFFF' }} />
                </Marker>
                {['assigned', 'arrived', 'in_progress'].includes(ride?.status) && merchants.map((mm: any) => (
                    <Marker key={mm.id} coordinate={{ latitude: mm.lat, longitude: mm.lng }} onPress={() => setSelectedMerchant(mm)}>
                        <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: m.sheet[1], borderWidth: 2, borderColor: '#8B7CFF', alignItems: 'center', justifyContent: 'center' }}>
                            <Txt variant="body">{getCategoryEmoji(mm.category)}</Txt>
                        </View>
                    </Marker>
                ))}
            </MapView>

            {/* Status pill */}
            <View style={{ position: 'absolute', top: insets.top + 12, left: GUTTER, right: GUTTER, alignItems: 'center' }}>
                <Reanimated.View style={[statusStyle, { flexDirection: 'row', alignItems: 'center', height: 38, paddingHorizontal: 16, borderRadius: 19, backgroundColor: m.sheet[1], borderWidth: 1, borderColor: m.sheetBorder }]}>
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: statusColor, marginRight: 8 }} />
                    <Txt variant="label">{statusLabel}</Txt>
                </Reanimated.View>
            </View>

            {/* Signal problems / G note — stacked under the status pill */}
            <View style={{ position: 'absolute', top: insets.top + 60, left: GUTTER, right: GUTTER, gap: SPACE.sm }}>
                {signalStatus === 'stale' && (
                    <Card style={{ flexDirection: 'row', alignItems: 'center', padding: SPACE.md }}>
                        <Ionicons name="cellular-outline" size={16} color="#D97706" />
                        <Txt variant="caption" style={{ flex: 1, marginLeft: SPACE.sm }}>Driver signal is weak. Showing their last position.</Txt>
                    </Card>
                )}
                {signalStatus === 'lost' && (
                    <Card style={{ borderColor: '#E5484D' }}>
                        <Txt variant="bodyStrong">We lost contact with your driver</Txt>
                        <Txt variant="caption" tone="dim" style={{ marginTop: 2 }}>Your trip is still active.</Txt>
                        <View style={{ flexDirection: 'row', gap: SPACE.md, marginTop: SPACE.md }}>
                            <Button title="Message driver" size="sm" style={{ flex: 1 }} onPress={() => navigation.navigate('Chat', { rideId })} />
                            <Button title="Call support" size="sm" variant="secondary" style={{ flex: 1 }} onPress={openWhatsAppSupport} />
                        </View>
                    </Card>
                )}
                {aiInsight && signalStatus === 'ok' && (
                    <Card style={{ flexDirection: 'row', alignItems: 'flex-start', padding: SPACE.md }}>
                        <Ionicons name="sparkles" size={16} color={m.accent} style={{ marginTop: 2 }} />
                        <Txt variant="body" style={{ flex: 1, marginHorizontal: SPACE.sm }}>{aiInsight}</Txt>
                        <Pressable accessibilityRole="button" accessibilityLabel="Dismiss" hitSlop={8} onPress={() => setAiInsight(null)}>
                            <Ionicons name="close" size={18} color={m.faint} />
                        </Pressable>
                    </Card>
                )}
            </View>

            {/* Driver card */}
            <View
                onLayout={(e) => setCardH(e.nativeEvent.layout.height)}
                style={{ position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: m.sheet[1], borderTopLeftRadius: RADIUS.sheet, borderTopRightRadius: RADIUS.sheet,
                    borderWidth: 1, borderBottomWidth: 0, borderColor: m.sheetBorder, paddingHorizontal: GUTTER, paddingTop: SPACE.md, paddingBottom: Math.max(insets.bottom, SPACE.lg) + SPACE.sm,
                    shadowColor: '#000', shadowOpacity: m.shadowOpacity, shadowRadius: 24, shadowOffset: { width: 0, height: -6 }, elevation: 16 }}
            >
                <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: m.chipBorder, alignSelf: 'center', marginBottom: SPACE.lg }} />

                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <View style={{ width: 52, height: 52, borderRadius: 26, overflow: 'hidden' }}>
                        <LinearGradient colors={BRAND_GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                            <Txt variant="title" tone="onBrand">{driver?.name?.charAt(0) || 'G'}</Txt>
                        </LinearGradient>
                    </View>
                    <View style={{ flex: 1, marginLeft: SPACE.md }}>
                        <Txt variant="headline" numberOfLines={1}>{driver?.name || 'Your driver'}</Txt>
                        <Txt variant="caption" tone="dim" numberOfLines={1}>{[driver?.vehicle_model, driver?.plate_number].filter(Boolean).join(' · ') || 'Vehicle details loading'}</Txt>
                    </View>
                    {ride?.ride_pin && (
                        <View style={{ alignItems: 'center', paddingHorizontal: SPACE.md, paddingVertical: 6, borderRadius: 14, backgroundColor: m.field, marginRight: SPACE.sm }}>
                            <Txt variant="overline" tone="faint">PIN</Txt>
                            <Txt variant="headline">{ride.ride_pin}</Txt>
                        </View>
                    )}
                    <Pressable accessibilityRole="button" accessibilityLabel="Emergency SOS" onPress={handleSOS}>
                        <Reanimated.View style={[sosAnim, { width: 52, height: 52, borderRadius: 26, backgroundColor: '#E5484D', alignItems: 'center', justifyContent: 'center' }]}>
                            {isSosLoading ? <ActivityIndicator color="#FFFFFF" /> : <Txt variant="label" tone="onBrand">SOS</Txt>}
                        </Reanimated.View>
                    </Pressable>
                </View>

                {ride?.status === 'arrived' && ride?.arrived_at && <IsolatedWaitClock arrivedAt={ride.arrived_at} setAiInsight={setAiInsight} />}

                {/* Trip progress */}
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: SPACE.lg }}>
                    {[{ icon: 'location', on: step >= 1, label: 'Pickup' }, { icon: 'car', on: step >= 2, label: 'Riding' }, { icon: 'flag', on: false, label: 'Drop-off' }].map((n, i) => (
                        <React.Fragment key={n.label}>
                            {i > 0 && <View style={{ flex: 1, height: 2, backgroundColor: n.on ? '#8B7CFF' : m.chipBorder, marginHorizontal: 6 }} />}
                            <View style={{ width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: n.on ? '#8B7CFF' : m.field }}>
                                <Ionicons name={n.icon as any} size={13} color={n.on ? '#FFFFFF' : m.faint} />
                            </View>
                        </React.Fragment>
                    ))}
                </View>

                {/* Actions */}
                <View style={{ flexDirection: 'row', marginTop: SPACE.lg }}>
                    {action('call-outline', 'Call', () => driver?.phone_number ? Linking.openURL(`tel:${driver.phone_number}`) : toast('Your driver’s number is not available. Send a message instead.'))}
                    {action('chatbubble-ellipses-outline', 'Message', () => navigation.navigate('Chat', { rideId, driver }))}
                    {action('share-social-outline', 'Share trip', handleShareMirror)}
                    {action(ride?.safe_entry ? 'home' : 'home-outline', 'Safe entry', toggleSafeEntry, ride?.safe_entry ? '#2FB57C' : undefined)}
                    {action(ride?.entertainment_status === 'accepted' ? 'musical-notes' : 'musical-note-outline', 'Music', () => setMusicModalVisible(true), ride?.entertainment_status === 'accepted' ? '#2FB57C' : undefined)}
                </View>

                {ride?.status !== 'in_progress' && (
                    <Button title="Cancel ride" variant="ghost" size="md" style={{ marginTop: SPACE.lg }} onPress={handleCancelRide} />
                )}
            </View>

            <CancelReasonSheet visible={reasonOpen} onPick={executeCancelRide} onClose={() => setReasonOpen(false)} />

            {/* SOS: a full sheet over everything, so the call buttons are never hidden */}
            <Modal visible={!!(sosPanel && rideId)} transparent animationType="slide" onRequestClose={() => setSosPanel(null)}>
                <View style={{ flex: 1, backgroundColor: 'rgba(10,0,4,0.6)', justifyContent: 'flex-end', paddingHorizontal: GUTTER, paddingBottom: Math.max(insets.bottom, SPACE.lg) + SPACE.sm }}>
                    {sosPanel && rideId ? (
                        <GuardianSosPanel
                            rideId={rideId}
                            guardianPhone={sosPanel.guardianPhone}
                            lat={location?.coords.latitude ?? null}
                            lng={location?.coords.longitude ?? null}
                            driverName={driver?.name ?? null}
                            plate={driver?.plate_number ?? null}
                            onClose={() => setSosPanel(null)}
                        />
                    ) : null}
                </View>
            </Modal>

            {/* Add a shop as a stop */}
            <Modal visible={!!selectedMerchant} transparent animationType="fade" onRequestClose={() => setSelectedMerchant(null)}>
                <View style={{ flex: 1, backgroundColor: 'rgba(10,6,20,0.55)', justifyContent: 'flex-end' }}>
                    <View style={{ backgroundColor: m.sheet[1], borderTopLeftRadius: RADIUS.sheet, borderTopRightRadius: RADIUS.sheet, padding: GUTTER, paddingBottom: Math.max(insets.bottom, SPACE.lg) + SPACE.sm }}>
                        <Txt variant="title">{getCategoryEmoji(selectedMerchant?.category)} {selectedMerchant?.name}</Txt>
                        <Txt variant="body" tone="dim" style={{ marginTop: SPACE.xs }}>
                            {selectedMerchant?.category}{selectedMerchant?.distance_km ? ` · ${selectedMerchant.distance_km} km away` : ''}. Add it as a stop on your route? A small stop fee applies.
                        </Txt>
                        <Button title="Add stop" style={{ marginTop: SPACE.xl }} loading={addingStop} onPress={() => handleAddMerchantStop(selectedMerchant)} />
                        <Button title="Not now" variant="ghost" style={{ marginTop: SPACE.md }} onPress={() => setSelectedMerchant(null)} />
                    </View>
                </View>
            </Modal>

            {/* Music request */}
            <Modal visible={musicModalVisible} transparent animationType="slide" onRequestClose={() => setMusicModalVisible(false)}>
                <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, backgroundColor: 'rgba(10,6,20,0.55)', justifyContent: 'flex-end' }}>
                    <View style={{ backgroundColor: m.sheet[1], borderTopLeftRadius: RADIUS.sheet, borderTopRightRadius: RADIUS.sheet, padding: GUTTER, paddingBottom: Math.max(insets.bottom, SPACE.lg) + SPACE.sm }}>
                        <Txt variant="title">Suggest a song</Txt>
                        <Txt variant="body" tone="dim" style={{ marginTop: SPACE.xs, marginBottom: SPACE.lg }}>Paste a Spotify or YouTube link. Your driver can choose to play it.</Txt>
                        <Field placeholder="https://…" value={musicUrl} onChangeText={setMusicUrl} autoFocus autoCapitalize="none" keyboardType="url" />
                        <View style={{ flexDirection: 'row', gap: SPACE.md }}>
                            <Button title="Cancel" variant="secondary" style={{ flex: 1 }} onPress={() => setMusicModalVisible(false)} />
                            <Button title="Send" style={{ flex: 1 }} loading={isMusicLoading} onPress={handleMusicSuggestion} />
                        </View>
                    </View>
                </KeyboardAvoidingView>
            </Modal>
        </View>
    );
}

const EDGE_OUT_FEE_PER_MIN_CENTS = 150; // TT$1.50/min — Edge Out stop charge (no grace period)

function IsolatedWaitClock({ arrivedAt, setAiInsight, isStop }: { arrivedAt: string, setAiInsight: any, isStop?: boolean }) {
    const [stats, setStats] = useState({ mins: 0, cents: 0 });

    useEffect(() => {
        const timer = setInterval(() => {
            const diffMs = Date.now() - new Date(arrivedAt).getTime();
            const mins = Math.max(0, Math.floor(diffMs / 60000));
            const cents = Math.floor((diffMs / 60000) * EDGE_OUT_FEE_PER_MIN_CENTS);
            setStats({ mins, cents });

            if (mins >= 1 && stats.mins !== mins && isStop) {
                setAiInsight(`Edge Out wait fee active: TTD $${(cents / 100).toFixed(2)} at TT$1.50/min.`);
            }
        }, 1000);
        return () => clearInterval(timer);
    }, [arrivedAt, stats.mins, isStop]);

    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: SPACE.md, padding: SPACE.md, borderRadius: 14, backgroundColor: 'rgba(245,165,36,0.12)' }}>
            <Ionicons name="time-outline" size={16} color="#D97706" />
            <Txt variant="caption" style={{ flex: 1, marginLeft: SPACE.sm }}>
                Your driver has waited {stats.mins} min. {isStop ? 'Stop' : 'Waiting'} fee so far: TT${(stats.cents / 100).toFixed(2)} (TT$1.50/min)
            </Txt>
        </View>
    );
}
