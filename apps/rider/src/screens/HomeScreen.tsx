import React, { useEffect, useState, useRef } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity, Image,
    Dimensions, Alert, Platform
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
import { Sidebar } from '../components/Sidebar';

const { width, height } = Dimensions.get('window');
const CAR_ASSET = require('../../assets/images/car_gtaxi_standard_v7.png');

// Blueberry Luxe Color System
const COLORS = {
    bgPrimary: '#0D0B1E',
    bgSecondary: '#160B32',
    gradientStart: '#1A0533',
    gradientEnd: '#0D1B4B',
    purple: '#7B5CF0',
    purpleDark: '#5B3FD0',
    cyan: '#00E5FF',
    cyanDark: '#0099BB',
    white: '#FFFFFF',
    textSecondary: 'rgba(255,255,255,0.6)',
    textMuted: 'rgba(255,255,255,0.5)',
    glassBg: 'rgba(255,255,255,0.06)',
    glassBorder: 'rgba(123,92,240,0.3)',
    success: '#00FF94',
    error: '#FF4D6D',
    warning: '#F59E0B',
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

import { getSavedPlaces, savePlace, getRecentRides, estimateFare } from '../services/api';
import { SavedPlace, Location as RideLocation } from '../types/ride';
import { SavedPlaceModal } from '../components/SavedPlaceModal';
import { RecentRidesModal } from '../components/RecentRidesModal';
import { formatTTDDollars } from '../utils/currency';

export function HomeScreen({ navigation, route }: any) {
    const insets = useSafeAreaInsets();
    const { profile } = useAuth();

    // State
    const [location, setLocation] = useState<Location.LocationObject | null>(null);
    const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([]);
    const [recentRides, setRecentRides] = useState<RideLocation[]>([]);
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [featureFlags, setFeatureFlags] = useState({ grocery: false, laundry: false, merchant: false });
    const [systemStatus, setSystemStatus] = useState<any>({ stripe_ready: true, mapbox_ready: true, config: {} });
    const [activeModalLabel, setActiveModalLabel] = useState<string | null>(null);
    const [showRecentModal, setShowRecentModal] = useState(false);
    const [aiGreeting, setAiGreeting] = useState<string | null>(null);
    const [isAiThinking, setIsAiThinking] = useState(false);
    const [proactiveAction, setProactiveAction] = useState<string | null>(null);
    const [proactiveData, setProactiveData] = useState<{type?: string, merchant_id?: string, merchant_name?: string, text?: string} | null>(null);
    const [aiSuggestionsEnabled, setAiSuggestionsEnabled] = useState(true);
    const [visionLoading, setVisionLoading] = useState(false);
    const [showLocationConfirm, setShowLocationConfirm] = useState(false);
    const [locationAccuracy, setLocationAccuracy] = useState<number | null>(null);

    // FIX #1: Fare Estimate - show upfront fare before ride request
    const [selectedDestinationPreview, setSelectedDestinationPreview] = useState<{lat: number, lng: number, address: string} | null>(null);
    const [estimatedFare, setEstimatedFare] = useState<number | null>(null);
    const [isEstimatingFare, setIsEstimatingFare] = useState(false);

    const panelY = useSharedValue(120);
    const mapPitch = useSharedValue(45);

    useEffect(() => {
        // 0. SECONDARY ACTIVE RIDE GUARD (Fail-safe)
        const checkActive = async () => {
            try {
                const { data, error } = await supabase.functions.invoke('get_active_ride');
                if (error) {
                    console.error('[HomeScreen] get_active_ride failed:', error.message);
                    return;
                }
                if (data?.success && data?.data?.ride_id) {
                    console.log('[Phase 3] Active ride detected. Hardening navigation...');
                    navigation.replace('ActiveRide', { 
                        rideId: data.data.ride_id,
                        paymentMethod: data.data.payment_method 
                    });
                }
            } catch (e) {
                console.warn('[Phase 3] Recovery check suppressed:', e);
            }
        };
        checkActive();

        // FIX 5: Handle QR deep link params
        const { lat, lng, stand } = route?.params || {};
        if (lat && lng) {
            console.log('QR DEEP LINK: Stand', stand, 'at', lat, lng);
            setLocation({
                coords: {
                    latitude: lat,
                    longitude: lng,
                    accuracy: 10,
                }
            } as any);
        }

        (async () => {
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status === 'granted') {
                const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
                setLocation(current);
                setLocationAccuracy(current.coords.accuracy || null);
            }
        })();

        // Fetch Places
        fetchPlaces();

        // FIX #3: Fetch enabled verticals from new vertical_settings table
        const fetchEnabledVerticals = async () => {
            try {
                // Get enabled verticals (respects region, subscription, rollout)
                const { data: verticals, error } = await supabase
                    .rpc('get_enabled_verticals', {
                        p_user_id: profile?.id,
                        p_region: 'POS' // TODO: Detect from GPS or profile
                    });
                
                if (error) throw error;
                
                const flags = { 
                    grocery: verticals?.some((v: any) => v.vertical_name === 'grocery') || false,
                    laundry: verticals?.some((v: any) => v.vertical_name === 'laundry') || false,
                    merchant: verticals?.some((v: any) => v.vertical_name === 'merchant_delivery') || false
                };
                setFeatureFlags(flags);
            } catch (err) {
                console.warn('Failed to fetch verticals:', err);
                // Fallback: disable all verticals on error
                setFeatureFlags({ grocery: false, laundry: false, merchant: false });
            }
        };
        fetchEnabledVerticals();

        // Subscribe to vertical settings changes
        const verticalsChannel = supabase
            .channel('verticals-realtime')
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'vertical_settings' },
                () => {
                    console.log('Vertical settings updated. Re-fetching...');
                    fetchEnabledVerticals();
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

        // --- AI PREFERENCE FETCH ---
        const fetchAiPrefs = async () => {
            if (!profile?.id) return;
            const { data, error } = await supabase
                .from('rider_ai_preferences')
                .select('ai_suggestions_enabled')
                .eq('user_id', profile.id)
                .maybeSingle();
            if (error) {
                console.error('[HomeScreen] rider_ai_preferences query failed:', error.message);
                return;
            }
            if (data && data.ai_suggestions_enabled === false) {
                setAiSuggestionsEnabled(false);
            }
        };
        fetchAiPrefs();

        // --- 100% READY AI: PERSISTENT BRAIN (Truth Layer) ---
        // Cache TTL: 4 hours (per wiring directive rules)
        const AI_CACHE_TTL_MS = 4 * 60 * 60 * 1000;
        const AI_CACHE_KEY = `ai_greeting_cache_${profile?.id}`;

        const fetchAIGreeting = async () => {
            if (!profile?.id || !aiSuggestionsEnabled) return;

            // Check client-side cache first (4-hour TTL)
            try {
                const cached = await AsyncStorage.getItem(AI_CACHE_KEY);
                if (cached) {
                    const { message, timestamp } = JSON.parse(cached);
                    const age = Date.now() - timestamp;
                    if (age < AI_CACHE_TTL_MS) {
                        setAiGreeting(message);
                        console.log('[AI Greeting] Using client cache');
                        return;
                    }
                }
            } catch (e) {
                console.warn('[AI Greeting] Cache read failed:', e);
            }

            // Cache miss - call AI edge function
            setIsAiThinking(true);
            try {
                const firstName = profile?.name?.split(' ')[0] || 'Partner';
                const { data, error } = await supabase.functions.invoke('generate_ai_greeting', {
                    body: { user_id: profile.id, user_name: firstName }
                });

                if (error) throw error;

                if (data?.greeting) {
                    setAiGreeting(data.greeting);
                    console.log('[AI Greeting] From edge function:', data.cached ? 'cached' : 'fresh');

                    // Save to client cache
                    try {
                        await AsyncStorage.setItem(AI_CACHE_KEY, JSON.stringify({
                            message: data.greeting,
                            timestamp: Date.now()
                        }));
                    } catch (e) {
                        console.warn('[AI Greeting] Cache write failed:', e);
                    }
                } else {
                    throw new Error('No greeting returned');
                }
            } catch (err: any) {
                console.error('[AI Greeting] Edge function failed:', err.message);
                // Fallback to time-based greeting
                const now = new Date();
                const hour = now.getHours();
                const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
                const fallbackMessage = `${greeting}, ${profile?.name?.split(' ')[0] || 'Partner'}! Ready to roll?`;
                setAiGreeting(fallbackMessage);
            } finally {
                setIsAiThinking(false);
            }
        };

        const fetchProactiveSuggestion = async () => {
            if (!location?.coords || !profile?.id) return;
            try {
                const { data, error } = await supabase.functions.invoke('ai_concierge_proactive', {
                    body: { mode: 'home', lat: location.coords.latitude, lng: location.coords.longitude, profile_id: profile.id }
                });
                if (error) throw error;
                if (data?.suggestion) {
                    setProactiveData({ type: 'general', text: data.suggestion });
                    setProactiveAction(data.suggestion);
                }
            } catch (err) {
                console.error('[AI Proactive] Error:', err);
            }
        };

        if (aiSuggestionsEnabled) {
            fetchAIGreeting();
            fetchProactiveSuggestion();
        }

        // Animations
        panelY.value = withSpring(0, { damping: 18, stiffness: 120 });
        mapPitch.value = withDelay(1000, withTiming(30, { duration: 1500 }));

        return () => {
            verticalsChannel?.unsubscribe();
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
                    // FIX #1: Show fare estimate first, then navigate
                    await fetchFareEstimate(data.destination.lat, data.destination.lng, data.destination.address);
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
                        clearFarePreview();
                    }, 2000); // Slightly longer delay to show estimate
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

    // FIX #1: Fetch fare estimate when destination is selected
    const fetchFareEstimate = async (destLat: number, destLng: number, destAddress: string) => {
        setSelectedDestinationPreview({ lat: destLat, lng: destLng, address: destAddress });
        setIsEstimatingFare(true);
        
        try {
            const fareRes = await estimateFare({
                pickup_lat: currentLat,
                pickup_lng: currentLng,
                dropoff_lat: destLat,
                dropoff_lng: destLng,
            });
            
            if (fareRes.success && fareRes.data) {
                setEstimatedFare(fareRes.data.total_fare_cents);
            } else {
                setEstimatedFare(null);
            }
        } catch (err) {
            console.warn('Fare estimate failed:', err);
            setEstimatedFare(null);
        } finally {
            setIsEstimatingFare(false);
        }
    };
    
    // FIX #1: Clear fare preview
    const clearFarePreview = () => {
        setSelectedDestinationPreview(null);
        setEstimatedFare(null);
    };

    const handleQuickAction = async (label: string) => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        if (label === 'Home' || label === 'Work') {
            const place = savedPlaces.find(p => p.label === label);
            if (place) {
                // FIX #1: Show fare estimate first, then navigate
                await fetchFareEstimate(place.lat, place.lng, place.address);
                // Auto-navigate after brief delay to show estimate
                setTimeout(() => {
                    navigation.navigate('RideConfirmation', {
                        destination: { latitude: place.lat, longitude: place.lng, address: place.address },
                        pickup: { latitude: currentLat, longitude: currentLng, address: 'Current Location' }
                    });
                    clearFarePreview();
                }, 1500);
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

            {/* MAP: Full screen with Blueberry Luxe dark styling */}
            <MapView
                style={s.map}
                provider={PROVIDER_DEFAULT}
                customMapStyle={DARK_MAP_STYLE}
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

                {/* Saved Places Markers */}
                {savedPlaces.map((place) => (
                    <Marker
                        key={`saved-${place.id}`}
                        coordinate={{ latitude: place.lat, longitude: place.lng }}
                        onPress={() => {
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                            navigation.navigate('RideConfirmation', {
                                pickup: { latitude: currentLat, longitude: currentLng },
                                destination: { latitude: place.lat, longitude: place.lng, address: place.address || place.label }
                            });
                        }}
                    >
                        <View style={{
                            backgroundColor: 'rgba(123, 92, 240, 0.9)',
                            borderRadius: 20,
                            padding: 8,
                            borderWidth: 2,
                            borderColor: '#00E5FF',
                            alignItems: 'center',
                            justifyContent: 'center'
                        }}>
                            <Ionicons name="heart" size={16} color="#FFF" />
                        </View>
                    </Marker>
                ))}
            </MapView>

            {/* Top Bar: Floating Glass Card */}
            <View style={[s.topBarContainer, { top: insets.top + 12 }]}>
                <BlurView intensity={20} tint="dark" style={s.topBarBlur}>
                    <View style={s.topBar}>
                        {/* G-Taxi Logo */}
                        <Image 
                            source={require('../../assets/logo.png')} 
                            style={s.topBarLogo}
                            resizeMode="contain"
                        />
                        
                        {/* Right Side: Notification + Profile */}
                        <View style={s.topBarRight}>
                            <TouchableOpacity 
                                style={s.iconButton}
                                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                            >
                                <Ionicons name="notifications-outline" size={22} color={COLORS.white} />
                                <View style={s.notificationBadge} />
                            </TouchableOpacity>
                            
                            <TouchableOpacity 
                                style={s.avatarButton}
                                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setIsMenuOpen(true); }}
                            >
                                {profile?.avatar_url ? (
                                    <Image source={{ uri: profile.avatar_url }} style={s.avatarImage} />
                                ) : (
                                    <View style={s.avatarPlaceholder}>
                                        <Ionicons name="person" size={18} color={COLORS.purple} />
                                    </View>
                                )}
                            </TouchableOpacity>
                        </View>
                    </View>
                </BlurView>
            </View>

            {/* System Maintenance Banner */}
            {!systemStatus.stripe_ready && (
                <View style={[s.maintenanceBanner, { top: insets.top + 80 }]}>
                    <Ionicons name="warning" size={16} color="#F59E0B" />
                    <Text style={s.maintenanceText}>
                        System Maintenance: Card payments currently unavailable.
                    </Text>
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
                            <LinearGradient colors={['#7B61FF', '#00FFFF']} style={StyleSheet.absoluteFillObject} />
                            <Ionicons name={visionLoading ? "scan" : "sparkles"} size={16} color="#FFF" />
                        </View>
                        <View style={{ flex: 1, marginLeft: 12 }}>
                            {visionLoading ? (
                                <Text style={s.aiCyan}>Analyzing your sight...</Text>
                            ) : isAiThinking ? (
                                <Text style={s.aiThinking}>AI is thinking...</Text>
                            ) : (
                                <Text style={s.aiMessage}>{aiGreeting}</Text>
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
                <View style={s.visionGlass}>
                    <LinearGradient 
                        colors={['rgba(0, 229, 255, 0.2)', 'rgba(123, 92, 240, 0.2)']} 
                        style={StyleSheet.absoluteFillObject}
                    />
                    <Ionicons name="scan-outline" size={28} color={COLORS.cyan} />
                    <Text style={s.visionText}>VISION</Text>
                </View>
            </TouchableOpacity>

            <Reanimated.View style={[s.panel, animatedPanel, { paddingBottom: insets.bottom + 20 }]}>
                <BlurView intensity={20} tint="dark" style={s.glassPanel}>
                    <View style={s.cardInner}>
                        
                        {/* AI GREETING */}
                        <View style={s.aiGreetingContainer}>
                            <Text style={s.aiGreetingText}>
                                {aiGreeting?.split(',')[0] || 'Good day'},
                            </Text>
                            <Text style={s.aiSubGreeting}>Where to?</Text>
                        </View>

                        {/* PROACTIVE AI INSIGHT */}
                        {proactiveAction && (
                            <Reanimated.View entering={FadeIn} style={s.proactiveHud}>
                                <LinearGradient 
                                    colors={[COLORS.purple, COLORS.purpleDark]} 
                                    style={s.proactiveGradient} 
                                    start={{ x: 0, y: 0 }}
                                    end={{ x: 1, y: 1 }}
                                >
                                    <View style={s.aiIndicator}>
                                        <Ionicons name="sparkles" size={14} color={COLORS.cyan} />
                                    </View>
                                    <Text style={s.proactiveText}>{proactiveAction}</Text>
                                    <TouchableOpacity onPress={() => setProactiveAction(null)}>
                                        <Ionicons name="close-circle" size={18} color="rgba(255,255,255,0.4)" />
                                    </TouchableOpacity>
                                </LinearGradient>
                            </Reanimated.View>
                        )}

                        {/* SEARCH BAR */}
                        <TouchableOpacity
                            style={s.searchBarContainer}
                            onPress={() => {
                                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

                                const accuracy = location?.coords?.accuracy;
                                if (accuracy && accuracy > 50) {
                                    setLocationAccuracy(accuracy);
                                    setShowLocationConfirm(true);
                                } else {
                                    navigation.navigate('DestinationSearch', {
                                        currentLocation: { latitude: currentLat, longitude: currentLng }
                                    });
                                }
                            }}
                        >
                            <View style={s.searchBarInner}>
                                <Ionicons name="search" size={20} color={COLORS.cyan} style={s.searchIcon} />
                                <Text style={s.searchPlaceholder}>Where are you going?</Text>
                                <Ionicons name="chevron-forward" size={20} color={COLORS.purple} style={s.searchChevron} />
                            </View>
                        </TouchableOpacity>

                        {/* SERVICE TILES - 2x2 GRID */}
                        <View style={s.tilesContainer}>
                            {/* RIDE - Cyan */}
                            <TouchableOpacity 
                                style={s.serviceTile}
                                onPress={() => {
                                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                }}
                            >
                                <View style={[s.serviceIconContainer, s.serviceIconCyan]}>
                                    <Ionicons name="car" size={26} color={COLORS.cyan} />
                                </View>
                                <Text style={s.serviceLabel}>Ride</Text>
                            </TouchableOpacity>

                            {/* MARKET - Purple */}
                            <TouchableOpacity 
                                style={s.serviceTile}
                                onPress={() => Alert.alert(
                                    'Coming Soon', 
                                    'This feature is being built. Stay tuned!'
                                )}
                            >
                                <View style={[s.serviceIconContainer, s.serviceIconPurple]}>
                                    <Ionicons name="bag" size={26} color={COLORS.purple} />
                                </View>
                                <Text style={s.serviceLabel}>Market</Text>
                            </TouchableOpacity>

                            {/* LAUNDRY - Cyan */}
                            <TouchableOpacity 
                                style={s.serviceTile}
                                onPress={() => Alert.alert(
                                    'Coming Soon', 
                                    'This feature is being built. Stay tuned!'
                                )}
                            >
                                <View style={[s.serviceIconContainer, s.serviceIconCyan]}>
                                    <Ionicons name="shirt" size={26} color={COLORS.cyan} />
                                </View>
                                <Text style={s.serviceLabel}>Laundry</Text>
                            </TouchableOpacity>

                            {/* MORE - Purple */}
                            <TouchableOpacity 
                                style={s.serviceTile}
                                onPress={() => Alert.alert(
                                    'Coming Soon', 
                                    'This feature is being built. Stay tuned!'
                                )}
                            >
                                <View style={[s.serviceIconContainer, s.serviceIconPurple]}>
                                    <Ionicons name="grid" size={26} color={COLORS.purple} />
                                </View>
                                <Text style={s.serviceLabel}>More</Text>
                            </TouchableOpacity>
                        </View>

                        {/* FIX #1: Fare Estimate Preview - shows upfront fare before ride request */}
                        {(selectedDestinationPreview || isEstimatingFare) && (
                            <Reanimated.View entering={FadeIn} exiting={FadeOut} style={s.farePreviewContainer}>
                                <BlurView intensity={60} tint="dark" style={s.farePreviewBlur}>
                                    <View style={s.farePreviewContent}>
                                        <View style={s.fareIconContainer}>
                                            <Ionicons name="wallet-outline" size={20} color={COLORS.cyan} />
                                        </View>
                                        <View style={s.fareTextContainer}>
                                            <Text style={s.fareAddress}>
                                                {selectedDestinationPreview?.address || 'Estimating...'}
                                            </Text>
                                            <View style={s.fareRow}>
                                                {isEstimatingFare ? (
                                                    <Text style={{ color: COLORS.cyan, fontWeight: '700' }}>Calculating...</Text>
                                                ) : estimatedFare ? (
                                                    <>
                                                        <Text style={s.fareAmount}>
                                                            {formatTTDDollars(estimatedFare / 100)}
                                                        </Text>
                                                        <Text style={s.fareLabel}>
                                                            estimated
                                                        </Text>
                                                    </>
                                                ) : (
                                                    <Text style={{ color: COLORS.textMuted }}>Fare unavailable</Text>
                                                )}
                                            </View>
                                        </View>
                                        {!isEstimatingFare && estimatedFare && (
                                            <TouchableOpacity onPress={clearFarePreview} style={s.fareCloseBtn}>
                                                <Ionicons name="close-circle" size={20} color="rgba(255,255,255,0.4)" />
                                            </TouchableOpacity>
                                        )}
                                    </View>
                                </BlurView>
                            </Reanimated.View>
                        )}

                        {/* Quick pills */}
                        <View style={s.pills}>
                            <TouchableOpacity style={s.pill} onPress={() => handleQuickAction('Home')}>
                                <Ionicons name="home-outline" size={18} color={COLORS.purple} />
                                <Text style={s.pillLabel}>Home</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={s.pill} onPress={() => handleQuickAction('Work')}>
                                <Ionicons name="briefcase-outline" size={18} color={COLORS.purple} />
                                <Text style={s.pillLabel}>Work</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={s.recentPill} onPress={() => handleQuickAction('Recent')}>
                                <Ionicons name="time-outline" size={22} color={COLORS.cyan} />
                            </TouchableOpacity>
                        </View>

                    </View>
                </BlurView>
            </Reanimated.View>

            {/* Modals */}
            <SavedPlaceModal visible={!!activeModalLabel} defaultLabel={activeModalLabel || ''} onClose={() => setActiveModalLabel(null)} onSave={handleSavePlace} />
            <RecentRidesModal visible={showRecentModal} onClose={() => setShowRecentModal(false)} recentLocations={recentRides} onSelect={async (loc) => {
                setShowRecentModal(false);
                // FIX #1: Show fare estimate first, then navigate
                await fetchFareEstimate(loc.latitude, loc.longitude, loc.address || 'Selected Location');
                setTimeout(() => {
                    navigation.navigate('RideConfirmation', {
                        destination: { latitude: loc.latitude, longitude: loc.longitude, address: loc.address },
                        pickup: { latitude: currentLat, longitude: currentLng, address: 'Current Location' }
                    });
                    clearFarePreview();
                }, 1500);
            }} />

            {/* --- FORCED UPDATE / MAINTENANCE OVERLAYS --- */}
            {systemStatus.config?.maintenance_mode === 'true' && (
                <View style={[StyleSheet.absoluteFill, s.lockOverlay]}>
                    <BlurView tint="dark" intensity={100} style={s.lockBlur}>
                        <View style={s.hudLockRing} />
                        <Ionicons name="flash" size={64} color={COLORS.cyan} />
                        <Text style={s.lockTitle}>SYSTEM LOCK</Text>
                        <Text style={s.lockSubtitle}>
                            MAINTENANCE PROTOCOL ACTIVE. ENCRYPTED LINK STANDBY.
                        </Text>
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
                                    <Ionicons name="cloud-download" size={64} color={COLORS.purple} />
                                    <Text style={[s.lockTitle, { color: COLORS.white }]}>Update Required</Text>
                                    <Text style={s.lockSubtitle}>
                                        A critical security update is available. Please update your app to continue using G-TAXI.
                                    </Text>
                                    <TouchableOpacity style={s.updateBtn} onPress={() => Alert.alert("Update", "Please check the App Store or Google Play for the latest version.")}>
                                        <Text style={s.updateBtnText}>Update Now</Text>
                                    </TouchableOpacity>
                                </BlurView>
                            </View>
                        );
                    }
                    return null;
                })()
            )}

            {showLocationConfirm && (
                <View style={[StyleSheet.absoluteFill, s.locationConfirmOverlay]}>
                    <BlurView intensity={40} tint="dark" style={s.locationConfirmBlur}>
                        <View style={s.locationConfirmCard}>
                            <Ionicons name="location-outline" size={48} color={COLORS.warning} style={{ marginBottom: 16 }} />
                            <Text style={s.locationConfirmTitle}>Your location may not be precise</Text>
                            <Text style={s.locationConfirmSubtitle}>
                                GPS accuracy: {Math.round(locationAccuracy || 0)} meters.{'\n'}
                                Is this pin in the right place?
                            </Text>

                            <View style={s.miniMapContainer}>
                                <MapView
                                    style={s.miniMap}
                                    region={{
                                        latitude: currentLat,
                                        longitude: currentLng,
                                        latitudeDelta: 0.005,
                                        longitudeDelta: 0.005,
                                    }}
                                    customMapStyle={DARK_MAP_STYLE}
                                    scrollEnabled={false}
                                    zoomEnabled={false}
                                >
                                    <Marker coordinate={{ latitude: currentLat, longitude: currentLng }}>
                                        <View style={s.accuracyPin}>
                                            <View style={[s.accuracyRing, { width: Math.min((locationAccuracy || 50), 200), height: Math.min((locationAccuracy || 50), 200) }]} />
                                            <View style={s.accuracyDot} />
                                        </View>
                                    </Marker>
                                </MapView>
                            </View>

                            <View style={s.locationConfirmButtons}>
                                <TouchableOpacity
                                    style={s.locationConfirmBtnSecondary}
                                    onPress={() => {
                                        setShowLocationConfirm(false);
                                        navigation.navigate('DestinationSearch', {
                                            currentLocation: { latitude: currentLat, longitude: currentLng },
                                            editPickupMode: true
                                        });
                                    }}
                                >
                                    <Text style={s.locationConfirmBtnSecondaryText}>Move the pin</Text>
                                </TouchableOpacity>

                                <TouchableOpacity
                                    style={s.locationConfirmBtnPrimary}
                                    onPress={() => {
                                        setShowLocationConfirm(false);
                                        navigation.navigate('DestinationSearch', {
                                            currentLocation: { latitude: currentLat, longitude: currentLng }
                                        });
                                    }}
                                >
                                    <Text style={s.locationConfirmBtnPrimaryText}>Yes, this is right</Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                    </BlurView>
                </View>
            )}
        </View>
    );
}

