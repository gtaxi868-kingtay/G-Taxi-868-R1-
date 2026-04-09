import React, { useEffect, useState, useRef } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity, Image,
    Dimensions, Alert, Platform
} from 'react-native';
import MapView, { Marker, PROVIDER_DEFAULT, UrlTile } from 'react-native-maps';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Reanimated, {
    useSharedValue, withSpring, withTiming,
    useAnimatedStyle, withDelay,
    FadeIn, FadeOut,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { DEFAULT_LOCATION, ENV } from '../../../../shared/env';
import { useAuth } from '../context/AuthContext';
import { useNearbyDrivers } from '../hooks/useNearbyDrivers';
import { supabase } from '../../../../shared/supabase';
import { 
    GlassCard, PrimaryButton, InfoChip, 
    BRAND, VOICES, RADIUS, Logo,
    GRADIENTS, SEMANTIC // Added GRADIENTS, SEMANTIC
} from '../design-system';
import { Txt, Card } from '../design-system/primitives'; // Added Card
import { Sidebar } from '../components/Sidebar';
import { getSavedPlaces, savePlace, getRecentRides } from '../services/api';
import { SavedPlace, Location as RideLocation } from '../types/ride';
import { SavedPlaceModal } from '../components/SavedPlaceModal';
import { RecentRidesModal } from '../components/RecentRidesModal';

const { width, height } = Dimensions.get('window');
const CAR_ASSET = require('../../assets/images/car_gtaxi_standard_v7.png');

export function HomeScreen({ navigation }: any) {
    const insets = useSafeAreaInsets();
    const { profile } = useAuth();

    // State
    const [location, setLocation] = useState<Location.LocationObject | null>(null);
    const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([]);
    const [recentRides, setRecentRides] = useState<RideLocation[]>([]);
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [featureFlags, setFeatureFlags] = useState({ grocery: false, laundry: false });
    const [systemStatus, setSystemStatus] = useState<any>({ stripe_ready: true, mapbox_ready: true, config: {} });
    const [activeModalLabel, setActiveModalLabel] = useState<string | null>(null);
    const [showRecentModal, setShowRecentModal] = useState(false);
    const [aiGreeting, setAiGreeting] = useState<string | null>(null);
    const [isAiThinking, setIsAiThinking] = useState(false);
    const [proactiveAction, setProactiveAction] = useState<string | null>(null);
    const [visionLoading, setVisionLoading] = useState(false);

    const panelY = useSharedValue(120);
    const mapPitch = useSharedValue(45);

    useEffect(() => {
        // 0. SECONDARY ACTIVE RIDE GUARD (Fail-safe)
        const checkActiveRide = async () => {
            try {
                const { getActiveRide } = await import('../services/api');
                const res = await getActiveRide();
                if (res.success && res.data) {
                    console.log('HomeScreen: Active ride detected. Redirecting for safety.');
                    // Navigation will be handled by ActiveRideRestorationHandler at root,
                    // but we can trigger a manual navigation here as a backup if needed.
                    // However, to avoid double-reset, we rely on the Root Handler primarily.
                }
            } catch (e) {}
        };
        checkActiveRide();

        (async () => {
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status === 'granted') {
                const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
                setLocation(current);
            }
        })();

        // Fetch Places
        fetchPlaces();

        // Fetch & Subscribe to Feature Flags
        const fetchFlags = async () => {
            const { data } = await supabase.from('system_feature_flags').select('id, is_active');
            if (data) {
                const flags = { grocery: false, laundry: false };
                data.forEach(f => {
                    if (f.id === 'grocery_module') flags.grocery = f.is_active;
                    if (f.id === 'laundry_module') flags.laundry = f.is_active;
                });
                setFeatureFlags(flags);
            }
        };
        fetchFlags();

        const flagsChannel = supabase
            .channel('feature-flags-realtime')
            .on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'system_feature_flags' },
                () => {
                    console.log('Feature flags updated. Re-fetching...');
                    fetchFlags();
                }
            )
            .subscribe();

        // Fetch System Status (Diagnostics)
        const fetchStatus = async () => {
            try {
                const { data, error } = await supabase.functions.invoke('get_system_status');
                if (!error && data?.success) {
                    setSystemStatus(data.data);
                }
            } catch (err) {
                console.warn('System status check failed:', err);
            }
        };
        fetchStatus();

        // --- 100% READY AI: PERSISTENT BRAIN (Truth Layer) ---
        const fetchLatestInsight = async () => {
            if (!profile?.id) return;
            const { data } = await supabase
                .from('ride_events')
                .select('metadata, created_at')
                .eq('event_type', 'ai_insight')
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (data?.metadata?.message) {
                setAiGreeting(data.metadata.message);
                if (data.metadata.proactive) {
                    setProactiveAction(data.metadata.proactive);
                }
            } else {
                // Fallback to Time-of-Day Greeting if no DB events
                const now = new Date();
                const hour = now.getHours();
                const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
                setAiGreeting(`${greeting}, ${profile?.name?.split(' ')[0] || 'Partner'}! Ready to roll?`);
            }
        };

        fetchLatestInsight();

        const eventsChannel = supabase
            .channel('ai-insights-realtime')
            .on(
                'postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'ride_events', filter: `event_type=eq.ai_insight` },
                (payload: any) => {
                    if (payload.new?.metadata?.message) {
                        setAiGreeting(payload.new.metadata.message);
                        if (payload.new.metadata.proactive) {
                            setProactiveAction(payload.new.metadata.proactive);
                        }
                        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                    }
                }
            )
            .subscribe();

        // Animations
        panelY.value = withSpring(0, { damping: 18, stiffness: 120 });
        mapPitch.value = withDelay(1000, withTiming(30, { duration: 1500 }));

        return () => {
            flagsChannel.unsubscribe();
            eventsChannel.unsubscribe();
        };
    }, []);

    const fetchPlaces = async () => {
        const places = await getSavedPlaces();
        setSavedPlaces(places);
    };

    const currentLat = location?.coords.latitude || DEFAULT_LOCATION.latitude;
    const currentLng = location?.coords.longitude || DEFAULT_LOCATION.longitude;
    const { drivers: realtimeDrivers } = useNearbyDrivers(currentLat, currentLng);

    // BUG_FIX 1: Sidebar uses profile?.name correctly (already handled in prop)
    // BUG_FIX 2: Real geocoding in save
    const handleSavePlace = async (label: string, address: string) => {
        try {
            const { data, error } = await supabase.functions.invoke("geocode", { body: { address } });
            if (error || !data?.latitude) {
                Alert.alert("Error", "Could not find address");
                return;
            }
            await savePlace({
                label, address,
                lat: data.latitude,
                lng: data.longitude,
                icon: label === 'Home' ? 'home-outline' : 'briefcase-outline'
            });
            fetchPlaces();
        } catch (err) {
            Alert.alert("Error", "Save failed");
        }
    };

    const handleVoiceComplete = async (text: string) => {
        if (!profile?.id || !text) return;
        setIsAiThinking(true);
        setAiGreeting("ANALYZING COMMAND...");

        try {
            const { data, error } = await supabase.functions.invoke('handle_voice', {
                body: { text, rider_id: profile.id }
            });

            if (data?.success) {
                setAiGreeting(data.reply);
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

                if (data.intent === 'book_ride' && data.destination) {
                    // AUTO-NAVIGATE to ride confirmation
                    setTimeout(() => {
                        navigation.navigate('RideConfirmation', {
                            destination: { 
                                latitude: data.destination.lat, 
                                longitude: data.destination.lng, 
                                address: data.destination.address 
                            },
                            pickup: { 
                                latitude: currentLat, 
                                longitude: currentLng, 
                                address: 'Current Location' 
                            }
                        });
                    }, 1500);
                }
            } else {
                setAiGreeting("Sorry, I couldn't process that command.");
            }
        } catch (err) {
            setAiGreeting("Connection failed. Please try again.");
        } finally {
            setIsAiThinking(false);
        }
    };

    const handleVisionSighting = async () => {
        try {
            const { status } = await ImagePicker.requestCameraPermissionsAsync();
            if (status !== 'granted') {
                Alert.alert("Permission Required", "Please allow camera access to use AI Sight.");
                return;
            }

            const result = await ImagePicker.launchCameraAsync({
                mediaTypes: ImagePicker.MediaTypeOptions.Images,
                allowsEditing: false,
                quality: 0.5,
                base64: true,
            });

            if (result.canceled || !result.assets[0].base64) return;

            setVisionLoading(true);
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

            const currentPos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
            
            const { data, error } = await supabase.functions.invoke('vision_pickup', {
                body: { 
                    image: result.assets[0].base64,
                    lat: currentPos.coords.latitude,
                    lng: currentPos.coords.longitude
                }
            });

            if (error || !data?.success) {
                throw new Error(data?.error || "Could not identify location");
            }

            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            
            // Navigate to RideConfirmation
            navigation.navigate('RideConfirmation', {
                destination: { 
                    latitude: data.refined_lat, 
                    longitude: data.refined_lng, 
                    address: data.landmark_name || data.address 
                },
                pickup: { 
                    latitude: currentPos.coords.latitude, 
                    longitude: currentPos.coords.longitude, 
                    address: 'Your Location' 
                }
            });

        } catch (err: any) {
            console.error("Vision Error:", err);
            Alert.alert("AI Sight Failed", err.message || "We couldn't pinpoint your location. Please type your destination.");
        } finally {
            setVisionLoading(false);
        }
    };

    const handleQuickAction = async (label: string) => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        if (label === 'Home' || label === 'Work') {
            const place = savedPlaces.find(p => p.label === label);
            if (place) {
                navigation.navigate('RideConfirmation', {
                    destination: { latitude: place.lat, longitude: place.lng, address: place.address },
                    pickup: { latitude: currentLat, longitude: currentLng, address: 'Current Location' }
                });
            } else {
                setActiveModalLabel(label);
            }
        } else if (label === 'Recent') {
            const recents = await getRecentRides();
            setRecentRides(recents);
            setShowRecentModal(true);
        }
    };

    const animatedPanel = useAnimatedStyle(() => ({
        transform: [{ translateY: panelY.value }]
    }));

    return (
        <View style={s.root}>
            <StatusBar style="light" />

            {/* MAP: PROVIDER_DEFAULT + Mapbox UrlTile dark-v11 */}
            <MapView
                style={s.map}
                provider={PROVIDER_DEFAULT}
                initialRegion={{
                    latitude: currentLat,
                    longitude: currentLng,
                    latitudeDelta: 0.015,
                    longitudeDelta: 0.015,
                }}
                showsUserLocation
                userInterfaceStyle="dark"
            >
                {ENV.MAPBOX_PUBLIC_TOKEN && (
                    <UrlTile
                        urlTemplate={`https://api.mapbox.com/styles/v1/mapbox/dark-v11/tiles/256/{z}/{x}/{y}@2x?access_token=${ENV.MAPBOX_PUBLIC_TOKEN}`}
                        shouldReplaceMapContent={true}
                    />
                )}

                {realtimeDrivers.map(d => (
                    <Marker
                        key={d.id}
                        coordinate={{ latitude: (d.lat as any) || 0, longitude: (d.lng as any) || 0 }}
                        anchor={{ x: 0.5, y: 0.5 }}
                        rotation={d.heading || 0}
                    >
                        <Image source={CAR_ASSET} style={s.carMarker} resizeMode="contain" />
                    </Marker>
                ))}
            </MapView>

            <LinearGradient colors={['rgba(22, 11, 50, 0.9)', 'rgba(47, 26, 92, 0.4)', 'rgba(22, 11, 50, 1)']} style={StyleSheet.absoluteFill} pointerEvents="none" />

            {/* Brand Header: Holographic 3D Logo + G-TAXI text */}
            <View style={[s.headerLogo, { top: insets.top + 10 }]}>
                <Image source={require('../../assets/images/gtaxi_logo_3d.avif')} style={{ width: 50, height: 50, resizeMode: 'contain' }} />
                <View style={{ marginLeft: 12 }}>
                    <Text style={s.logoText}>G-TAXI</Text>
                    <Text style={s.luxeSubtext}>LUXE MULTIVERSE</Text>
                </View>
            </View>

            {/* System Maintenance Banner (Fix 3) */}
            {!systemStatus.stripe_ready && (
                <View style={[s.maintenanceBanner, { top: insets.top + 70 }]}>
                    <Ionicons name="warning" size={16} color="#F59E0B" />
                    <Txt variant="caption" weight="bold" color="#FFF" style={{ marginLeft: 8 }}>
                        System Maintenance: Card payments currently unavailable.
                    </Txt>
                </View>
            )}

            {/* SIDEBAR */}
            <Sidebar
                visible={isMenuOpen}
                onClose={() => setIsMenuOpen(false)}
                navigation={navigation}
                user={{
                    name: profile?.name || 'Rider', // BUG_FIX 1
                    rating: 5.0,
                    photo_url: profile?.avatar_url ?? undefined,
                }}
            />

            {/* BOTTOM PANEL (Reanimated y+120→0, BlurView) */}
            {/* BOTTOM PANEL (Reanimated y+120→0, BlurView) */}
            {/* AI HUD Bubble (Truth Layer) */}
            {(aiGreeting || isAiThinking || visionLoading) && (
                <Reanimated.View 
                    entering={FadeIn}
                    exiting={FadeOut}
                    style={[s.aiBubbleContainer, { bottom: 330 }]}
                >
                    <BlurView intensity={80} tint="dark" style={s.aiBlur}>
                        <View style={s.aiAvatar}>
                            <LinearGradient colors={['#7B61FF', '#00FFFF']} style={StyleSheet.absoluteFill} />
                            <Ionicons name={visionLoading ? "scan" : "sparkles"} size={16} color="#FFF" />
                        </View>
                        <View style={{ flex: 1, marginLeft: 12 }}>
                            {visionLoading ? (
                                <Txt variant="small" color="#00FFFF">ANALYZING YOUR SIGHT...</Txt>
                            ) : isAiThinking ? (
                                <Txt variant="small" color="rgba(255,255,255,0.4)">AI IS THINKING...</Txt>
                            ) : (
                                <Txt variant="bodyReg" color="#FFF">{aiGreeting}</Txt>
                            )}
                        </View>
                        {!visionLoading && (
                            <TouchableOpacity 
                                style={s.voiceBtn} 
                                onPress={() => {
                                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                                    Alert.prompt(
                                        "AI Voice Command",
                                        "Speak your destination",
                                        [
                                            { text: "Cancel", style: "cancel" },
                                            { text: "Send", onPress: (val?: string) => handleVoiceComplete(val || '') }
                                        ]
                                    );
                                }}
                            >
                                <Ionicons name="mic" size={20} color="#00FFFF" />
                            </TouchableOpacity>
                        )}
                    </BlurView>
                </Reanimated.View>
            )}

            {/* VISION FAB: Holographic Scanner */}
            <TouchableOpacity 
                style={[s.visionFab, { bottom: 330 + 74 }]} 
                onPress={handleVisionSighting}
                activeOpacity={0.7}
            >
                <GlassCard variant="rider" style={s.visionGlass}>
                    <LinearGradient 
                        colors={['rgba(0, 255, 255, 0.2)', 'rgba(124, 58, 237, 0.2)']} 
                        style={StyleSheet.absoluteFill}
                    />
                    <Ionicons name="scan-outline" size={28} color="#00FFFF" />
                    <Txt variant="caption" weight="heavy" color="#00FFFF" style={{ marginLeft: 8 }}>VISION</Txt>
                </GlassCard>
            </TouchableOpacity>

            <Reanimated.View style={[s.panel, animatedPanel, { paddingBottom: insets.bottom + 20 }]}>
                <GlassCard variant="rider" style={s.glassPanel}>
                    <View style={s.cardInner}>
                        
                        {/* PROACTIVE AI INSIGHT */}
                        {proactiveAction && (
                            <Reanimated.View entering={FadeIn} style={s.proactiveHud}>
                                <LinearGradient 
                                    colors={[BRAND.purple, BRAND.purpleDark]} 
                                    style={s.proactiveGradient} 
                                    start={GRADIENTS.primaryStart} 
                                    end={GRADIENTS.primaryEnd}
                                >
                                    <View style={s.aiIndicator}>
                                        <Ionicons name="sparkles" size={14} color={BRAND.cyan} />
                                    </View>
                                    <Text style={s.proactiveText}>{proactiveAction}</Text>
                                    <TouchableOpacity onPress={() => setProactiveAction(null)}>
                                        <Ionicons name="close-circle" size={18} color="rgba(255,255,255,0.4)" />
                                    </TouchableOpacity>
                                </LinearGradient>
                            </Reanimated.View>
                        )}

                        {/* Service Tiles: Vibrant Futurism Grid */}
                        <View style={s.tiles}>
                            <TouchableOpacity style={{ flex: 1 }}>
                                <BlurView intensity={40} tint="dark" style={[s.serviceTile, s.tileActive]}>
                                    <LinearGradient 
                                        colors={['rgba(124, 58, 237, 0.8)', 'rgba(0, 255, 255, 0.8)']} 
                                        start={{x: 0, y: 0}} 
                                        end={{x: 1, y: 1}} 
                                        style={StyleSheet.absoluteFill} 
                                    />
                                    <Ionicons name="car-sport" size={32} color="#FFF" style={s.glowIcon} />
                                    <Txt variant="caption" weight="heavy" color="#FFF" style={{ marginTop: 10, letterSpacing: 1 }}>TRANSPORT</Txt>
                                </BlurView>
                            </TouchableOpacity>

                            <TouchableOpacity
                                style={{ flex: 1 }}
                                onPress={() => {
                                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                    navigation.navigate('GroceryStorefront', { category: 'service' });
                                }}
                            >
                                <BlurView intensity={20} tint="dark" style={s.serviceTile}>
                                    <Ionicons name="cart" size={28} color="#00FFFF" style={s.glowIcon} />
                                    <Txt variant="caption" weight="bold" color="#FFF" style={{ marginTop: 8, letterSpacing: 1 }}>MARKET</Txt>
                                </BlurView>
                            </TouchableOpacity>
                        </View>

                        {/* Search Bar: HUD Holographic (Blueberry Luxe style) */}
                        <TouchableOpacity
                            onPress={() => {
                                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                                navigation.navigate('DestinationSearch', { currentLocation: { latitude: currentLat, longitude: currentLng } });
                            }}
                        >
                            <View style={s.searchBarInner}>
                                <View style={s.hudSearchIndicator} />
                                <Text style={s.searchPlaceholder}>INITIALIZE TRIP</Text>
                                <Ionicons name="chevron-forward" size={20} color={BRAND.purple} />
                            </View>
                        </TouchableOpacity>

                        {/* Quick pills */}
                        <View style={s.pills}>
                            <TouchableOpacity style={s.pill} onPress={() => handleQuickAction('Home')}>
                                <Ionicons name="home-outline" size={18} color={BRAND.purple} />
                                <Text style={s.pillLabel}>Home</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={s.pill} onPress={() => handleQuickAction('Work')}>
                                <Ionicons name="briefcase-outline" size={18} color={BRAND.purple} />
                                <Text style={s.pillLabel}>Work</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={s.recentPill} onPress={() => handleQuickAction('Recent')}>
                                <Ionicons name="time-outline" size={22} color={BRAND.purpleLight} />
                            </TouchableOpacity>
                        </View>

                    </View>
                </GlassCard>
            </Reanimated.View>

            {/* Modals */}
            <SavedPlaceModal visible={!!activeModalLabel} defaultLabel={activeModalLabel || ''} onClose={() => setActiveModalLabel(null)} onSave={handleSavePlace} />
            <RecentRidesModal visible={showRecentModal} onClose={() => setShowRecentModal(false)} recentLocations={recentRides} onSelect={(loc) => {
                setShowRecentModal(false);
                navigation.navigate('RideConfirmation', {
                    destination: { latitude: loc.latitude, longitude: loc.longitude, address: loc.address },
                    pickup: { latitude: currentLat, longitude: currentLng, address: 'Current Location' }
                });
            }} />

            {/* --- FORCED UPDATE / MAINTENANCE OVERLAYS (Fix 7) --- */}
            {systemStatus.config?.maintenance_mode === 'true' && (
                <View style={[StyleSheet.absoluteFill, s.lockOverlay]}>
                    <BlurView tint="dark" intensity={100} style={s.lockBlur}>
                        <View style={s.hudLockRing} />
                        <Ionicons name="flash" size={64} color="#00FFFF" />
                        <Txt variant="headingL" color="#00FFFF" style={{ marginTop: 24, textAlign: 'center', letterSpacing: 4 }}>SYSTEM LOCK</Txt>
                        <Txt variant="bodyReg" color="rgba(0,255,255,0.6)" style={{ marginTop: 12, textAlign: 'center', paddingHorizontal: 40 }}>
                            MAINTENANCE PROTOCOL ACTIVE. ENCRYPTED LINK STANDBY.
                        </Txt>
                    </BlurView>
                </View>
            )}

            {systemStatus.config?.min_version_rider && Constants.expoConfig?.version && (
                (() => {
                    const current = Constants.expoConfig.version.split('.').map(Number);
                    const min = systemStatus.config.min_version_rider.split('.').map(Number);
                    let needsUpdate = false;
                    for (let i = 0; i < 3; i++) {
                        if ((current[i] || 0) < (min[i] || 0)) { needsUpdate = true; break; }
                        if ((current[i] || 0) > (min[i] || 0)) break;
                    }
                    
                    if (needsUpdate) {
                        return (
                            <View style={[StyleSheet.absoluteFill, s.lockOverlay]}>
                                <BlurView tint="dark" intensity={100} style={s.lockBlur}>
                                    <Ionicons name="cloud-download" size={64} color="#7C3AED" />
                                    <Txt variant="headingL" color="#FFF" style={{ marginTop: 24, textAlign: 'center' }}>Update Required</Txt>
                                    <Txt variant="bodyReg" color="rgba(255,255,255,0.6)" style={{ marginTop: 12, textAlign: 'center', paddingHorizontal: 40 }}>
                                        A critical security update is available. Please update your app to continue using G-TAXI.
                                    </Txt>
                                    <TouchableOpacity style={s.updateBtn} onPress={() => Alert.alert("Update", "Please check the App Store or Google Play for the latest version.")}>
                                        <Txt variant="bodyBold" color="#FFF">Update Now</Txt>
                                    </TouchableOpacity>
                                </BlurView>
                            </View>
                        );
                    }
                    return null;
                })()
            )}
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: VOICES.rider.bg },
    map: { width, height },
    carMarker: { width: 48, height: 48, shadowColor: BRAND.cyan, shadowRadius: 15, shadowOpacity: 1 },
    
    headerLogo: { position: 'absolute', left: 24, top: 0, zIndex: 100, flexDirection: 'row', alignItems: 'center' },
    logoText: { 
        fontSize: 26, 
        fontWeight: '900', 
        color: '#FFFFFF', 
        letterSpacing: 2,
        textShadowColor: 'rgba(0, 255, 255, 0.8)',
        textShadowOffset: { width: 0, height: 0 },
        textShadowRadius: 10
    },
    luxeSubtext: {
        fontSize: 10,
        fontWeight: '800',
        color: '#00FFFF',
        letterSpacing: 4,
        marginTop: 2
    },

    menuBtn: { position: 'absolute', right: 24, zIndex: 100 },
    menuCircle: { width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255, 255, 255, 0.1)', overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },

    panel: { position: 'absolute', bottom: 10, left: 10, right: 10 },
    glassPanel: { backgroundColor: 'rgba(22, 11, 50, 0.65)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', borderRadius: 28, overflow: 'hidden' },
    cardInner: { padding: 24 },

    tiles: { flexDirection: 'row', gap: 12, marginBottom: 24 },
    serviceTile: { 
        height: 110, 
        alignItems: 'center', 
        justifyContent: 'center', 
        borderRadius: 24, 
        overflow: 'hidden',
        backgroundColor: 'rgba(255, 255, 255, 0.05)',
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.15)'
    },
    glowIcon: {
        shadowColor: '#00FFFF',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.8,
        shadowRadius: 10
    },
    tileActive: { backgroundColor: 'transparent', borderColor: '#00FFFF', borderWidth: 2 },
    
    soonBadge: { position: 'absolute', top: 8, right: 8, backgroundColor: '#F59E0B', borderRadius: 50, paddingHorizontal: 5, paddingVertical: 2 },

    searchBarInner: { 
        flexDirection: 'row', 
        alignItems: 'center', 
        height: 72, 
        borderRadius: 20, 
        paddingHorizontal: 24, 
        marginBottom: 24, 
        overflow: 'hidden', 
        backgroundColor: 'rgba(255, 255, 255, 0.08)',
        borderWidth: 1,
        borderColor: 'rgba(0, 255, 255, 0.3)'
    },
    hudSearchIndicator: { width: 14, height: 14, borderRadius: 7, backgroundColor: '#00FFFF', marginRight: 16, shadowColor: '#00FFFF', shadowOpacity: 1, shadowRadius: 8 },
    searchPlaceholder: { flex: 1, letterSpacing: 2, fontSize: 18, fontWeight: '800', color: '#FFFFFF' },

    pills: { flexDirection: 'row', gap: 12, alignItems: 'center' },
    pill: { 
        flex: 1, 
        flexDirection: 'row', 
        alignItems: 'center', 
        height: 52, 
        backgroundColor: 'rgba(255, 255, 255, 0.08)', 
        borderRadius: 16, 
        paddingHorizontal: 20,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.1)'
    },
    pillLabel: { marginLeft: 8, fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
    recentPill: { 
        width: 52, 
        height: 52, 
        borderRadius: 16, 
        backgroundColor: 'rgba(255, 255, 255, 0.08)', 
        alignItems: 'center', 
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.1)'
    },

    maintenanceBanner: {
        position: 'absolute',
        left: 20,
        right: 20,
        backgroundColor: 'rgba(255, 255, 255, 0.98)',
        padding: 16,
        borderRadius: RADIUS.md,
        flexDirection: 'row',
        alignItems: 'center',
        zIndex: 100,
        borderWidth: 1,
        borderColor: BRAND.cyan,
    },
    lockOverlay: { zIndex: 9999, justifyContent: 'center', alignItems: 'center' },
    lockBlur: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center', padding: 20 },
    hudLockRing: { position: 'absolute', width: 250, height: 250, borderRadius: 125, borderWidth: 2, borderColor: 'rgba(124, 58, 237, 0.1)' },
    updateBtn: { marginTop: 32, backgroundColor: BRAND.purple, paddingHorizontal: 40, paddingVertical: 18, borderRadius: RADIUS.md },

    aiBubbleContainer: { position: 'absolute', left: 20, right: 20, zIndex: 90 },
    aiBlur: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: RADIUS.md, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(124, 97, 255, 0.2)' },
    aiAvatar: { width: 32, height: 32, borderRadius: 16, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
    voiceBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,255,255,0.05)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(0,255,255,0.1)' },

    proactiveGradient: { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: RADIUS.md, borderWidth: 1, borderColor: 'rgba(0,255,255,0.2)' },
    proactiveText: { flex: 1, marginLeft: 10, fontSize: 13, fontWeight: '300', color: '#FFF' },
    aiIndicator: { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.2)', alignItems: 'center', justifyContent: 'center' },

    proactiveHud: { marginBottom: 16 },
    visionFab: { position: 'absolute', right: 20, zIndex: 100 },
    visionGlass: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(0, 255, 255, 0.4)' },
});
