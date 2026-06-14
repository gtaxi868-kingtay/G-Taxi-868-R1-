import React, { useEffect, useState, useRef } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity, Image, ScrollView,
    useWindowDimensions, Alert, Platform, Modal, TextInput, KeyboardAvoidingView, Linking,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import MapView, { Marker, PROVIDER_DEFAULT, UrlTile } from 'react-native-maps';
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
import { useNetInfo } from '@react-native-community/netinfo';
import { useAuth } from '../context/AuthContext';
import { useNearbyDrivers } from '../hooks/useNearbyDrivers';
import { initializeSupabaseClient, DEFAULT_LOCATION, ENV } from '@gtaxi/core';
import { Sidebar } from '../components/Sidebar';
import { AIAssistantWidget } from '../components/home/AIAssistantWidget';
import { GlassCard, Skeleton } from '@gtaxi/design-system/native';
import { ANIMATION, SURFACE, VOICES } from '@gtaxi/design-system';
import { elevationGlow, glassSurface, ghostBorder } from '@gtaxi/design-system/utils/style-rules';

const { supabase } = initializeSupabaseClient('native');

const CAR_ASSET = require('../../assets/images/car_gtaxi_standard_v7.png');

const DARK_MAP_STYLE = [
    { elementType: 'geometry', stylers: [{ color: '#050505' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#00FFFF' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#050505' }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#0A0A0A' }] },
    { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#00FFFF', weight: 0.5 }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#00FFFF', lightness: -80 }] },
    { featureType: 'poi', stylers: [{ visibility: 'off' }] }
];

import { getSavedPlaces, savePlace, getRecentRides, estimateFare } from '../services/api';
import { SavedPlace, Location as RideLocation, haversineMeters, isWithinRadius, checkGeofenceZone } from '@gtaxi/core';
import { SavedPlaceModal } from '../components/SavedPlaceModal';
import { RecentRidesModal } from '../components/RecentRidesModal';
import { formatTTDDollars } from '../utils/currency';
import { AppScreenProps } from '../navigation/types';

export function HomeScreen({ navigation, route }: AppScreenProps<'Home'>) {
    const { width, height } = useWindowDimensions();
    const insets = useSafeAreaInsets();
    const { profile } = useAuth();

    const [location, setLocation] = useState<Location.LocationObject | null>(null);
    const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([]);
    const [recentRides, setRecentRides] = useState<RideLocation[]>([]);
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [featureFlags, setFeatureFlags] = useState({ grocery: false, laundry: false, merchant: false, kiosk: false, caribbean_travel: false, g_escape: false });
    const [progression, setProgression] = useState<{
        level: number; level_label: string; unlocked_verticals: string[];
        total_rides: number; next_unlock: { level: number; vertical: string; progress: number; required: number; label: string } | null;
    } | null>(null);
    const [suggestion, setSuggestion] = useState<{ cta_text: string; vertical: string; reason_code: string } | null>(null);
    const [systemStatus, setSystemStatus] = useState<{ stripe_ready: boolean; mapbox_ready: boolean; config: Record<string, string> }>({ stripe_ready: true, mapbox_ready: true, config: {} });
    const [activeModalLabel, setActiveModalLabel] = useState<string | null>(null);
    const [showRecentModal, setShowRecentModal] = useState(false);
    const [aiGreeting, setAiGreeting] = useState<string | null>(null);
    const [isAiThinking, setIsAiThinking] = useState(false);
    const [aiLoading, setAiLoading] = useState(false);
    const [proactiveAction, setProactiveAction] = useState<string | null>(null);
    const [proactiveData, setProactiveData] = useState<{type?: string, merchant_id?: string, merchant_name?: string, text?: string} | null>(null);
    const [aiSuggestionsEnabled, setAiSuggestionsEnabled] = useState(true);
    const [visionLoading, setVisionLoading] = useState(false);
    const [showLocationConfirm, setShowLocationConfirm] = useState(false);
    const [locationAccuracy, setLocationAccuracy] = useState<number | null>(null);

    const nfcDedupCache = useRef<Map<string, number>>(new Map());
    const netInfo = useNetInfo();

    const [voiceModalVisible, setVoiceModalVisible] = useState(false);
    const [voiceInputText, setVoiceInputText] = useState('');

    const [isVerticalsLoading, setIsVerticalsLoading] = useState(true);
    const [selectedDestinationPreview, setSelectedDestinationPreview] = useState<{lat: number, lng: number, address: string} | null>(null);
    const [estimatedFare, setEstimatedFare] = useState<number | null>(null);
    const [isEstimatingFare, setIsEstimatingFare] = useState(false);
    const [nearbyVendors, setNearbyVendors] = useState<Array<{ id: string; name: string; store_type: string; address: string; delivery_fee_cents: number; avg_delivery_minutes: number; is_open: boolean; distance_meters: number }>>([]);
    const [merchantMapPins, setMerchantMapPins] = useState<Array<{ kiosk_id: string; merchant_id: string; merchant_name: string; category: string; location_name: string; lat: number; lng: number; default_services: string[]; is_open: boolean }>>([]);
    const [stopSuggestions, setStopSuggestions] = useState<{ name: string; lat: number; lng: number }[]>([]);

    const panelY = useSharedValue(120);
    const mapPitch = useSharedValue(45);

    useEffect(() => {
        const checkActive = async () => {
            try {
                const { data, error } = await supabase.functions.invoke('get_active_ride');
                if (error) {
                    console.error('[HomeScreen] get_active_ride failed:', error.message);
                    return;
                }
                if (data?.success && data?.data?.ride_id) {
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

        const { lat, lng, stand, source } = route?.params || {};
        const qrLat = typeof lat === 'string' ? parseFloat(lat) : lat;
        const qrLng = typeof lng === 'string' ? parseFloat(lng) : lng;
        const hasQrPickup = Number.isFinite(qrLat) && Number.isFinite(qrLng);

        if (hasQrPickup) {
            const qrPickup = {
                latitude: qrLat as number,
                longitude: qrLng as number,
                address: stand ? `${stand} Taxi Stand` : 'G-Taxi QR Stand',
            };

            setLocation({
                coords: {
                    latitude: qrLat as number,
                    longitude: qrLng as number,
                    accuracy: 10,
                }
            } as any);

            navigation.navigate('DestinationSearch', {
                currentLocation: qrPickup,
                source: 'qr_stand',
                sourceMetadata: {
                    stand,
                    source: source || 'qr',
                    lat: qrLat,
                    lng: qrLng,
                },
            });
        }

        (async () => {
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status === 'granted') {
                const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
                if (!hasQrPickup) setLocation(current);
                setLocationAccuracy(current.coords.accuracy || null);
            }
        })();

        fetchPlaces();

        const fetchEnabledVerticals = async () => {
            setIsVerticalsLoading(true);
            try {
                const { data: verticals, error } = await supabase
                    .rpc('get_enabled_verticals', {
                        p_user_id: profile?.id,
                        p_region: 'POS'
                    });
                
                if (error) throw error;
                
                const flags = {
                    grocery: verticals?.some((v: any) => v.vertical_name === 'grocery') || false,
                    laundry: verticals?.some((v: any) => v.vertical_name === 'laundry') || false,
                    merchant: verticals?.some((v: any) => v.vertical_name === 'merchant_delivery') || false,
                    kiosk: false,
                    caribbean_travel: verticals?.some((v: any) => v.vertical_name === 'caribbean_travel') || false,
                };
                setFeatureFlags(flags);
                const { data: sysKiosk } = await supabase
                    .from('system_feature_flags')
                    .select('is_active')
                    .eq('id', 'kiosk_active')
                    .maybeSingle();
                flags.kiosk = sysKiosk?.is_active === true;
                setFeatureFlags(flags);
            } catch (err) {
                console.warn('Failed to fetch verticals:', err);
                setFeatureFlags({ grocery: false, laundry: false, merchant: false, kiosk: false, caribbean_travel: false, g_escape: false });
            } finally {
                setIsVerticalsLoading(false);
            }
        };
        fetchEnabledVerticals();

        // Fetch rider progression + contextual suggestion
        const fetchProgression = async () => {
            try {
                const { data, error } = await supabase.functions.invoke('get_rider_progress');
                if (!error && data?.success) {
                    setProgression(data.data);
                    setSuggestion(data.data.suggestion ?? null);
                    const hasEscape = data.data.unlocked_verticals?.includes('g_escape');
                    setFeatureFlags((prev: any) => ({ ...prev, g_escape: hasEscape }));
                }
            } catch (err) {
                console.warn('[Progression] fetch failed:', err);
            }
        };
        fetchProgression();

        const verticalsChannel = supabase
            .channel('verticals-realtime')
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'vertical_settings' },
                () => {
                    fetchEnabledVerticals();
                }
            )
            .subscribe();

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

        const AI_CACHE_TTL_MS = 4 * 60 * 60 * 1000;
        const AI_CACHE_KEY = `ai_greeting_cache_${profile?.id}`;

        const fetchAIGreeting = async () => {
            if (!profile?.id || !aiSuggestionsEnabled) return;

            try {
                const cached = await AsyncStorage.getItem(AI_CACHE_KEY);
                if (cached) {
                    const { message, timestamp } = JSON.parse(cached);
                    const age = Date.now() - timestamp;
                    if (age < AI_CACHE_TTL_MS) {
                        setAiGreeting(message);
                        return;
                    }
                }
            } catch (e) {
                console.warn('[AI Greeting] Cache read failed:', e);
            }

            setIsAiThinking(true);
            try {
                const firstName = profile?.name?.split(' ')[0] || 'Partner';
                const { data, error } = await supabase.functions.invoke('generate_ai_greeting', {
                    body: { user_id: profile.id, user_name: firstName }
                });

                if (error) throw error;

                if (data?.greeting) {
                    setAiGreeting(data.greeting);

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

        panelY.value = withSpring(0, ANIMATION.spring);
        mapPitch.value = withDelay(1000, withTiming(30, { duration: 1500 }));

        return () => {
            verticalsChannel?.unsubscribe();
        };
    }, []);

    useEffect(() => {
        const lat = location?.coords?.latitude || DEFAULT_LOCATION.latitude;
        const lng = location?.coords?.longitude || DEFAULT_LOCATION.longitude;
        if (!featureFlags.grocery) return;
        supabase
            .rpc('get_nearby_merchants', { p_lat: lat, p_lng: lng, p_radius_km: 15, p_store_type: 'grocery' })
            .then(({ data }) => setNearbyVendors(data || []));
    }, [location, featureFlags.grocery]);

    useEffect(() => {
        const lat = location?.coords?.latitude || DEFAULT_LOCATION.latitude;
        const lng = location?.coords?.longitude || DEFAULT_LOCATION.longitude;
        supabase
            .rpc('get_merchant_map_pins', { p_lat: lat, p_lng: lng, p_radius_km: 20 })
            .then(({ data }) => setMerchantMapPins(data || []));
    }, [location]);

    useEffect(() => {
        const { nfcTagId, nfcLat, nfcLng, nfcLocation } = route?.params || {};
        if (!nfcTagId) return;

        const now = Date.now();
        const cache = nfcDedupCache.current;

        for (const [key, ts] of cache.entries()) {
            if (now - ts > 30000) cache.delete(key);
        }

        if (cache.has(nfcTagId)) {
            return;
        }
        cache.set(nfcTagId, now);

        if (netInfo.isConnected === false) {
            Alert.alert(
                'Network Disconnected',
                "G-Taxi is still ready to route you.\n\nTo request your ride right now without internet data, please SMS 'GTAX " + nfcTagId + "' to 1-868-703-1000 or open WhatsApp to chat with our concierge."
            );
            Linking.openURL('https://wa.me/18687031000?text=GTAX_' + nfcTagId + '_OFFLINE_REQUEST');
            return;
        }

        const tagLat = nfcLat ? parseFloat(nfcLat) : null;
        const tagLng = nfcLng ? parseFloat(nfcLng) : null;
        const tagAddress = nfcLocation || 'NFC Kiosk';

        if (tagLat && tagLng && location?.coords) {
            const { withinHard, withinSoft, driftMeters } = checkGeofenceZone(
                location.coords.latitude,
                location.coords.longitude,
                tagLat,
                tagLng
            );
            if (!withinHard) {
                console.warn(`[NFC] Tag too far: ${driftMeters.toFixed(0)}m from node (limit 150m)`);
                Alert.alert('Location Mismatch', `You are ${driftMeters.toFixed(0)}m from this NFC kiosk. Please move closer.`);
                return;
            }
            if (!withinSoft) {
            }
        }

        navigation.navigate('NfcHandshake', { tagUid: nfcTagId });
    }, [route?.params?.nfcTagId]);

    const fetchPlaces = async () => {
        const places = await getSavedPlaces();
        setSavedPlaces(places);
    };

    const currentLat = location?.coords.latitude || DEFAULT_LOCATION.latitude;
    const currentLng = location?.coords.longitude || DEFAULT_LOCATION.longitude;
    const { drivers: realtimeDrivers } = useNearbyDrivers(currentLat, currentLng);

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
                    }, 2000);
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

            if (result.canceled || !result.assets?.[0]?.base64) return;

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

            const { data: stops } = await supabase.functions.invoke('suggest_stops', {
                body: { pickup: { lat: currentLat, lng: currentLng }, dropoff: { lat: destLat, lng: destLng } }
            });
            if (stops?.stops?.length) {
                setStopSuggestions(stops.stops);
            }
        } catch (err) {
            console.warn('Fare estimate failed:', err);
            setEstimatedFare(null);
        } finally {
            setIsEstimatingFare(false);
        }
    };
    
    const clearFarePreview = () => {
        setSelectedDestinationPreview(null);
        setEstimatedFare(null);
        setStopSuggestions([]);
    };

    const handleQuickAction = async (label: string) => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        if (label === 'Home' || label === 'Work') {
            const place = savedPlaces.find(p => p.label === label);
            if (place) {
                await fetchFareEstimate(place.lat, place.lng, place.address);
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
        <View style={s.root} pointerEvents="box-none">
            <StatusBar style="light" />

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
                            backgroundColor: 'rgba(0, 255, 255, 0.9)',
                            borderRadius: 20,
                            padding: 8,
                            borderWidth: 2,
                            borderColor: '#00FFFF',
                            alignItems: 'center',
                            justifyContent: 'center'
                        }}>
                            <Ionicons name="heart" size={16} color="#FFF" />
                        </View>
                    </Marker>
                ))}

                {merchantMapPins.map((pin) => {
                    const iconName = pin.category === 'grocery' ? 'basket-outline'
                        : pin.category === 'laundry' ? 'shirt-outline'
                        : pin.category === 'restaurant' ? 'restaurant-outline'
                        : pin.category === 'pharmacy' ? 'medkit-outline'
                        : 'storefront-outline';
                    return (
                        <Marker
                            key={`merchant-${pin.kiosk_id}`}
                            coordinate={{ latitude: pin.lat, longitude: pin.lng }}
                            anchor={{ x: 0.5, y: 1 }}
                            onPress={() => {
                                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                navigation.navigate('ProductListing', {
                                    merchant: {
                                        id: pin.merchant_id,
                                        name: pin.merchant_name,
                                        category: pin.category,
                                        address: pin.location_name,
                                        is_open: pin.is_open,
                                    }
                                });
                            }}
                        >
                            <View style={{ alignItems: 'center' }}>
                                <View style={{
                                    backgroundColor: pin.is_open ? '#BF40FF' : 'rgba(100,100,120,0.9)',
                                    borderRadius: 12,
                                    paddingHorizontal: 8,
                                    paddingVertical: 5,
                                    borderWidth: 1.5,
                                    borderColor: pin.is_open ? '#E090FF' : 'rgba(180,180,200,0.4)',
                                    flexDirection: 'row',
                                    alignItems: 'center',
                                    gap: 4,
                                    shadowColor: '#BF40FF',
                                    shadowOpacity: pin.is_open ? 0.5 : 0,
                                    shadowRadius: 6,
                                    shadowOffset: { width: 0, height: 2 },
                                }}>
                                    <Ionicons name={iconName as any} size={13} color="#FFF" />
                                    <Text style={{ color: '#FFF', fontSize: 11, fontWeight: '700' }} numberOfLines={1}>
                                        {pin.merchant_name.length > 14 ? pin.merchant_name.slice(0, 13) + '…' : pin.merchant_name}
                                    </Text>
                                </View>
                                <View style={{
                                    width: 0, height: 0,
                                    borderLeftWidth: 5, borderRightWidth: 5, borderTopWidth: 6,
                                    borderLeftColor: 'transparent', borderRightColor: 'transparent',
                                    borderTopColor: pin.is_open ? '#BF40FF' : 'rgba(100,100,120,0.9)',
                                }} />
                            </View>
                        </Marker>
                    );
                })}
            </MapView>

            <View style={[s.topBarContainer, { top: insets.top + 12 }, width > 600 && { alignItems: 'center' }]}>
                <GlassCard style={[s.topBarBlur, width > 600 && { maxWidth: 600 }]}>
                    <View style={s.topBar}>
                        <Image 
                            source={require('../../assets/logo.png')} 
                            style={s.topBarLogo}
                            resizeMode="contain"
                        />
                        
                        <View style={s.topBarRight}>
                            <TouchableOpacity 
                                style={s.iconButton}
                                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                            >
                                <Ionicons name="notifications-outline" size={22} color="#FFF" />
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
                                        <Ionicons name="person" size={18} color={VOICES.rider.accent} />
                                    </View>
                                )}
                            </TouchableOpacity>
                        </View>
                    </View>
                </GlassCard>
            </View>

            {!systemStatus.stripe_ready && (
                <View style={[s.maintenanceBanner, { top: insets.top + 80 }]}>
                    <Ionicons name="warning" size={16} color="#F59E0B" />
                    <Text style={s.maintenanceText}>
                        System Maintenance: Card payments currently unavailable.
                    </Text>
                </View>
            )}

            <Sidebar
                visible={isMenuOpen}
                onClose={() => setIsMenuOpen(false)}
                navigation={navigation}
                user={{
                    name: profile?.name || 'Rider',
                    rating: 5.0,
                    photo_url: profile?.avatar_url ?? undefined,
                }}
            />

            {(isAiThinking || visionLoading) && (
                <Reanimated.View 
                    entering={FadeIn}
                    exiting={FadeOut}
                    style={[s.aiBubbleContainer, { bottom: 330 }]}
                >
                    <GlassCard style={s.aiBlur}>
                        <View style={s.aiAvatar}>
                            <Ionicons name={visionLoading ? "scan" : "sparkles"} size={16} color={VOICES.rider.accent} />
                        </View>
                        <View style={{ flex: 1, marginLeft: 12 }}>
                            {visionLoading ? (
                                <Text style={s.aiCyan}>Analyzing your sight...</Text>
                            ) : (
                                <Text style={s.aiThinking}>AI is thinking...</Text>
                            )}
                        </View>
                    </GlassCard>
                </Reanimated.View>
            )}

            <TouchableOpacity 
                style={[s.visionFab, { bottom: 330 + 74 }]} 
                onPress={handleVisionSighting}
                activeOpacity={0.7}
            >
                <View style={s.visionGlass}>
                    <Ionicons name="scan-outline" size={28} color={VOICES.rider.accent} />
                    <Text style={s.visionText}>VISION</Text>
                </View>
            </TouchableOpacity>

            <Reanimated.View style={[s.panel, animatedPanel, { paddingBottom: insets.bottom + 20 }, width > 600 && { left: '50%', right: 'auto', width: 600, marginLeft: -300 }]}>
                <GlassCard style={{ borderRadius: 24, ...elevationGlow(8) }}>
                    <View style={s.cardInner}>
                        
                        <AIAssistantWidget
                            greeting={aiGreeting ?? undefined}
                            isLoading={aiLoading}
                            onSubmitText={async (query: string) => {
                                setAiLoading(true);
                                try {
                                    const { data, error } = await supabase.functions.invoke('parse_natural_language', {
                                        body: { query, current_lat: currentLat, current_lng: currentLng }
                                    });
                                    if (error) throw new Error(error);
                                    if (data?.stops?.length >= 2) {
                                        setAiLoading(false);
                                        navigation.navigate('RideReview', {
                                            stops: data.stops,
                                            service_type: data.service_type,
                                            estimated_fare_cents: data.estimated_fare_cents,
                                            total_duration_seconds: data.total_duration_seconds || 0,
                                            total_distance_meters: data.total_distance_meters || 0,
                                            validation_required: data.validation_required,
                                            raw_query: query,
                                        });
                                    } else {
                                        Alert.alert('Could not understand', 'Please rephrase your request with a pickup and dropoff location.');
                                        setAiLoading(false);
                                    }
                                } catch (err: any) {
                                    Alert.alert('Error', err.message || 'Failed to parse request. Please try again.');
                                    setAiLoading(false);
                                }
                            }}
                            onSearchPress={() => {
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
                            onMicPress={() => {
                                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                                setVoiceInputText('');
                                setVoiceModalVisible(true);
                            }}
                        />

                        {proactiveAction && (
                            <Reanimated.View entering={FadeIn} style={s.proactiveHud}>
                                <LinearGradient 
                                    colors={[VOICES.rider.accent, '#004444']} 
                                    style={s.proactiveGradient} 
                                    start={{ x: 0, y: 0 }}
                                    end={{ x: 1, y: 1 }}
                                >
                                    <View style={s.aiIndicator}>
                                        <Ionicons name="sparkles" size={14} color={VOICES.rider.accent} />
                                    </View>
                                    <Text style={s.proactiveText}>{proactiveAction}</Text>
                                    <TouchableOpacity onPress={() => setProactiveAction(null)}>
                                        <Ionicons name="close-circle" size={18} color="rgba(255,255,255,0.4)" />
                                    </TouchableOpacity>
                                </LinearGradient>
                            </Reanimated.View>
                        )}

                        {isVerticalsLoading ? (
                            <View style={s.skeletonContainer}>
                                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingVertical: 4 }}>
                                    {[80, 72, 72, 72, 72].map((w, i) => (
                                        <Skeleton key={i} width={w} height={85} borderRadius={20} />
                                    ))}
                                </ScrollView>
                            </View>
                        ) : (
                            <View style={s.serviceBentoBox}>
                                {/* ── PROGRESSION MINI-BAR ─────────────────────── */}
                                {progression && (
                                    <TouchableOpacity
                                        activeOpacity={0.88}
                                        style={s.progressionBar}
                                        onPress={() => {
                                            if (progression.next_unlock) {
                                                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                            }
                                        }}
                                    >
                                        <View style={s.progressionLeft}>
                                            <Text style={s.progressionLevel}>{progression.level_label}</Text>
                                            {progression.next_unlock && (
                                                <Text style={s.progressionCarrot}>
                                                    {`${progression.next_unlock.progress}/${progression.next_unlock.required} rides to unlock ${progression.next_unlock.vertical.replace('_', ' ')}`}
                                                </Text>
                                            )}
                                        </View>
                                        <View style={s.progressionDots}>
                                            {[1,2,3,4,5].map((l) => (
                                                <View
                                                    key={l}
                                                    style={[
                                                        s.progressionDot,
                                                        l <= progression.level && s.progressionDotActive,
                                                    ]}
                                                />
                                            ))}
                                        </View>
                                    </TouchableOpacity>
                                )}

                                {/* ── CONTEXTUAL SUGGESTION BANNER ──────────────── */}
                                {suggestion && suggestion.reason_code !== 'default' && (
                                    <TouchableOpacity
                                        activeOpacity={0.88}
                                        style={s.suggestionBanner}
                                        onPress={() => {
                                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                        }}
                                    >
                                        <Ionicons
                                            name={suggestion.vertical === 'grocery' ? 'cart-sharp' : suggestion.vertical === 'g_escape' ? 'airplane-sharp' : 'sparkles-sharp'}
                                            size={16}
                                            color="#F59E0B"
                                            style={{ marginRight: 8 }}
                                        />
                                        <Text style={s.suggestionText}>{suggestion.cta_text}</Text>
                                        <Ionicons name="chevron-forward" size={14} color="rgba(255,255,255,0.4)" style={{ marginLeft: 'auto' }} />
                                    </TouchableOpacity>
                                )}

                                {/* ── SERVICE CHIP ROW ─────────────────────────── */}
                                <ScrollView
                                    horizontal
                                    showsHorizontalScrollIndicator={false}
                                    contentContainerStyle={s.chipRow}
                                    style={{ marginHorizontal: -4 }}
                                >
                                    {/* Ride — always first, cyan primary */}
                                    <TouchableOpacity
                                        activeOpacity={0.82}
                                        style={s.chip}
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
                                        <LinearGradient
                                            colors={['rgba(0,255,255,0.25)', 'rgba(0,255,255,0.08)']}
                                            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                                            style={[s.chipIconWrap, { borderColor: 'rgba(0,255,255,0.35)' }]}
                                        >
                                            <Ionicons name="car-sport-sharp" size={26} color={VOICES.rider.accent} />
                                        </LinearGradient>
                                        <Text style={s.chipLabel}>Ride</Text>
                                    </TouchableOpacity>

                                    {featureFlags.grocery && (
                                        <TouchableOpacity
                                            activeOpacity={0.82}
                                            style={s.chip}
                                            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); navigation.navigate('GroceryStorefront'); }}
                                        >
                                            <View style={[s.chipIconWrap, { backgroundColor: 'rgba(245,158,11,0.15)', borderColor: 'rgba(245,158,11,0.25)' }]}>
                                                <Ionicons name="cart-sharp" size={24} color="#F59E0B" />
                                            </View>
                                            <Text style={s.chipLabel}>Market</Text>
                                        </TouchableOpacity>
                                    )}

                                    {featureFlags.laundry && (
                                        <TouchableOpacity
                                            activeOpacity={0.82}
                                            style={s.chip}
                                            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); navigation.navigate('LaundryLanding'); }}
                                        >
                                            <View style={[s.chipIconWrap, { backgroundColor: 'rgba(0,255,255,0.12)', borderColor: 'rgba(0,255,255,0.2)' }]}>
                                                <Ionicons name="shirt-sharp" size={24} color={VOICES.rider.accent} />
                                            </View>
                                            <Text style={s.chipLabel}>Laundry</Text>
                                        </TouchableOpacity>
                                    )}

                                    {featureFlags.grocery && (
                                        <TouchableOpacity
                                            activeOpacity={0.82}
                                            style={s.chip}
                                            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); navigation.navigate('VisionScanner'); }}
                                        >
                                            <View style={[s.chipIconWrap, { backgroundColor: 'rgba(139,92,246,0.15)', borderColor: 'rgba(139,92,246,0.25)' }]}>
                                                <Ionicons name="scan-sharp" size={24} color="#8B5CF6" />
                                            </View>
                                            <Text style={s.chipLabel}>Scan</Text>
                                        </TouchableOpacity>
                                    )}

                                    {featureFlags.kiosk && (
                                        <TouchableOpacity
                                            activeOpacity={0.82}
                                            style={s.chip}
                                            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); (navigation.navigate as any)('NfcScan'); }}
                                        >
                                            <View style={[s.chipIconWrap, { backgroundColor: 'rgba(0,255,255,0.12)', borderColor: 'rgba(0,255,255,0.2)' }]}>
                                                <Ionicons name="radio-sharp" size={24} color={VOICES.rider.accent} />
                                            </View>
                                            <Text style={s.chipLabel}>Tap</Text>
                                        </TouchableOpacity>
                                    )}

                                    {featureFlags.caribbean_travel && (
                                        <TouchableOpacity
                                            activeOpacity={0.82}
                                            style={s.chip}
                                            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); navigation.navigate('TravelStorefront'); }}
                                        >
                                            <View style={[s.chipIconWrap, { backgroundColor: 'rgba(59,130,246,0.15)', borderColor: 'rgba(59,130,246,0.25)' }]}>
                                                <Ionicons name="airplane-sharp" size={24} color="#3B82F6" />
                                            </View>
                                            <Text style={s.chipLabel}>Escapes</Text>
                                        </TouchableOpacity>
                                    )}

                                    {featureFlags.g_escape && (
                                        <TouchableOpacity
                                            activeOpacity={0.82}
                                            style={s.chip}
                                            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy); navigation.navigate('EscapeStorefront'); }}
                                        >
                                            <View style={[s.chipIconWrap, { backgroundColor: 'rgba(212,175,55,0.18)', borderColor: 'rgba(212,175,55,0.3)' }]}>
                                                <Ionicons name="diamond-sharp" size={24} color="#D4AF37" />
                                            </View>
                                            <Text style={[s.chipLabel, { color: '#D4AF37' }]}>G-Escape</Text>
                                        </TouchableOpacity>
                                    )}
                                </ScrollView>
                            </View>
                        )}

                        {(selectedDestinationPreview || isEstimatingFare) && (
                            <Reanimated.View entering={FadeIn} exiting={FadeOut} style={s.farePreviewContainer}>
                                <View style={s.farePreviewBlur}>
                                    <View style={s.farePreviewContent}>
                                        <View style={s.fareIconContainer}>
                                            <Ionicons name="wallet-outline" size={20} color={VOICES.rider.accent} />
                                        </View>
                                        <View style={s.fareTextContainer}>
                                            <Text style={s.fareAddress}>
                                                {selectedDestinationPreview?.address || 'Estimating...'}
                                            </Text>
                                            <View style={s.fareRow}>
                                                {isEstimatingFare ? (
                                                    <Text style={{ color: VOICES.rider.accent, fontWeight: '700' }}>Calculating...</Text>
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
                                                    <Text style={{ color: 'rgba(255,255,255,0.6)' }}>Fare unavailable</Text>
                                                )}
                                            </View>
                                        </View>
                                        {!isEstimatingFare && estimatedFare && (
                                            <TouchableOpacity onPress={clearFarePreview} style={s.fareCloseBtn}>
                                                <Ionicons name="close-circle" size={20} color="rgba(255,255,255,0.4)" />
                                            </TouchableOpacity>
                                        )}
                        </View>
                    </View>
                    {stopSuggestions.length > 0 && selectedDestinationPreview && (
                        <View style={s.stopSuggestionsStrip}>
                            <Text style={s.stopSuggestionsTitle}>Suggested stops</Text>
                            <View style={s.stopSuggestionRow}>
                                {stopSuggestions.map((stop, i) => (
                                    <TouchableOpacity key={i} style={s.stopSuggestionChip} onPress={() => {
                                        navigation.navigate('RideConfirmation', {
                                            destination: { latitude: selectedDestinationPreview.lat, longitude: selectedDestinationPreview.lng, address: selectedDestinationPreview.address },
                                            pickup: { latitude: currentLat, longitude: currentLng, address: 'Current Location' },
                                            stop: { name: stop.name, latitude: stop.lat, longitude: stop.lng }
                                        });
                                        clearFarePreview();
                                    }}>
                                        <Text style={s.stopSuggestionLabel}>{stop.name}</Text>
                                    </TouchableOpacity>
                                ))}
                            </View>
                        </View>
                    )}
                </Reanimated.View>
                        )}

                        <View style={s.pills}>
                            <TouchableOpacity style={s.pill} onPress={() => handleQuickAction('Home')}>
                                <Ionicons name="home-outline" size={18} color={VOICES.rider.accent} />
                                <Text style={s.pillLabel}>Home</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={s.pill} onPress={() => handleQuickAction('Work')}>
                                <Ionicons name="briefcase-outline" size={18} color={VOICES.rider.accent} />
                                <Text style={s.pillLabel}>Work</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={s.recentPill} onPress={() => handleQuickAction('Recent')}>
                                <Ionicons name="time-outline" size={22} color={VOICES.rider.accent} />
                            </TouchableOpacity>
                        </View>

                    </View>
                </GlassCard>
            </Reanimated.View>

            <SavedPlaceModal visible={!!activeModalLabel} defaultLabel={activeModalLabel || ''} onClose={() => setActiveModalLabel(null)} onSave={handleSavePlace} />
            <RecentRidesModal visible={showRecentModal} onClose={() => setShowRecentModal(false)} recentLocations={recentRides} onSelect={async (loc) => {
                setShowRecentModal(false);
                await fetchFareEstimate(loc.latitude, loc.longitude, loc.address || 'Selected Location');
                setTimeout(() => {
                    navigation.navigate('RideConfirmation', {
                        destination: { latitude: loc.latitude, longitude: loc.longitude, address: loc.address },
                        pickup: { latitude: currentLat, longitude: currentLng, address: 'Current Location' }
                    });
                    clearFarePreview();
                }, 1500);
            }} />

            {systemStatus.config?.maintenance_mode === 'true' && (
                <View style={[StyleSheet.absoluteFill, s.lockOverlay]}>
                    <View style={[glassSurface(100), s.lockBlur]}>
                        <View style={s.hudLockRing} />
                                <Ionicons name="flash" size={64} color={VOICES.rider.accent} />
                        <Text style={s.lockTitle}>SYSTEM LOCK</Text>
                        <Text style={s.lockSubtitle}>
                            MAINTENANCE PROTOCOL ACTIVE. ENCRYPTED LINK STANDBY.
                        </Text>
                    </View>
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
                                <View style={[glassSurface(100), s.lockBlur]}>
                                    <Ionicons name="cloud-download" size={64} color={VOICES.rider.accent} />
                                    <Text style={[s.lockTitle, { color: '#FFF' }]}>Update Required</Text>
                                    <Text style={s.lockSubtitle}>
                                        A critical security update is available. Please update your app to continue using G-TAXI.
                                    </Text>
                                    <TouchableOpacity style={s.updateBtn} onPress={() => Alert.alert("Update", "Please check the App Store or Google Play for the latest version.")}>
                                        <Text style={s.updateBtnText}>Update Now</Text>
                                    </TouchableOpacity>
                                </View>
                            </View>
                        );
                    }
                    return null;
                })()
            )}

            {showLocationConfirm && (
                <View style={[StyleSheet.absoluteFill, s.locationConfirmOverlay]}>
                    <View style={[glassSurface(40), s.locationConfirmBlur, { width: width - 40 }]}>
                        <View style={s.locationConfirmCard}>
                            <Ionicons name="location-outline" size={48} color="#F59E0B" style={{ marginBottom: 16 }} />
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
                    </View>
                </View>
            )}

            <Modal
                visible={voiceModalVisible}
                transparent
                animationType="slide"
                onRequestClose={() => setVoiceModalVisible(false)}
            >
                <KeyboardAvoidingView
                    behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                    style={s.voiceModalOverlay}
                >
                    <View style={s.voiceModalCard}>
                        <View style={s.voiceModalHeader}>
                            <View style={s.voiceModalAiDot}>
                                <Ionicons name="mic" size={18} color={VOICES.rider.accent} />
                            </View>
                            <Text style={s.voiceModalTitle}>AI Voice Command</Text>
                        </View>
                        <Text style={s.voiceModalSubtitle}>Type your destination or command</Text>
                        <TextInput
                            style={s.voiceModalInput}
                            placeholder="e.g. Take me to Port of Spain"
                            placeholderTextColor="rgba(255,255,255,0.3)"
                            value={voiceInputText}
                            onChangeText={setVoiceInputText}
                            autoFocus
                            autoCapitalize="sentences"
                            returnKeyType="send"
                            onSubmitEditing={() => {
                                const text = voiceInputText.trim();
                                setVoiceModalVisible(false);
                                if (text) handleVoiceComplete(text);
                            }}
                        />
                        <View style={s.voiceModalButtons}>
                            <TouchableOpacity
                                style={s.voiceModalCancel}
                                onPress={() => setVoiceModalVisible(false)}
                            >
                                <Text style={s.voiceModalCancelText}>Cancel</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={s.voiceModalSend}
                                onPress={() => {
                                    const text = voiceInputText.trim();
                                    setVoiceModalVisible(false);
                                    if (text) handleVoiceComplete(text);
                                }}
                            >
                                <LinearGradient
                                    colors={[VOICES.rider.accent, '#00FFFF']}
                                    start={{ x: 0, y: 0 }}
                                    end={{ x: 1, y: 1 }}
                                    style={s.voiceModalSendGradient}
                                >
                                    <Ionicons name="send" size={16} color="#FFF" />
                                    <Text style={s.voiceModalSendText}>Send</Text>
                                </LinearGradient>
                            </TouchableOpacity>
                        </View>
                    </View>
                </KeyboardAvoidingView>
            </Modal>
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: SURFACE.base },
    map: { width: '100%', height: '100%' },

    voiceModalOverlay: {
        flex: 1,
        justifyContent: 'flex-end',
        backgroundColor: 'rgba(0,0,0,0.6)',
    },
    voiceModalCard: {
        backgroundColor: SURFACE.base,
        borderTopLeftRadius: 32,
        borderTopRightRadius: 32,
        padding: 28,
        paddingBottom: 40,
        ...ghostBorder(),
    },
    voiceModalHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 8,
        gap: 10,
    },
    voiceModalAiDot: {
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: 'rgba(0,255,255,0.12)',
        alignItems: 'center',
        justifyContent: 'center',
        ...ghostBorder(0.3),
    },
    voiceModalTitle: {
        fontSize: 18,
        fontWeight: '800',
        color: '#FFF',
    },
    voiceModalSubtitle: {
        fontSize: 13,
        color: 'rgba(255,255,255,0.6)',
        marginBottom: 20,
        marginLeft: 46,
    },
    voiceModalInput: {
        backgroundColor: 'rgba(255,255,255,0.06)',
        ...ghostBorder(0.4),
        borderRadius: 16,
        paddingHorizontal: 18,
        paddingVertical: 14,
        fontSize: 16,
        color: '#FFF',
        marginBottom: 20,
    },
    voiceModalButtons: {
        flexDirection: 'row',
        gap: 12,
    },
    voiceModalCancel: {
        flex: 1,
        height: 52,
        borderRadius: 14,
        backgroundColor: 'rgba(255,255,255,0.06)',
        alignItems: 'center',
        justifyContent: 'center',
        ...ghostBorder(0.1),
    },
    voiceModalCancelText: {
        fontSize: 15,
        fontWeight: '700',
        color: 'rgba(255,255,255,0.6)',
    },
    voiceModalSend: {
        flex: 1,
        height: 52,
        borderRadius: 14,
        overflow: 'hidden',
    },
    voiceModalSendGradient: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
    },
    voiceModalSendText: {
        fontSize: 15,
        fontWeight: '800',
        color: '#FFF',
    },
    
    carMarker: { 
        width: 44, 
        height: 44, 
        shadowColor: VOICES.rider.accent, 
        shadowRadius: 12, 
        shadowOpacity: 0.8,
        shadowOffset: { width: 0, height: 0 },
    },

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
        backgroundColor: 'rgba(5, 5, 5, 0.7)',
        ...ghostBorder(),
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
        ...ghostBorder(0.1),
    },
    notificationBadge: {
        position: 'absolute',
        top: 8,
        right: 8,
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: VOICES.rider.accent,
    },
    avatarButton: {
        width: 40,
        height: 40,
        borderRadius: 12,
        backgroundColor: 'rgba(255,255,255,0.08)',
        alignItems: 'center',
        justifyContent: 'center',
        ...ghostBorder(0.1),
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
        backgroundColor: 'rgba(0,255,255,0.15)',
        alignItems: 'center',
        justifyContent: 'center',
    },

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

    panel: { 
        position: 'absolute', 
        bottom: 12, 
        left: 12, 
        right: 12,
        maxHeight: '60%',
    },
    glassPanel: { 
        backgroundColor: 'rgba(255,255,255,0.03)', 
        ...ghostBorder(), 
        borderRadius: 24, 
        overflow: 'hidden',
        ...elevationGlow(8),
    },
    cardInner: { padding: 20 },

    skeletonContainer: {
        marginBottom: 20,
    },
    skeletonGrid: {
        flexDirection: 'row',
        justifyContent: 'space-between',
    },

    serviceBentoBox: {
        marginBottom: 20,
        gap: 12,
    },
    progressionBar: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: 'rgba(255,255,255,0.05)',
        borderRadius: 16,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.08)',
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    progressionLeft: {
        flex: 1,
    },
    progressionLevel: {
        fontSize: 13,
        fontWeight: '700',
        color: '#00FFFF',
        letterSpacing: 0.5,
        textTransform: 'uppercase',
    },
    progressionCarrot: {
        fontSize: 12,
        color: 'rgba(255,255,255,0.5)',
        marginTop: 2,
    },
    progressionDots: {
        flexDirection: 'row',
        gap: 6,
        marginLeft: 12,
    },
    progressionDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: 'rgba(255,255,255,0.15)',
    },
    progressionDotActive: {
        backgroundColor: '#00FFFF',
    },
    suggestionBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(245,158,11,0.08)',
        borderRadius: 14,
        borderWidth: 1,
        borderColor: 'rgba(245,158,11,0.2)',
        paddingHorizontal: 14,
        paddingVertical: 10,
    },
    suggestionText: {
        fontSize: 13,
        color: 'rgba(255,255,255,0.85)',
        fontWeight: '500',
        flex: 1,
    },
    chipRow: {
        flexDirection: 'row',
        gap: 10,
        paddingHorizontal: 4,
        paddingVertical: 4,
    },
    chip: {
        alignItems: 'center',
        width: 72,
    },
    chipIconWrap: {
        width: 52,
        height: 52,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        marginBottom: 6,
    },
    chipLabel: {
        fontSize: 11,
        fontWeight: '600',
        color: 'rgba(255,255,255,0.75)',
        textAlign: 'center',
        letterSpacing: 0.2,
    },

    farePreviewContainer: { 
        marginBottom: 16, 
        borderRadius: 16, 
        overflow: 'hidden' 
    },
    farePreviewBlur: { 
        borderRadius: 16, 
        overflow: 'hidden', 
        backgroundColor: 'rgba(0, 255, 255, 0.08)', 
        ...ghostBorder(0.3),
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
        backgroundColor: 'rgba(0, 255, 255, 0.15)', 
        alignItems: 'center', 
        justifyContent: 'center', 
        marginRight: 12 
    },
    fareTextContainer: { flex: 1 },
    fareAddress: {
        fontSize: 13,
        color: 'rgba(255,255,255,0.6)',
    },
    fareRow: { 
        flexDirection: 'row', 
        alignItems: 'baseline', 
        marginTop: 2 
    },
    fareAmount: {
        fontSize: 20,
        fontWeight: '800',
        color: '#FFF',
    },
    fareLabel: {
        fontSize: 13,
        color: 'rgba(255,255,255,0.6)',
        marginLeft: 6,
    },
    fareCloseBtn: { padding: 4 },
    stopSuggestionsStrip: {
        paddingHorizontal: 14,
        paddingBottom: 14,
    },
    stopSuggestionsTitle: {
        fontSize: 12,
        color: 'rgba(255,255,255,0.5)',
        marginBottom: 8,
        fontWeight: '600',
    },
    stopSuggestionRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    stopSuggestionChip: {
        backgroundColor: 'rgba(0, 255, 255, 0.12)',
        borderRadius: 20,
        paddingVertical: 6,
        paddingHorizontal: 14,
        borderWidth: 1,
        borderColor: 'rgba(0, 255, 255, 0.2)',
    },
    stopSuggestionLabel: {
        color: '#FFF',
        fontSize: 13,
        fontWeight: '600',
    },

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
        ...ghostBorder(0.08),
    },
    pillLabel: { 
        marginLeft: 8, 
        fontSize: 14, 
        fontWeight: '600', 
        color: '#FFF' 
    },
    recentPill: { 
        width: 48, 
        height: 48, 
        borderRadius: 14, 
        backgroundColor: 'rgba(255, 255, 255, 0.05)', 
        alignItems: 'center', 
        justifyContent: 'center',
        ...ghostBorder(0.08),
    },

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
        backgroundColor: 'rgba(5, 5, 5, 0.85)',
        ...ghostBorder(),
    },
    aiAvatar: { 
        width: 36, 
        height: 36, 
        borderRadius: 18, 
        overflow: 'hidden', 
        alignItems: 'center', 
        justifyContent: 'center',
        backgroundColor: 'rgba(0, 255, 255, 0.15)',
    },
    aiThinking: {
        color: 'rgba(255,255,255,0.6)',
    },
    aiCyan: {
        color: VOICES.rider.accent,
    },

    proactiveHud: { 
        marginBottom: 16 
    },
    proactiveGradient: { 
        flexDirection: 'row', 
        alignItems: 'center', 
        padding: 14, 
        borderRadius: 16, 
        ...ghostBorder(0.3),
        backgroundColor: 'rgba(0,255,255,0.15)',
    },
    proactiveText: { 
        flex: 1, 
        marginLeft: 10, 
        fontSize: 13, 
        fontWeight: '500', 
        color: '#FFF' 
    },
    aiIndicator: { 
        width: 28, 
        height: 28, 
        borderRadius: 14, 
        backgroundColor: 'rgba(0,0,0,0.2)', 
        alignItems: 'center', 
        justifyContent: 'center' 
    },

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
        ...ghostBorder(0.4),
        backgroundColor: 'rgba(5, 5, 5, 0.8)',
    },
    visionText: {
        marginLeft: 8,
        fontSize: 13,
        fontWeight: '700',
        color: VOICES.rider.accent,
        letterSpacing: 0.5,
    },

    lockOverlay: { 
        zIndex: 9999, 
        justifyContent: 'center', 
        alignItems: 'center',
    },
    lockBlur: { 
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
        borderColor: 'rgba(0, 255, 255, 0.2)' 
    },
    lockTitle: {
        fontSize: 28,
        fontWeight: '800',
        color: VOICES.rider.accent,
        textAlign: 'center',
        letterSpacing: 2,
    },
    lockSubtitle: {
        fontSize: 14,
        color: 'rgba(255,255,255,0.6)',
        marginTop: 12,
        textAlign: 'center',
        paddingHorizontal: 40,
        lineHeight: 20,
    },

    updateBtn: { 
        marginTop: 32, 
        backgroundColor: VOICES.rider.accent, 
        paddingHorizontal: 40, 
        paddingVertical: 16, 
        borderRadius: 16,
    },
    updateBtnText: {
        fontSize: 16,
        fontWeight: '700',
        color: '#FFF',
    },

    locationConfirmOverlay: {
        zIndex: 99999,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'rgba(0,0,0,0.7)',
    },
    locationConfirmBlur: {
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
        color: '#FFF',
        marginBottom: 8,
        textAlign: 'center',
    },
    locationConfirmSubtitle: {
        fontSize: 14,
        color: 'rgba(255,255,255,0.6)',
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
        borderColor: '#F59E0B',
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
        backgroundColor: '#F59E0B',
        borderWidth: 3,
        borderColor: '#FFF',
    },
    locationConfirmButtons: {
        width: '100%',
        gap: 12,
    },
    locationConfirmBtnPrimary: {
        backgroundColor: VOICES.rider.accent,
        paddingVertical: 16,
        paddingHorizontal: 24,
        borderRadius: 16,
        alignItems: 'center',
    },
    locationConfirmBtnPrimaryText: {
        color: SURFACE.base,
        fontSize: 16,
        fontWeight: '800',
    },
    locationConfirmBtnSecondary: {
        backgroundColor: 'rgba(255,255,255,0.03)',
        paddingVertical: 16,
        paddingHorizontal: 24,
        borderRadius: 16,
        alignItems: 'center',
        ...ghostBorder(),
    },
    locationConfirmBtnSecondaryText: {
        color: '#FFF',
        fontSize: 16,
        fontWeight: '700',
    },
});
