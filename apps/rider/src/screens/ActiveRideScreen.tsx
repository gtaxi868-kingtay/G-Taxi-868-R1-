import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity, Alert,
    Linking, Dimensions, Platform, Image as RNImage, AppState,
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
import { ENV } from '../../../../shared/env';
import { supabase } from '../../../../shared/supabase';
import { useRideSubscription } from '../services/realtime';
import { fetchDriverDetails } from '../services/realtime';

const { width, height } = Dimensions.get('window');

// Blueberry Luxe Color System
const COLORS = {
    bgPrimary: '#0D0B1E',
    bgSecondary: '#160B32',
    purple: '#7B5CF0',
    purpleDark: '#5B3FD0',
    purpleLight: '#9B7CF0',
    cyan: '#00E5FF',
    cyanDark: '#0099BB',
    white: '#FFFFFF',
    textSecondary: 'rgba(255,255,255,0.6)',
    textMuted: 'rgba(255,255,255,0.5)',
    glassBg: 'rgba(255,255,255,0.06)',
    glassBorder: 'rgba(123,92,240,0.3)',
    success: '#00FF94',
    warning: '#F59E0B',
    error: '#FF4D6D',
};

// Custom Dark Map Style for Blueberry Luxe
const DARK_MAP_STYLE = [
    { elementType: 'geometry', stylers: [{ color: '#0d0b1e' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#7B5CF0' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#0d0b1e' }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#1a1040' }] },
    { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#7B5CF0', weight: 0.5 }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#00E5FF', lightness: -80 }] },
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
                    backgroundColor: 'rgba(0,229,255,0.3)',
                }]} />
                <View style={{
                    width: 16,
                    height: 16,
                    borderRadius: 8,
                    backgroundColor: COLORS.cyan,
                    borderWidth: 2,
                    borderColor: COLORS.white,
                    shadowColor: COLORS.cyan,
                    shadowRadius: 10,
                    shadowOpacity: 0.8,
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
    const { rideId, paymentMethod } = route.params;
    const insets = useSafeAreaInsets();

    const [ride, setRide] = useState<any>(null);
    const [driver, setDriver] = useState<any>(null);
    const [driverLocation, setDriverLocation] = useState<any>(null);
    const [isSosLoading, setIsSosLoading] = useState(false);
    const [aiInsight, setAiInsight] = useState<string | null>("I'm monitoring your ride security and wait-time.");
    const [aiSuggestionsEnabled, setAiSuggestionsEnabled] = useState(true);
    const [musicModalVisible, setMusicModalVisible] = useState(false);
    const [musicUrl, setMusicUrl] = useState('');
    const [isMusicLoading, setIsMusicLoading] = useState(false);
    const [location, setLocation] = useState<Location.LocationObject | null>(null);

    const driverChannelRef = useRef<any>(null);
    const lastLocationUpdateRef = useRef<number>(Date.now());
    const [signalStatus, setSignalStatus] = useState<'ok' | 'stale' | 'lost'>('ok');
    const signalCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);

    const { rideUpdate: updatedRide } = useRideSubscription(rideId);
    const hasArrivalNotifiedRef = useRef(false);

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
            if (nextState === 'active' && driverChannelRef.current) {
                supabase.removeChannel(driverChannelRef.current);
                driverChannelRef.current = null;
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

        (async () => {
            let { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') return;
            
            let loc = await Location.getCurrentPositionAsync({});
            setLocation(loc);

            const locationSub = await Location.watchPositionAsync(
                { accuracy: Location.Accuracy.Balanced, distanceInterval: 10 },
                (newLoc) => setLocation(newLoc)
            );
            return () => locationSub.remove();
        })();

    // Signal staleness check
    useEffect(() => {
        if (!driver) return;

        signalCheckIntervalRef.current = setInterval(() => {
            const elapsed = Date.now() - lastLocationUpdateRef.current;

            if (elapsed > 180000 && signalStatus !== 'lost') {
                setSignalStatus('lost');
            } else if (elapsed > 30000 && signalStatus === 'ok') {
                setSignalStatus('stale');
                console.log('DRIVER SIGNAL: Stale - no update for 30s');
            }
        }, 15000);

        return () => {
            if (signalCheckIntervalRef.current) clearInterval(signalCheckIntervalRef.current);
        };
    }, [driver, signalStatus]);

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
            if (driverChannelRef.current) {
                supabase.removeChannel(driverChannelRef.current);
            }
            eventsChannel.unsubscribe();
            beforeRemoveListener();
        };
    }, []);

    useEffect(() => {
        if (updatedRide) {
            setRide((prev: any) => ({ ...prev, ...updatedRide }));
            if (updatedRide.status === 'completed' || updatedRide.status === 'closed') {
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
        if (ride?.status !== 'in_progress' || !aiSuggestionsEnabled) return;

        const pollAi = async () => {
            try {
                const { data, error } = await supabase.functions.invoke('ai_concierge_proactive', {
                    body: { 
                        ride_id: rideId, 
                        lat: location?.coords?.latitude, 
                        lng: location?.coords?.longitude,
                        destination_name: ride?.dropoff_address
                    }
                });
                if (data?.suggestion) {
                    setAiInsight(data.suggestion);
                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                }
            } catch (err) {
                console.warn("AI Proactive fetch failed:", err);
            }
        };

        const interval = setInterval(pollAi, 120000);
        pollAi();
        
        return () => clearInterval(interval);
    }, [ride?.status, location, aiSuggestionsEnabled]);

    const openWhatsAppSupport = () => {
        Linking.openURL('https://wa.me/18687031000?text=I+need+help+with+my+ride');
    };

    const handleCancelRide = () => {
        const feeApplies = ride?.status === 'assigned' || ride?.status === 'arrived';

        if (feeApplies) {
            Alert.alert(
                "Cancel this ride?",
                "Your driver has already accepted.\nA TTD 10.00 cancellation fee will apply.",
                [
                    { text: "Keep My Ride", style: "cancel" },
                    { text: "Cancel Anyway", style: "destructive", onPress: executeCancelRide }
                ]
            );
        } else {
            Alert.alert(
                "Cancel this ride?",
                "Are you sure you want to cancel?",
                [
                    { text: "No", style: "cancel" },
                    { text: "Yes, Cancel", style: "destructive", onPress: executeCancelRide }
                ]
            );
        }
    };

    const executeCancelRide = async () => {
        try {
            const { data, error } = await supabase.functions.invoke('cancel_ride', {
                body: { ride_id: rideId }
            });

            if (error) throw error;

            Alert.alert("Ride Cancelled", "Your ride has been cancelled.");
            navigation.replace('Home');
        } catch (err) {
            console.error('Cancel failed:', err);
            Alert.alert("Error", "Could not cancel ride. Please try again.");
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

            driverChannelRef.current = supabase.channel(`driver_loc_${data.driver?.id}`)
                .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'drivers', filter: `id=eq.${data.driver?.id}` }, (payload) => {
                    setDriverLocation({ latitude: payload.new.lat, longitude: payload.new.lng });
                    lastLocationUpdateRef.current = Date.now();
                    if (signalStatus !== 'ok') {
                        setSignalStatus('ok');
                        console.log('DRIVER SIGNAL: Restored');
                    }
                })
                .subscribe();
        }
    };

    const handleMusicSuggestion = async () => {
        if (!musicUrl.includes('spotify.com') && !musicUrl.includes('youtube.com') && !musicUrl.includes('youtu.be')) {
            Alert.alert("Invalid Link", "Please provide a valid Spotify or YouTube link.");
            return;
        }

        setIsMusicLoading(true);
        const { error } = await supabase
            .from('rides')
            .update({ 
                entertainment_url: musicUrl,
                entertainment_status: 'pending' 
            })
            .eq('id', rideId);
        
        if (!rideId) {
            Alert.alert("Error", "No active ride session found.");
            setIsMusicLoading(false);
            return;
        }

        setIsMusicLoading(false);
        if (error) {
            Alert.alert("Error", "Could not send suggestion.");
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
            const { error } = await supabase
                .from('rides')
                .update({ safe_entry: nextValue })
                .eq('id', rideId);
            
            if (!error) {
                setRide((prev: any) => ({ ...prev, safe_entry: nextValue }));
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                setAiInsight(nextValue ? "Safe Entry Mode ACTIVE. Driver is instructed to wait for you." : "Safe Entry Mode disabled.");
            }
        } catch (error) {
            console.error(error);
        }
    };

    const handleSOS = () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        Alert.alert("SOS EMERGENCY", "Trigger emergency assistance?", [
            { text: "Cancel", style: "cancel" },
            {
                text: "TRIGGER", style: "destructive", onPress: async () => {
                    setIsSosLoading(true);

                    try {
                        // FIX F9: Try G-Taxi emergency system first
                        if (rideId) {
                            const { data, error } = await supabase.functions.invoke('trigger_emergency', {
                                body: { ride_id: rideId }
                            });

                            if (error) throw error;

                            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                            Alert.alert("Emergency Triggered", "Security team notified. Help is on the way.");
                        } else {
                            throw new Error("No active ride found");
                        }
                    } catch (err) {
                        console.error("SOS failed:", err);

                        // FIX F9: FALLBACK to direct emergency dial
                        Alert.alert(
                            "Emergency Services",
                            "G-Taxi emergency system unavailable. Call emergency services directly?",
                            [
                                { text: "Cancel", style: "cancel" },
                                {
                                    text: "CALL 999", style: "destructive",
                                    onPress: () => Linking.openURL('tel:999')
                                },
                                {
                                    text: "WhatsApp Support", style: "default",
                                    onPress: () => Linking.openURL('https://wa.me/18687031000?text=EMERGENCY')
                                }
                            ]
                        );
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

    if (!ride) {
        return (
            <View style={{ flex: 1, backgroundColor: COLORS.bgPrimary, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
                <ActivityIndicator size="large" color={COLORS.purple} />
                <Text style={{ marginTop: 16, textAlign: 'center', color: COLORS.textMuted }}>Connecting to your ride...</Text>
            </View>
        );
    }

    return (
        <View style={s.root}>
            <StatusBar style="light" />

            {/* Dark Map with Blueberry Luxe Styling */}
            <MapView
                style={StyleSheet.absoluteFillObject}
                provider={PROVIDER_DEFAULT}
                customMapStyle={DARK_MAP_STYLE}
                initialRegion={{
                    latitude: ride?.pickup_lat || 10.66,
                    longitude: ride?.pickup_lng || -61.51,
                    latitudeDelta: 0.05,
                    longitudeDelta: 0.05,
                }}
                userInterfaceStyle="dark"
            >
                {ENV.MAPBOX_PUBLIC_TOKEN && (
                    <UrlTile
                        urlTemplate={`https://api.mapbox.com/styles/v1/mapbox/dark-v11/tiles/256/{z}/{x}/{y}@2x?access_token=${ENV.MAPBOX_PUBLIC_TOKEN}`}
                        shouldReplaceMapContent={true}
                    />
                )}

                {driverLocation && (
                    <DriverMarker coordinate={driverLocation} rotation={driver?.heading || 0} />
                )}
                {/* Pickup Marker */}
                <Marker coordinate={{ latitude: ride?.pickup_lat || 0, longitude: ride?.pickup_lng || 0 }}>
                    <View style={{
                        width: 14,
                        height: 14,
                        borderRadius: 7,
                        backgroundColor: COLORS.white,
                        borderWidth: 3,
                        borderColor: COLORS.purple,
                    }} />
                </Marker>
                {/* Destination Marker */}
                <Marker coordinate={{ latitude: ride?.dropoff_lat || 0, longitude: ride?.dropoff_lng || 0 }}>
                    <View style={{
                        width: 14,
                        height: 14,
                        borderRadius: 7,
                        backgroundColor: COLORS.white,
                        borderWidth: 3,
                        borderColor: COLORS.cyan,
                    }} />
                </Marker>
            </MapView>

            {signalStatus === 'stale' && (
                <View style={[s.signalBanner, { top: insets.top + 60 }]}>
                    <Ionicons name="cellular-outline" size={16} color="#0D0B1E" />
                    <Text style={s.signalBannerText}>
                        Driver signal temporarily lost. Last position shown.
                    </Text>
                </View>
            )}

            {signalStatus === 'lost' && (
                <View style={[s.signalBannerLost, { top: insets.top + 60 }]}>
                    <Ionicons name="warning" size={20} color={COLORS.white} />
                    <Text style={s.signalBannerLostText}>
                        We've lost contact with your driver.{'\n'}
                        Your trip is still active.
                    </Text>
                    <View style={s.signalButtons}>
                        <TouchableOpacity style={s.signalBtnPrimary} onPress={() => navigation.navigate('Chat', { rideId })}>
                            <Text style={s.signalBtnPrimaryText}>Contact Driver</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={s.signalBtnSecondary} onPress={openWhatsAppSupport}>
                            <Text style={s.signalBtnSecondaryText}>Call Support</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            )}

            {/* Status Badge - Top Center */}
            <Reanimated.View style={[s.statusBubble, statusStyle, { top: insets.top + 12 }]}>
                <View style={s.statusBadge}>
                    <View style={[s.statusDot, { 
                        backgroundColor: ride?.status === 'in_progress' ? COLORS.success : 
                                        ride?.status === 'arrived' ? COLORS.warning : COLORS.cyan 
                    }]} />
                    <Text style={s.statusText}>{ride?.status?.toUpperCase().replace('_', ' ')}</Text>
                </View>
            </Reanimated.View>

            {/* AI Concierge HUD */}
            {aiInsight && (
                <Reanimated.View entering={FadeInUp} style={[s.aiInsightHud, { top: insets.top + 70 }]}>
                    <BlurView intensity={20} tint="dark" style={s.aiInsightBlur}>
                        <LinearGradient 
                            colors={[COLORS.purple, COLORS.purpleDark]} 
                            style={s.aiInsightGradient}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 1 }}
                        >
                            <View style={{ flex: 1 }}>
                                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
                                    <Ionicons name="sparkles" size={14} color={COLORS.white} />
                                    <Text style={s.aiTitle}>G-TAXI AI CONCIERGE</Text>
                                </View>
                                <Text style={s.aiMessage}>{aiInsight}</Text>
                                
                                {aiInsight.toLowerCase().includes('stop') && (
                                    <TouchableOpacity 
                                        style={s.aiActionBtn}
                                        onPress={async () => {
                                            setAiInsight("Updating trip manifest... Navigation synced.");
                                            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                                            
                                            try {
                                                const { data, error } = await supabase.rpc('add_mid_ride_stop', {
                                                    p_ride_id: rideId,
                                                    p_place_name: 'ATM Stop',
                                                    p_lat: (ride?.dropoff_lat || 10.66) + 0.002,
                                                    p_lng: (ride?.dropoff_lng || -61.51) + 0.002,
                                                    p_address: 'Dynamic AI Suggested Stop'
                                                });
                                                if (error) throw error;
                                            } catch (err) {
                                                console.error("Failed to add mid-ride stop:", err);
                                                setAiInsight("Unable to add stop. Please try again.");
                                            }
                                        }}
                                    >
                                        <Text style={{ fontSize: 12, fontWeight: '800', color: COLORS.cyan }}>ADD TO TRIP</Text>
                                        <Ionicons name="arrow-forward-circle" size={16} color={COLORS.cyan} style={{ marginLeft: 4 }} />
                                    </TouchableOpacity>
                                )}
                            </View>
                            <TouchableOpacity onPress={() => setAiInsight(null)} style={{ padding: 4 }}>
                                <Ionicons name="close-circle" size={18} color="rgba(255,255,255,0.4)" />
                            </TouchableOpacity>
                        </LinearGradient>
                    </BlurView>
                </Reanimated.View>
            )}

            {/* Bottom Card - Glassmorphism */}
            <View style={[s.bottomCard, { paddingBottom: insets.bottom + 20 }]}>
                <BlurView intensity={20} tint="dark" style={s.cardBlur}>
                    <View style={s.handle} />

                    {/* Driver Info Row */}
                    <View style={s.driverRow}>
                        <View style={s.avatar}>
                            <Text style={s.avatarTxt}>{driver?.name?.charAt(0)}</Text>
                        </View>
                        <View style={{ flex: 1, marginLeft: 16 }}>
                            <Text style={s.driverName}>{driver?.name || 'Partner'}</Text>
                            <Text style={s.vehicleInfo}>{driver?.vehicle_model} · {driver?.plate_number}</Text>
                        </View>
                        {ride?.ride_pin && (
                            <View style={s.pinBadge}>
                                <Text style={s.pinLabel}>RIDE PIN</Text>
                                <Text style={s.pinValue}>{ride?.ride_pin}</Text>
                            </View>
                        )}
                        <TouchableOpacity style={s.sosBtn} onPress={handleSOS}>
                            <Reanimated.View style={[s.sosRing, sosAnim]} />
                            <Text style={s.sosLabel}>SOS</Text>
                        </TouchableOpacity>
                    </View>

                    {/* Wait Clock */}
                    {ride?.status === 'arrived' && ride?.arrived_at && (
                        <IsolatedWaitClock arrivedAt={ride?.arrived_at} setAiInsight={setAiInsight} />
                    )}

                    {/* Progress Track */}
                    <View style={s.track}>
                        <View style={[s.trackNode, step >= 1 && s.trackNodeActive]}>
                            <Ionicons name="location" size={12} color={step >= 1 ? COLORS.white : COLORS.textMuted} />
                        </View>
                        <View style={[s.trackLine, step >= 2 && s.trackLineActive]} />
                        <View style={[s.trackNode, step >= 2 && s.trackNodeActive]}>
                            <Ionicons name="car" size={12} color={step >= 2 ? COLORS.white : COLORS.textMuted} />
                        </View>
                        <View style={s.trackLine} />
                        <View style={s.trackNode}>
                            <Ionicons name="flag" size={12} color={COLORS.textMuted} />
                        </View>
                    </View>

                    {/* Action Buttons */}
                    <View style={s.actions}>
                        <TouchableOpacity style={s.msgBtn} onPress={() => navigation.navigate('Chat', { rideId, driver })}>
                            <Ionicons name="chatbubble-ellipses" size={20} color={COLORS.purple} />
                        </TouchableOpacity>
                        
                        <TouchableOpacity 
                            style={[s.msgBtn, { marginLeft: 8, borderColor: ride?.entertainment_status === 'accepted' ? COLORS.success : 'transparent' }]} 
                            onPress={() => setMusicModalVisible(true)}
                        >
                            <Ionicons 
                                name={ride?.entertainment_status === 'accepted' ? "musical-notes" : "musical-note-outline"} 
                                size={20} 
                                color={ride?.entertainment_status === 'accepted' ? COLORS.success : COLORS.purple} 
                            />
                        </TouchableOpacity>
                        
                        <TouchableOpacity 
                            style={[s.msgBtn, { marginLeft: 8, borderColor: COLORS.cyan, backgroundColor: 'rgba(0,229,255,0.05)' }]} 
                            onPress={handleShareMirror}
                        >
                            <Ionicons name="shield-checkmark" size={20} color={COLORS.cyan} />
                        </TouchableOpacity>

                        <TouchableOpacity 
                            style={[s.msgBtn, { marginLeft: 8, borderColor: ride?.safe_entry ? COLORS.success : 'transparent' }]} 
                            onPress={toggleSafeEntry}
                        >
                            <Ionicons name="home-outline" size={20} color={ride?.safe_entry ? COLORS.success : COLORS.purple} />
                        </TouchableOpacity>

                        <TouchableOpacity style={s.callBtn} onPress={() => driver?.phone_number && Linking.openURL(`tel:${driver.phone_number}`)}>
                            <Ionicons name="call" size={20} color={COLORS.purple} />
                            <Text style={s.callLabel}>Voice Call</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[s.msgBtn, { marginLeft: 8, borderColor: COLORS.error }]}
                            onPress={handleCancelRide}
                        >
                            <Ionicons name="close-circle" size={20} color={COLORS.error} />
                        </TouchableOpacity>
                    </View>
                </BlurView>
            </View>

            {/* Music Modal */}
            <Modal visible={musicModalVisible} transparent animationType="slide">
                <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={s.modalOverlay}>
                    <BlurView tint="dark" intensity={100} style={s.modalContent}>
                        <Text style={{ fontSize: 20, fontWeight: '800', color: COLORS.white, marginBottom: 12 }}>Music Suggestion</Text>
                        <Text style={{ fontSize: 14, color: COLORS.textMuted, textAlign: 'center', marginBottom: 24 }}>
                            Suggest a Spotify or YouTube link for the driver to play.
                        </Text>
                        <TextInput 
                            style={s.musicInput} 
                            placeholder="https://..." 
                            placeholderTextColor="rgba(255,255,255,0.3)"
                            value={musicUrl}
                            onChangeText={setMusicUrl}
                            autoFocus
                            autoCapitalize="none"
                        />
                        <View style={s.modalActions}>
                            <TouchableOpacity style={s.modalCancel} onPress={() => setMusicModalVisible(false)}>
                                <Text style={{ fontSize: 16, fontWeight: '800', color: COLORS.textMuted }}>Cancel</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={s.modalConfirm} onPress={handleMusicSuggestion} disabled={isMusicLoading}>
                                <Text style={{ fontSize: 16, fontWeight: '800', color: COLORS.white }}>{isMusicLoading ? 'Sending...' : 'Send'}</Text>
                            </TouchableOpacity>
                        </View>
                    </BlurView>
                </KeyboardAvoidingView>
            </Modal>
        </View>
    );
}

function IsolatedWaitClock({ arrivedAt, setAiInsight }: { arrivedAt: string, setAiInsight: any }) {
    const [stats, setStats] = useState({ mins: 0, cents: 0 });

    useEffect(() => {
        const timer = setInterval(() => {
            const diffMs = Date.now() - new Date(arrivedAt).getTime();
            const mins = Math.max(0, Math.floor(diffMs / 60000));
            const cents = Math.floor((diffMs / 60000) * 90);
            setStats({ mins, cents });

            if (mins === 4 && stats.mins !== 4) {
                setAiInsight("Wait fee is now active ($0.90/min). Your driver is still waiting.");
            }
        }, 1000);
        return () => clearInterval(timer);
    }, [arrivedAt, stats.mins]);

    return (
        <View style={s.waitClockRow}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="time" size={16} color={COLORS.warning} />
                <Text style={s.lateFeeValue}>LATE FEE: TTD ${ (stats.cents / 100).toFixed(2) }</Text>
            </View>
            <Text style={s.lateFeeLabel}>{stats.mins}m elapsed</Text>
        </View>
    );
}

const s = StyleSheet.create({
    // Root
    root: { flex: 1, backgroundColor: COLORS.bgPrimary },

    // Status Badge
    statusBubble: { 
        position: 'absolute', 
        alignSelf: 'center', 
        zIndex: 100,
    },
    statusBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 16,
        paddingVertical: 10,
        backgroundColor: 'rgba(22,11,50,0.9)',
        borderRadius: 20,
        borderWidth: 1,
        borderColor: COLORS.glassBorder,
        shadowColor: COLORS.purple,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 6,
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

    // AI Insight HUD
    aiInsightHud: { 
        width: width * 0.9, 
        alignSelf: 'center', 
        position: 'absolute', 
        zIndex: 90,
    },
    aiInsightBlur: {
        borderRadius: 20,
        overflow: 'hidden',
    },
    aiInsightGradient: { 
        flexDirection: 'row', 
        alignItems: 'center', 
        padding: 14, 
        borderRadius: 20,
        borderWidth: 1, 
        borderColor: 'rgba(0,229,255,0.2)',
    },
    aiTitle: { 
        marginLeft: 6, 
        fontSize: 10, 
        fontWeight: '800', 
        color: COLORS.white, 
        letterSpacing: 1,
    },
    aiMessage: { 
        fontSize: 13, 
        fontWeight: '500', 
        color: COLORS.white, 
        lineHeight: 18,
        marginTop: 2,
    },
    aiActionBtn: { 
        flexDirection: 'row', 
        alignItems: 'center', 
        backgroundColor: 'rgba(0,229,255,0.1)', 
        borderColor: 'rgba(0,229,255,0.3)', 
        borderWidth: 1,
        borderRadius: 12, 
        paddingVertical: 6, 
        paddingHorizontal: 12, 
        marginTop: 10, 
        alignSelf: 'flex-start',
    },

    // Bottom Card
    bottomCard: { 
        position: 'absolute', 
        bottom: 0, 
        left: 0, 
        right: 0, 
        paddingHorizontal: 20,
    },
    cardBlur: { 
        padding: 24, 
        backgroundColor: 'rgba(22,11,50,0.85)',
        borderRadius: 28,
        borderWidth: 1,
        borderColor: COLORS.glassBorder,
        shadowColor: COLORS.purple,
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.2,
        shadowRadius: 12,
        elevation: 8,
        overflow: 'hidden',
    },
    handle: { 
        width: 40, 
        height: 4, 
        borderRadius: 2, 
        backgroundColor: 'rgba(255,255,255,0.2)', 
        alignSelf: 'center', 
        marginBottom: 20,
    },

    // Driver Row
    driverRow: { 
        flexDirection: 'row', 
        alignItems: 'center', 
        marginBottom: 24,
    },
    avatar: { 
        width: 56, 
        height: 56, 
        borderRadius: 16, 
        backgroundColor: COLORS.purple, 
        alignItems: 'center', 
        justifyContent: 'center',
        shadowColor: COLORS.purple,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
    },
    avatarTxt: { 
        fontSize: 24, 
        fontWeight: '800', 
        color: COLORS.white,
    },
    driverName: { 
        fontSize: 20, 
        fontWeight: '800', 
        color: COLORS.white,
        letterSpacing: -0.5,
    },
    vehicleInfo: { 
        fontSize: 13, 
        fontWeight: '500', 
        color: COLORS.textSecondary,
        marginTop: 2,
    },

    // PIN Badge
    pinBadge: { 
        flex: 1, 
        alignItems: 'center', 
        marginHorizontal: 12, 
        paddingVertical: 8, 
        backgroundColor: 'rgba(0,229,255,0.05)', 
        borderRadius: 16, 
        borderWidth: 1, 
        borderColor: 'rgba(0,229,255,0.15)',
    },
    pinLabel: { 
        fontSize: 10, 
        fontWeight: '600', 
        color: COLORS.textMuted, 
        letterSpacing: 1,
    },
    pinValue: { 
        fontSize: 28, 
        fontWeight: '800', 
        color: COLORS.cyan, 
        letterSpacing: 3,
        marginTop: 2,
    },

    // SOS Button
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
    sosLabel: { 
        fontSize: 12, 
        fontWeight: '800', 
        color: COLORS.white,
        letterSpacing: 0.5,
    },
    sosRing: { 
        position: 'absolute', 
        width: 56, 
        height: 56, 
        borderRadius: 16, 
        borderWidth: 2, 
        borderColor: COLORS.error, 
        opacity: 0.3,
    },

    // Progress Track
    track: { 
        flexDirection: 'row', 
        alignItems: 'center', 
        justifyContent: 'space-between', 
        marginBottom: 28, 
        paddingHorizontal: 10,
    },
    trackNode: { 
        width: 24, 
        height: 24, 
        borderRadius: 12, 
        backgroundColor: COLORS.glassBg, 
        alignItems: 'center', 
        justifyContent: 'center', 
        borderWidth: 1, 
        borderColor: COLORS.glassBorder,
    },
    trackNodeActive: { 
        backgroundColor: COLORS.purple, 
        borderColor: COLORS.purpleLight,
    },
    trackLine: { 
        flex: 1, 
        height: 2, 
        backgroundColor: COLORS.glassBg, 
        marginHorizontal: 4,
    },
    trackLineActive: { 
        backgroundColor: COLORS.purple,
    },

    // Action Buttons
    actions: { 
        flexDirection: 'row', 
        gap: 10,
    },
    msgBtn: { 
        width: 52, 
        height: 52, 
        borderRadius: 14, 
        backgroundColor: 'rgba(123,92,240,0.1)', 
        alignItems: 'center', 
        justifyContent: 'center', 
        borderWidth: 1, 
        borderColor: 'rgba(123,92,240,0.2)',
    },
    callBtn: { 
        flex: 1, 
        height: 52, 
        borderRadius: 14, 
        backgroundColor: 'rgba(123,92,240,0.1)', 
        flexDirection: 'row', 
        alignItems: 'center', 
        justifyContent: 'center', 
        borderWidth: 1, 
        borderColor: 'rgba(123,92,240,0.2)',
        gap: 8,
    },
    callLabel: { 
        fontSize: 15, 
        fontWeight: '700', 
        color: COLORS.purple,
        letterSpacing: 0.5,
    },

    // Wait Clock
    waitClockRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        backgroundColor: 'rgba(245,158,11,0.08)',
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderRadius: 16,
        marginBottom: 20,
        borderWidth: 1,
        borderColor: 'rgba(245,158,11,0.2)',
    },
    lateFeeValue: { 
        fontSize: 15, 
        fontWeight: '800', 
        color: COLORS.warning,
        letterSpacing: 0.5,
    },
    lateFeeLabel: { 
        fontSize: 13, 
        fontWeight: '500', 
        color: COLORS.textMuted,
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
        alignItems: 'center', 
        borderWidth: 1, 
        borderColor: COLORS.glassBorder, 
        overflow: 'hidden',
        backgroundColor: COLORS.bgSecondary,
    },
    musicInput: { 
        width: '100%', 
        height: 56, 
        backgroundColor: 'rgba(255,255,255,0.05)', 
        borderRadius: 14, 
        paddingHorizontal: 16, 
        color: COLORS.white, 
        marginBottom: 20, 
        borderWidth: 1, 
        borderColor: 'rgba(255,255,255,0.1)',
        fontSize: 16,
    },
    modalActions: { 
        flexDirection: 'row', 
        gap: 12, 
        width: '100%',
    },
    modalCancel: { 
        flex: 1, 
        height: 50, 
        alignItems: 'center', 
        justifyContent: 'center',
        borderRadius: 14,
    },
    modalConfirm: {
        flex: 2,
        height: 50,
        backgroundColor: COLORS.purple,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: COLORS.purple,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 4,
    },

    signalBanner: {
        position: 'absolute',
        left: 20,
        right: 20,
        backgroundColor: 'rgba(245, 158, 11, 0.9)',
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderRadius: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        zIndex: 100,
    },
    signalBannerText: {
        color: '#0D0B1E',
        fontSize: 13,
        fontWeight: '700',
        flex: 1,
    },
    signalBannerLost: {
        position: 'absolute',
        left: 20,
        right: 20,
        backgroundColor: 'rgba(239, 68, 68, 0.95)',
        padding: 20,
        borderRadius: 16,
        alignItems: 'center',
        zIndex: 100,
    },
    signalBannerLostText: {
        color: COLORS.white,
        fontSize: 14,
        fontWeight: '700',
        textAlign: 'center',
        marginBottom: 16,
        lineHeight: 20,
    },
    signalButtons: {
        flexDirection: 'row',
        gap: 12,
    },
    signalBtnPrimary: {
        backgroundColor: COLORS.white,
        paddingVertical: 12,
        paddingHorizontal: 20,
        borderRadius: 12,
    },
    signalBtnPrimaryText: {
        color: '#EF4444',
        fontSize: 14,
        fontWeight: '800',
    },
    signalBtnSecondary: {
        backgroundColor: 'rgba(255,255,255,0.2)',
        paddingVertical: 12,
        paddingHorizontal: 20,
        borderRadius: 12,
    },
    signalBtnSecondaryText: {
        color: COLORS.white,
        fontSize: 14,
        fontWeight: '700',
    },
});