const s = StyleSheet.create({
    // Root & Map
    root: { flex: 1, backgroundColor: COLORS.bgPrimary },
    map: { width, height },
    
    // Car Marker with Cyan Glow
    carMarker: { 
        width: 44, 
        height: 44, 
        shadowColor: COLORS.cyan, 
        shadowRadius: 12, 
        shadowOpacity: 0.8,
        shadowOffset: { width: 0, height: 0 },
    },

    // Top Bar - Floating Glass Card
    topBarContainer: {
        position: 'absolute',
        left: 20,
        right: 20,
        zIndex: 100,
    },
    topBarBlur: {
        borderRadius: 20,
        overflow: 'hidden',
    },
    topBar: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 12,
        backgroundColor: 'rgba(22, 11, 50, 0.7)',
        borderWidth: 1,
        borderColor: COLORS.glassBorder,
    },
    topBarLogo: {
        width: 48,
        height: 48,
    },
    topBarRight: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    iconButton: {
        width: 40,
        height: 40,
        borderRadius: 12,
        backgroundColor: 'rgba(255,255,255,0.08)',
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.1)',
    },
    notificationBadge: {
        position: 'absolute',
        top: 8,
        right: 8,
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: COLORS.cyan,
    },
    avatarButton: {
        width: 40,
        height: 40,
        borderRadius: 12,
        backgroundColor: 'rgba(255,255,255,0.08)',
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.1)',
        overflow: 'hidden',
    },
    avatarImage: {
        width: 40,
        height: 40,
        borderRadius: 12,
    },
    avatarPlaceholder: {
        width: 40,
        height: 40,
        borderRadius: 12,
        backgroundColor: 'rgba(123,92,240,0.2)',
        alignItems: 'center',
        justifyContent: 'center',
    },

    // Maintenance Banner
    maintenanceBanner: {
        position: 'absolute',
        left: 20,
        right: 20,
        backgroundColor: 'rgba(255, 243, 205, 0.95)',
        padding: 12,
        borderRadius: 14,
        flexDirection: 'row',
        alignItems: 'center',
        zIndex: 90,
    },
    maintenanceText: {
        marginLeft: 8,
        fontSize: 13,
        fontWeight: '600',
        color: '#856404',
    },

    // Bottom Panel
    panel: { 
        position: 'absolute', 
        bottom: 10, 
        left: 10, 
        right: 10,
        maxHeight: height * 0.6,
    },
    glassPanel: { 
        backgroundColor: COLORS.glassBg, 
        borderWidth: 1, 
        borderColor: COLORS.glassBorder, 
        borderRadius: 24, 
        overflow: 'hidden',
        shadowColor: COLORS.purple,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 12,
        elevation: 8,
    },
    cardInner: { padding: 20 },

    // AI Greeting
    aiGreetingContainer: {
        marginBottom: 20,
    },
    aiGreetingText: {
        fontSize: 22,
        fontWeight: '800',
        color: COLORS.white,
        letterSpacing: -0.5,
    },
    aiSubGreeting: {
        fontSize: 15,
        fontWeight: '500',
        color: COLORS.textSecondary,
        marginTop: 4,
    },

    // Search Bar
    searchBarContainer: {
        marginBottom: 20,
    },
    searchBarInner: { 
        flexDirection: 'row', 
        alignItems: 'center', 
        height: 58, 
        borderRadius: 16, 
        paddingHorizontal: 18,
        backgroundColor: 'rgba(255, 255, 255, 0.05)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.1)',
    },
    searchIcon: {
        marginRight: 12,
    },
    searchPlaceholder: { 
        flex: 1, 
        fontSize: 16, 
        fontWeight: '500', 
        color: COLORS.cyan,
    },
    searchChevron: {
        marginLeft: 8,
    },

    // Service Tiles - 2x2 Grid
    tilesContainer: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 12,
        marginBottom: 20,
    },
    serviceTile: { 
        width: (width - 72) / 2,
        height: 100, 
        alignItems: 'center', 
        justifyContent: 'center', 
        borderRadius: 20, 
        overflow: 'hidden',
        backgroundColor: COLORS.glassBg,
        borderWidth: 1,
        borderColor: COLORS.glassBorder,
    },
    serviceTileActive: {
        borderColor: COLORS.cyan,
        backgroundColor: 'rgba(0, 229, 255, 0.1)',
    },
    serviceIconContainer: {
        width: 48,
        height: 48,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 8,
    },
    serviceIconCyan: {
        backgroundColor: 'rgba(0, 229, 255, 0.15)',
    },
    serviceIconPurple: {
        backgroundColor: 'rgba(123, 92, 240, 0.15)',
    },
    serviceLabel: {
        fontSize: 12,
        fontWeight: '700',
        letterSpacing: 1.5,
        textTransform: 'uppercase',
        color: COLORS.textMuted,
    },

    // Fare Preview
    farePreviewContainer: { 
        marginBottom: 16, 
        borderRadius: 16, 
        overflow: 'hidden' 
    },
    farePreviewBlur: { 
        borderRadius: 16, 
        overflow: 'hidden', 
        backgroundColor: 'rgba(0, 229, 255, 0.08)', 
        borderWidth: 1, 
        borderColor: 'rgba(0, 229, 255, 0.3)' 
    },
    farePreviewContent: { 
        flexDirection: 'row', 
        alignItems: 'center', 
        padding: 14 
    },
    fareIconContainer: { 
        width: 40, 
        height: 40, 
        borderRadius: 20, 
        backgroundColor: 'rgba(0, 229, 255, 0.15)', 
        alignItems: 'center', 
        justifyContent: 'center', 
        marginRight: 12 
    },
    fareTextContainer: { flex: 1 },
    fareAddress: {
        fontSize: 13,
        color: COLORS.textMuted,
    },
    fareRow: { 
        flexDirection: 'row', 
        alignItems: 'baseline', 
        marginTop: 2 
    },
    fareAmount: {
        fontSize: 20,
        fontWeight: '800',
        color: COLORS.white,
    },
    fareLabel: {
        fontSize: 13,
        color: COLORS.textSecondary,
        marginLeft: 6,
    },
    fareCloseBtn: { padding: 4 },

    // Quick Pills
    pills: { 
        flexDirection: 'row', 
        gap: 10, 
        alignItems: 'center' 
    },
    pill: { 
        flex: 1, 
        flexDirection: 'row', 
        alignItems: 'center', 
        height: 48, 
        backgroundColor: 'rgba(255, 255, 255, 0.05)', 
        borderRadius: 14, 
        paddingHorizontal: 16,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.08)',
    },
    pillLabel: { 
        marginLeft: 8, 
        fontSize: 14, 
        fontWeight: '600', 
        color: COLORS.white 
    },
    recentPill: { 
        width: 48, 
        height: 48, 
        borderRadius: 14, 
        backgroundColor: 'rgba(255, 255, 255, 0.05)', 
        alignItems: 'center', 
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.08)',
    },

    // AI Bubble
    aiBubbleContainer: { 
        position: 'absolute', 
        left: 20, 
        right: 20, 
        zIndex: 90,
        bottom: 340,
    },
    aiBlur: { 
        flexDirection: 'row', 
        alignItems: 'center', 
        padding: 14, 
        borderRadius: 20, 
        overflow: 'hidden', 
        backgroundColor: 'rgba(22, 11, 50, 0.85)',
        borderWidth: 1, 
        borderColor: COLORS.glassBorder,
    },
    aiAvatar: { 
        width: 36, 
        height: 36, 
        borderRadius: 18, 
        overflow: 'hidden', 
        alignItems: 'center', 
        justifyContent: 'center',
        backgroundColor: 'rgba(123, 92, 240, 0.3)',
    },
    aiMessage: {
        flex: 1,
        marginLeft: 12,
        fontSize: 14,
        fontWeight: '500',
        color: COLORS.white,
    },
    aiThinking: {
        color: COLORS.textMuted,
    },
    aiCyan: {
        color: COLORS.cyan,
    },
    voiceBtn: { 
        width: 40, 
        height: 40, 
        borderRadius: 20, 
        backgroundColor: 'rgba(0,229,255,0.1)', 
        alignItems: 'center', 
        justifyContent: 'center', 
        borderWidth: 1, 
        borderColor: 'rgba(0,229,255,0.3)',
        marginLeft: 8,
    },

    // Proactive HUD
    proactiveHud: { 
        marginBottom: 16 
    },
    proactiveGradient: { 
        flexDirection: 'row', 
        alignItems: 'center', 
        padding: 14, 
        borderRadius: 16, 
        borderWidth: 1, 
        borderColor: 'rgba(123,92,240,0.3)',
        backgroundColor: 'rgba(123,92,240,0.15)',
    },
    proactiveText: { 
        flex: 1, 
        marginLeft: 10, 
        fontSize: 13, 
        fontWeight: '500', 
        color: COLORS.white 
    },
    aiIndicator: { 
        width: 28, 
        height: 28, 
        borderRadius: 14, 
        backgroundColor: 'rgba(0,0,0,0.2)', 
        alignItems: 'center', 
        justifyContent: 'center' 
    },

    // Vision FAB
    visionFab: { 
        position: 'absolute', 
        right: 20, 
        zIndex: 100,
        bottom: 340,
    },
    visionGlass: { 
        flexDirection: 'row', 
        alignItems: 'center', 
        paddingHorizontal: 16, 
        paddingVertical: 12, 
        borderRadius: 20, 
        borderWidth: 1, 
        borderColor: 'rgba(0, 229, 255, 0.4)',
        backgroundColor: 'rgba(22, 11, 50, 0.8)',
    },
    visionText: {
        marginLeft: 8,
        fontSize: 13,
        fontWeight: '700',
        color: COLORS.cyan,
        letterSpacing: 0.5,
    },

    // Lock Overlays
    lockOverlay: { 
        zIndex: 9999, 
        justifyContent: 'center', 
        alignItems: 'center',
        ...StyleSheet.absoluteFillObject,
    },
    lockBlur: { 
        ...StyleSheet.absoluteFillObject, 
        justifyContent: 'center', 
        alignItems: 'center', 
        padding: 20,
        backgroundColor: 'rgba(13, 11, 30, 0.95)',
    },
    hudLockRing: { 
        position: 'absolute', 
        width: 250, 
        height: 250, 
        borderRadius: 125, 
        borderWidth: 2, 
        borderColor: 'rgba(123, 92, 240, 0.2)' 
    },
    lockTitle: {
        fontSize: 28,
        fontWeight: '800',
        color: COLORS.cyan,
        marginTop: 24,
        textAlign: 'center',
        letterSpacing: 2,
    },
    lockSubtitle: {
        fontSize: 14,
        color: COLORS.textSecondary,
        marginTop: 12,
        textAlign: 'center',
        paddingHorizontal: 40,
        lineHeight: 20,
    },
    updateBtn: { 
        marginTop: 32, 
        backgroundColor: COLORS.purple, 
        paddingHorizontal: 40, 
        paddingVertical: 16, 
        borderRadius: 16,
    },
    updateBtnText: {
        fontSize: 16,
        fontWeight: '700',
        color: COLORS.white,
    },

    locationConfirmOverlay: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 99999,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'rgba(0,0,0,0.7)',
    },
    locationConfirmBlur: {
        width: width - 40,
        borderRadius: 24,
        overflow: 'hidden',
    },
    locationConfirmCard: {
        padding: 24,
        alignItems: 'center',
    },
    locationConfirmTitle: {
        fontSize: 20,
        fontWeight: '800',
        color: COLORS.white,
        marginBottom: 8,
        textAlign: 'center',
    },
    locationConfirmSubtitle: {
        fontSize: 14,
        color: COLORS.textSecondary,
        marginBottom: 20,
        textAlign: 'center',
        lineHeight: 20,
    },
    miniMapContainer: {
        width: '100%',
        height: 180,
        borderRadius: 16,
        overflow: 'hidden',
        marginBottom: 20,
        borderWidth: 2,
        borderColor: COLORS.warning,
    },
    miniMap: {
        width: '100%',
        height: '100%',
    },
    accuracyPin: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    accuracyRing: {
        borderRadius: 1000,
        borderWidth: 2,
        borderColor: 'rgba(245, 158, 11, 0.4)',
        position: 'absolute',
    },
    accuracyDot: {
        width: 16,
        height: 16,
        borderRadius: 8,
        backgroundColor: COLORS.warning,
        borderWidth: 3,
        borderColor: COLORS.white,
    },
    locationConfirmButtons: {
        width: '100%',
        gap: 12,
    },
    locationConfirmBtnPrimary: {
        backgroundColor: COLORS.success,
        paddingVertical: 16,
        paddingHorizontal: 24,
        borderRadius: 16,
        alignItems: 'center',
    },
    locationConfirmBtnPrimaryText: {
        color: '#0D0B1E',
        fontSize: 16,
        fontWeight: '800',
    },
    locationConfirmBtnSecondary: {
        backgroundColor: COLORS.glassBg,
        paddingVertical: 16,
        paddingHorizontal: 24,
        borderRadius: 16,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: COLORS.glassBorder,
    },
    locationConfirmBtnSecondaryText: {
        color: COLORS.white,
        fontSize: 16,
        fontWeight: '700',
    },
});
