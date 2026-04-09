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
import { GlassCard, InfoChip, StatusBadge, BRAND, VOICES, RADIUS, GRADIENTS, SEMANTIC } from '../design-system';
import { Txt } from '../design-system/primitives';

const { width, height } = Dimensions.get('window');

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
                <Reanimated.View style={[pulseStyle, s.pulseRing]} />
                <View style={s.markerDot} />
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
    const [musicModalVisible, setMusicModalVisible] = useState(false);
    const [musicUrl, setMusicUrl] = useState('');
    const [isMusicLoading, setIsMusicLoading] = useState(false);
    const [location, setLocation] = useState<Location.LocationObject | null>(null);

    const driverChannelRef = useRef<any>(null);

    const { rideUpdate: updatedRide } = useRideSubscription(rideId);

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
            }
        }
    }, [updatedRide]);

    useEffect(() => {
        if (ride?.status !== 'in_progress') return;

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
    }, [ride?.status, location]);

    const fetchInitialData = async () => {
        const { data } = await supabase
            .from('rides')
            .select(`
                *,
                driver:driver_id(
                    id, name, vehicle_model, plate_number, vehicle_type, rating, lat, lng
                )
            `)
            .eq('id', rideId)
            .single();

        if (data) {
            setRide(data);
            setDriver(data.driver);
            setDriverLocation({ latitude: data.driver?.lat, longitude: data.driver?.lng });

            driverChannelRef.current = supabase.channel(`driver_loc_${data.driver?.id}`)
                .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'drivers', filter: `id=eq.${data.driver?.id}` }, (payload) => {
                    setDriverLocation({ latitude: payload.new.lat, longitude: payload.new.lng });
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
                    if (rideId) {
                        await supabase.functions.invoke('trigger_emergency', { body: { ride_id: rideId } });
                        Alert.alert("Success", "Security notified.");
                    } else {
                        Alert.alert("Error", "No active ride found to trigger SOS.");
                    }
                    setIsSosLoading(false);
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
            <View style={{ flex: 1, backgroundColor: VOICES.rider.bg, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
                <ActivityIndicator size="large" color={BRAND.purple} />
                <Text style={{ marginTop: 16, textAlign: 'center', color: VOICES.rider.textMuted }}>Connecting to your ride...</Text>
            </View>
        );
    }

    return (
        <View style={s.root}>
            <StatusBar style="dark" />

            <MapView
                style={StyleSheet.absoluteFillObject}
                provider={PROVIDER_DEFAULT}
                initialRegion={{
                    latitude: ride?.pickup_lat || 10.66,
                    longitude: ride?.pickup_lng || -61.51,
                    latitudeDelta: 0.05,
                    longitudeDelta: 0.05,
                }}
                userInterfaceStyle="light"
            >
                {ENV.MAPBOX_PUBLIC_TOKEN && (
                    <UrlTile
                        urlTemplate={`https://api.mapbox.com/styles/v1/mapbox/light-v11/tiles/256/{z}/{x}/{y}@2x?access_token=${ENV.MAPBOX_PUBLIC_TOKEN}`}
                        shouldReplaceMapContent={true}
                    />
                )}

                {driverLocation && (
                    <DriverMarker coordinate={driverLocation} rotation={driver?.heading || 0} />
                )}
                <Marker coordinate={{ latitude: ride?.pickup_lat || 0, longitude: ride?.pickup_lng || 0 }}>
                    <View style={s.riderMarker} />
                </Marker>
                <Marker coordinate={{ latitude: ride?.dropoff_lat || 0, longitude: ride?.dropoff_lng || 0 }}>
                    <View style={s.destMarker} />
                </Marker>
            </MapView>

            <Reanimated.View style={[s.statusBubble, statusStyle, { top: insets.top + 10 }]}>
                <StatusBadge status={getStatusType()} label={ride?.status?.toUpperCase()} />
            </Reanimated.View>

            {aiInsight && (
                <Reanimated.View entering={FadeInUp} style={[s.aiInsightHud, { top: insets.top + 72 }]}>
                    <LinearGradient 
                        colors={[BRAND.purple, BRAND.purpleDark]} 
                        style={s.aiInsightGradient} 
                        start={GRADIENTS.primaryStart} 
                        end={GRADIENTS.primaryEnd}
                    >
                        <View style={{ flex: 1 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
                                <Ionicons name="sparkles" size={14} color="#FFF" />
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
                                    <Text style={{ fontSize: 12, fontWeight: '800', color: BRAND.cyan }}>ADD TO TRIP</Text>
                                    <Ionicons name="arrow-forward-circle" size={16} color={BRAND.cyan} style={{ marginLeft: 4 }} />
                                </TouchableOpacity>
                            )}
                        </View>
                        <TouchableOpacity onPress={() => setAiInsight(null)} style={{ padding: 4 }}>
                            <Ionicons name="close-circle" size={18} color="rgba(255,255,255,0.4)" />
                        </TouchableOpacity>
                    </LinearGradient>
                </Reanimated.View>
            )}

            <View style={[s.bottomCard, { paddingBottom: insets.bottom + 20 }]}>
                <GlassCard variant="rider" style={s.cardBlur}>
                    <View style={s.handle} />

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

                    {ride?.status === 'arrived' && ride?.arrived_at && (
                        <IsolatedWaitClock arrivedAt={ride?.arrived_at} setAiInsight={setAiInsight} />
                    )}

                    <View style={s.track}>
                        <View style={[s.trackNode, step >= 1 && s.trackNodeActive]}>
                            <Ionicons name="location" size={12} color={step >= 1 ? "#FFF" : VOICES.rider.textMuted} />
                        </View>
                        <View style={[s.trackLine, step >= 2 && s.trackLineActive]} />
                        <View style={[s.trackNode, step >= 2 && s.trackNodeActive]}>
                            <Ionicons name="car" size={12} color={step >= 2 ? "#FFF" : VOICES.rider.textMuted} />
                        </View>
                        <View style={s.trackLine} />
                        <View style={s.trackNode}>
                            <Ionicons name="flag" size={12} color={VOICES.rider.textMuted} />
                        </View>
                    </View>

                    <View style={s.actions}>
                        <TouchableOpacity style={s.msgBtn} onPress={() => navigation.navigate('Chat', { rideId, driver })}>
                            <Ionicons name="chatbubble-ellipses" size={20} color={BRAND.purple} />
                        </TouchableOpacity>
                        
                        <TouchableOpacity 
                            style={[s.msgBtn, { marginLeft: 8, borderColor: ride?.entertainment_status === 'accepted' ? SEMANTIC.success : 'transparent' }]} 
                            onPress={() => setMusicModalVisible(true)}
                        >
                            <Ionicons 
                                name={ride?.entertainment_status === 'accepted' ? "musical-notes" : "musical-note-outline"} 
                                size={20} 
                                color={ride?.entertainment_status === 'accepted' ? SEMANTIC.success : BRAND.purple} 
                            />
                        </TouchableOpacity>
                        
                        <TouchableOpacity 
                            style={[s.msgBtn, { marginLeft: 8, borderColor: BRAND.cyan, backgroundColor: 'rgba(0,255,255,0.05)' }]} 
                            onPress={handleShareMirror}
                        >
                            <Ionicons name="shield-checkmark" size={20} color={BRAND.cyan} />
                        </TouchableOpacity>

                        <TouchableOpacity 
                            style={[s.msgBtn, { marginLeft: 8, borderColor: ride?.safe_entry ? SEMANTIC.success : 'transparent' }]} 
                            onPress={toggleSafeEntry}
                        >
                            <Ionicons name="home-outline" size={20} color={ride?.safe_entry ? SEMANTIC.success : BRAND.purple} />
                        </TouchableOpacity>

                        <TouchableOpacity style={s.callBtn} onPress={() => driver?.phone_number && Linking.openURL(`tel:${driver.phone_number}`)}>
                            <Ionicons name="call" size={20} color={BRAND.purple} />
                            <Text style={s.callLabel}>Voice Call</Text>
                        </TouchableOpacity>
                    </View>
                </GlassCard>
            </View>

            <Modal visible={musicModalVisible} transparent animationType="slide">
                <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={s.modalOverlay}>
                    <BlurView tint="dark" intensity={100} style={s.modalContent}>
                        <Text style={{ fontSize: 20, fontWeight: '800', color: '#FFF', marginBottom: 12 }}>Music Suggestion</Text>
                        <Text style={{ fontSize: 14, color: VOICES.rider.textMuted, textAlign: 'center', marginBottom: 24 }}>
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
                                <Text style={{ fontSize: 16, fontWeight: '800', color: VOICES.rider.textMuted }}>Cancel</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={s.modalConfirm} onPress={handleMusicSuggestion} disabled={isMusicLoading}>
                                <Text style={{ fontSize: 16, fontWeight: '800', color: '#FFF' }}>{isMusicLoading ? 'Sending...' : 'Send'}</Text>
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
                <Ionicons name="time" size={16} color={SEMANTIC.warning} />
                <Text style={s.lateFeeValue}>LATE FEE: TTD ${ (stats.cents / 100).toFixed(2) }</Text>
            </View>
            <Text style={s.lateFeeLabel}>{stats.mins}m elapsed</Text>
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: VOICES.rider.bg },
    pulseRing: { position: 'absolute', width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(0,255,255,0.3)' },
    markerDot: { width: 14, height: 14, borderRadius: 7, backgroundColor: BRAND.cyan, borderWidth: 2, borderColor: '#FFF' },
    riderMarker: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#FFF', borderWidth: 3, borderColor: BRAND.purple },
    destMarker: { width: 12, height: 12, backgroundColor: '#FFF', borderWidth: 3, borderColor: SEMANTIC.warning },

    statusBubble: { position: 'absolute', alignSelf: 'center', zIndex: 100 },
    
    bottomCard: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 20 },
    cardBlur: { padding: 24, backgroundColor: 'rgba(255,255,255,0.85)' },
    handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(30,30,63,0.1)', alignSelf: 'center', marginBottom: 20 },

    driverRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 28 },
    avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: BRAND.purple, alignItems: 'center', justifyContent: 'center' },
    avatarTxt: { fontSize: 24, fontWeight: '800', color: '#FFF' },
    driverName: { fontSize: 20, fontWeight: '800', color: VOICES.rider.text },
    vehicleInfo: { fontSize: 13, fontWeight: '300', color: VOICES.rider.textMuted },
    
    pinBadge: { flex: 1, alignItems: 'center', marginHorizontal: 16, paddingVertical: 8, backgroundColor: 'rgba(0,255,255,0.05)', borderRadius: RADIUS.md, borderWidth: 1, borderColor: 'rgba(0,255,255,0.15)' },
    pinLabel: { fontSize: 10, fontWeight: '300', color: BRAND.cyanSoft, letterSpacing: 1 },
    pinValue: { fontSize: 32, fontWeight: '800', color: BRAND.cyan, letterSpacing: 4 },
    
    sosBtn: { width: 56, height: 56, borderRadius: 28, backgroundColor: SEMANTIC.danger, alignItems: 'center', justifyContent: 'center' },
    sosLabel: { fontSize: 12, fontWeight: '800', color: '#FFF' },
    sosRing: { position: 'absolute', width: 56, height: 56, borderRadius: 28, borderWidth: 2, borderColor: SEMANTIC.danger, opacity: 0.3 },

    track: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32, paddingHorizontal: 10 },
    trackNode: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#FFF', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(124, 58, 237, 0.1)' },
    trackNodeActive: { backgroundColor: BRAND.purple, borderColor: BRAND.purpleLight },
    trackLine: { flex: 1, height: 2, backgroundColor: 'rgba(124, 58, 237, 0.1)', marginHorizontal: 4 },
    trackLineActive: { backgroundColor: BRAND.purple },

    actions: { flexDirection: 'row', gap: 12 },
    msgBtn: { width: 54, height: 54, borderRadius: 16, backgroundColor: 'rgba(124, 58, 237, 0.05)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(124, 58, 237, 0.1)' },
    callBtn: { flex: 1, height: 54, borderRadius: 16, backgroundColor: 'rgba(124, 58, 237, 0.05)', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(124, 58, 237, 0.1)' },
    callLabel: { marginLeft: 8, fontSize: 16, fontWeight: '600', color: BRAND.purple },

    waitClockRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        backgroundColor: 'rgba(245,158,11,0.05)',
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderRadius: RADIUS.md,
        marginBottom: 20,
        borderWidth: 1,
        borderColor: 'rgba(245,158,11,0.1)',
    },
    lateFeeValue: { fontSize: 15, fontWeight: '700', color: SEMANTIC.warning },
    lateFeeLabel: { fontSize: 12, fontWeight: '300', color: VOICES.rider.textMuted },

    aiInsightHud: { width: width * 0.9, alignSelf: 'center', position: 'absolute', zIndex: 90 },
    aiInsightGradient: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: RADIUS.md, borderWidth: 1, borderColor: 'rgba(0,255,255,0.2)' },
    aiTitle: { marginLeft: 6, fontSize: 10, fontWeight: '800', color: '#FFF', letterSpacing: 1 },
    aiMessage: { fontSize: 13, fontWeight: '300', color: '#FFF', lineHeight: 18 },
    aiActionBtn: { 
        flexDirection: 'row', alignItems: 'center', 
        backgroundColor: 'rgba(0,255,255,0.1)', borderColor: 'rgba(0,255,255,0.3)', borderWidth: 1,
        borderRadius: 12, paddingVertical: 6, paddingHorizontal: 12, marginTop: 10, alignSelf: 'flex-start'
    },
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', padding: 20 },
    modalContent: { padding: 32, borderRadius: RADIUS.lg, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', overflow: 'hidden' },
    musicInput: { width: '100%', height: 60, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 16, paddingHorizontal: 16, color: '#FFF', marginBottom: 24, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
    modalActions: { flexDirection: 'row', gap: 12, width: '100%' },
    modalCancel: { flex: 1, height: 50, alignItems: 'center', justifyContent: 'center' },
    modalConfirm: { flex: 2, height: 50, backgroundColor: BRAND.purple, borderRadius: RADIUS.pill, alignItems: 'center', justifyContent: 'center' },
});
