import React, { useEffect, useState, useRef, useMemo } from 'react';
import {
    View, StyleSheet, Image, ScrollView, Pressable, Animated, Easing,
    useWindowDimensions, Alert, Platform, Modal, KeyboardAvoidingView, Linking,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import MapView, { Marker, PROVIDER_DEFAULT, UrlTile } from 'react-native-maps';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { Audio } from 'expo-av';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useReducedMotion } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useNetInfo } from '@react-native-community/netinfo';
import { useAuth } from '../context/AuthContext';
import { useRide } from '../context/RideContext';
import { useNearbyDrivers } from '../hooks/useNearbyDrivers';
import { usePlatformFlags } from '../hooks/usePlatformFlags';
import { initializeSupabaseClient, DEFAULT_LOCATION, ENV } from '@gtaxi/core';
import { Sidebar } from '../components/Sidebar';
import type { Layer } from '../components/home/LayerDeck';
import { greetingFor } from '../theme/mood';
import {
    BRAND_GRADIENT, BrandBadge, Button, Card, Chip, EmptyState, Field, GUTTER, IconButton,
    Pop, Progress, RADIUS, Section, shade, SPACE, Txt, useTheme,
} from '../ui/kit';
import { toast } from '../components/Toast';

const { supabase } = initializeSupabaseClient('native');

const CAR_ASSET = require('../../assets/images/car_gtaxi_standard_v7.png');

const BRAND = '#8B7CFF';

const DARK_MAP_STYLE = [
    { elementType: 'geometry', stylers: [{ color: '#07070F' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: BRAND }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#07070F' }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#13171D' }] },
    { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: BRAND, weight: 0.5 }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0A2E33', lightness: -80 }] },
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
    // Platform-wide switches from the admin's Platform Control page. One query
    // for all of them, kept live over realtime.
    const { flags: platformFlags } = usePlatformFlags();

    const [location, setLocation] = useState<Location.LocationObject | null>(null);
    const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([]);
    const [recentRides, setRecentRides] = useState<RideLocation[]>([]);
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [featureFlags, setFeatureFlags] = useState({ grocery: false, laundry: false, merchant: false, kiosk: false, caribbean_travel: false, fete: false, events: false });
    const [nextUnlock, setNextUnlock] = useState<{ vertical: string; progress: number; required: number; label: string } | null>(null);
    const [systemStatus, setSystemStatus] = useState<{ stripe_ready: boolean; mapbox_ready: boolean; config: Record<string, string> }>({ stripe_ready: true, mapbox_ready: true, config: {} });
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
    const [unreadCount, setUnreadCount] = useState(0);
    const [homeSuggestion, setHomeSuggestion] = useState<string | null>(null);

    const nfcDedupCache = useRef<Map<string, number>>(new Map());
    const netInfo = useNetInfo();

    const [voiceModalVisible, setVoiceModalVisible] = useState(false);
    const [voiceInputText, setVoiceInputText] = useState('');

    const [isVerticalsLoading, setIsVerticalsLoading] = useState(true);
    const [selectedDestinationPreview, setSelectedDestinationPreview] = useState<{lat: number, lng: number, address: string} | null>(null);
    const [estimatedFare, setEstimatedFare] = useState<number | null>(null);
    const [isEstimatingFare, setIsEstimatingFare] = useState(false);
    const [nearbyVendors, setNearbyVendors] = useState<Array<{ id: string; name: string; store_type: string; address: string; delivery_fee_cents: number; avg_delivery_minutes: number; is_open: boolean; distance_meters: number }>>([]);
    const [stopSuggestions, setStopSuggestions] = useState<{ name: string; lat: number; lng: number }[]>([]);

    const reducedMotion = useReducedMotion();

    const [sheetH, setSheetH] = useState(360);

    const { activeRide: contextActiveRide } = useRide();

    useEffect(() => {
        if (contextActiveRide?.ride_id) {
            navigation.replace('ActiveRide', { rideId: contextActiveRide.ride_id });
            return;
        }

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
                // kiosk/carnival/events used to be three separate round-trips to
                // system_feature_flags. usePlatformFlags fetches every switch in
                // one query and keeps them live, so adding more gates costs
                // nothing extra.
                const [progressRes] = await Promise.all([
                    supabase.functions.invoke('get_rider_progress'),
                ]);

                if (progressRes.error) throw progressRes.error;

                const { data: suggestionData } = await supabase
                    .rpc('get_home_suggestion', { p_rider_id: profile?.id })
                    .maybeSingle();
                const suggestion = suggestionData as { cta_text?: string; vertical?: string; reason_code?: string } | null;
                if (suggestion?.cta_text) {
                    setHomeSuggestion(suggestion.cta_text);
                }

                // `unlocked_verticals` is now the EFFECTIVE list: the rider
                // earned it AND the admin currently allows it. That
                // intersection happens in get_rider_progress so it cannot be
                // bypassed from here. Previously this only reflected what the
                // rider earned, which is why the admin's vertical toggle
                // appeared to do nothing.
                const unlocked: string[] = progressRes.data?.data?.unlocked_verticals || [];

                // Verticals with no progression gate (carnival, events) still
                // have to respect the same admin switch. Default to true when
                // the map is absent so an older payload can't blank the screen.
                const platform: Record<string, boolean> = progressRes.data?.data?.platform_enabled || {};
                const adminAllows = (name: string) => platform[name] !== false;

                // This effect has an empty dependency array, so it must NOT read
                // platformFlags — it would capture the first render's values and
                // never see an admin toggle. The platform switch is applied at
                // render time in the `layers` memo below, which does depend on
                // them. What is computed here is only: did the rider earn it,
                // and does vertical_settings allow it.
                const flags = {
                    grocery: unlocked.includes('grocery'),
                    laundry: unlocked.includes('laundry_nfc') || unlocked.includes('laundry'),
                    merchant: unlocked.includes('merchant_delivery'),
                    kiosk: unlocked.includes('laundry_nfc') || unlocked.includes('kiosk'),
                    caribbean_travel: unlocked.includes('g_escape') || unlocked.includes('caribbean_travel'),
                    fete: adminAllows('carnival'),
                    events: adminAllows('events'),
                };

                setFeatureFlags(flags);
                setNextUnlock(progressRes.data?.data?.next_unlock ?? null);
            } catch (err) {
                console.warn('[HomeScreen] Failed to fetch rider progress:', err);
                setFeatureFlags({ grocery: false, laundry: false, merchant: false, kiosk: false, caribbean_travel: false, fete: false, events: false });
                setNextUnlock(null);
            } finally {
                setIsVerticalsLoading(false);
            }
        };
        fetchEnabledVerticals();

        const verticalsChannel = supabase
            .channel('verticals-realtime')
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'vertical_settings' },
                () => { fetchEnabledVerticals(); }
            )
            .on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'rider_progression', filter: `rider_id=eq.${profile?.id}` },
                () => { fetchEnabledVerticals(); }
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

        const fetchUnreadCount = async () => {
            if (!profile?.id) return;
            const { count, error } = await supabase
                .from('notifications')
                .select('id', { count: 'exact', head: true })
                .eq('user_id', profile.id)
                .eq('is_read', false);
            // Table may not exist yet — fail closed to 0 so the badge stays honest.
            if (error) {
                console.warn('[HomeScreen] notifications count unavailable:', error.message);
                return;
            }
            setUnreadCount(count || 0);
        };
        fetchUnreadCount();

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

        return () => {
            verticalsChannel?.unsubscribe();
        };
    }, []);

    useEffect(() => {
        const lat = location?.coords?.latitude || DEFAULT_LOCATION.latitude;
        const lng = location?.coords?.longitude || DEFAULT_LOCATION.longitude;
        if (!featureFlags.grocery) return;
        // Personalized ranking (visits, learned routes, featured promos) with
        // consent; plain distance ranking when suggestions are off. Falls back
        // to the old RPC if g_rank_merchants isn't deployed yet.
        supabase
            .rpc('g_rank_merchants', { p_rider_id: profile?.id ?? null, p_lat: lat, p_lng: lng, p_store_type: 'grocery', p_limit: 10 })
            .then(
                ({ data, error }) => {
                    if (error || !data) {
                        supabase
                            .rpc('get_nearby_merchants', { p_lat: lat, p_lng: lng, p_radius_km: 15, p_store_type: 'grocery' })
                            .then(
                                ({ data: fallback }) => setNearbyVendors(fallback || []),
                                (err: unknown) => console.warn('[HomeScreen] merchant rail failed:', err),
                            );
                        return;
                    }
                    setNearbyVendors(data.map((m: any) => ({
                        id: m.merchant_id,
                        name: m.name,
                        store_type: m.store_type,
                        address: m.address ?? '',
                        delivery_fee_cents: m.delivery_fee_cents ?? 0,
                        avg_delivery_minutes: m.avg_delivery_minutes ?? 30,
                        is_open: m.is_open,
                        distance_meters: m.distance_m,
                        is_usual: m.is_usual,
                        is_featured: m.is_featured,
                    })));
                },
                (err: unknown) => console.warn('[HomeScreen] g_rank_merchants failed:', err),
            );
    }, [location, featureFlags.grocery, profile?.id]);

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
            const waMsg = `GTAX_${nfcTagId}_OFFLINE_REQUEST`;
            Linking.openURL(`https://wa.me/18687031000?text=${encodeURIComponent(waMsg)}`);
            Alert.alert(
                'Network Disconnected',
                "G-Taxi is still ready to route you.\n\nOpen WhatsApp to request your ride now — your pickup location is linked to this NFC kiosk. Our concierge will confirm within 2 minutes."
            );
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

    // Trust caption: convert the abstract map dots into an explicit promise.
    // ETA is a rough estimate from nearest driver distance (~30km/h urban => m/500 ≈ min),
    // surfaced with a "~" so it never reads as a hard guarantee.
    const nearestDriverMeters = realtimeDrivers.reduce<number | null>((min, d) => {
        const dlat = (d.lat as any), dlng = (d.lng as any);
        if (!Number.isFinite(dlat) || !Number.isFinite(dlng)) return min;
        const m = haversineMeters(currentLat, currentLng, dlat, dlng);
        return min === null || m < min ? m : min;
    }, null);
    const driverEtaMin = nearestDriverMeters !== null ? Math.max(1, Math.round(nearestDriverMeters / 500)) : null;

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

    // Additive: forward a request to G's rider concierge and speak its reply.
    // Consent-gated server-side; if AI is off, G replies without personalization.
    const askConcierge = async (text: string) => {
        try {
            const { data, error } = await supabase.functions.invoke('g_rider_concierge', {
                body: { message: text, lat: currentLat, lng: currentLng }
            });
            if (!error && data?.reply) {
                setAiGreeting(data.reply);
            } else {
                setAiGreeting("Sorry, I couldn't process that just now.");
            }
        } catch {
            setAiGreeting("Connection failed. Please try again.");
        }
    };

    // Shared by both the typed-text path and the real voice-recording path
    // below — handle_voice returns the same {success, intent, destination,
    // reply} shape either way, transcription happens server-side.
    const processVoiceResult = async (data: any, fallbackText: string) => {
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
            } else {
                // Additive: non-ride requests (remember/order/reminder/chat) go to
                // G's concierge for a richer, memory-aware reply. Ride booking above
                // is untouched. Concierge is consent-gated + has no payment tools.
                await askConcierge(data.transcript || fallbackText);
            }
        } else {
            // handle_voice couldn't classify it — let G's concierge try.
            await askConcierge(fallbackText);
        }
    };

    const handleVoiceComplete = async (text: string) => {
        if (!profile?.id || !text) return;
        setIsAiThinking(true);
        setAiGreeting("On it...");

        try {
            const { data } = await supabase.functions.invoke('handle_voice', {
                body: { text, rider_id: profile.id }
            });
            await processVoiceResult(data, text);
        } catch (err) {
            setAiGreeting("Connection failed. Please try again.");
        } finally {
            setIsAiThinking(false);
        }
    };

    const [isRecordingVoice, setIsRecordingVoice] = useState(false);
    const voiceRecordingRef = useRef<Audio.Recording | null>(null);

    const startVoiceRecording = async () => {
        try {
            const { status } = await Audio.requestPermissionsAsync();
            if (status !== 'granted') {
                Alert.alert('Microphone Required', 'Enable microphone access to use voice commands.');
                return;
            }
            await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
            const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
            voiceRecordingRef.current = recording;
            setIsRecordingVoice(true);
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        } catch (err) {
            Alert.alert('Recording Failed', 'Could not start the microphone. Please try again.');
        }
    };

    const stopVoiceRecordingAndSend = async () => {
        const recording = voiceRecordingRef.current;
        if (!recording || !profile?.id) return;
        setIsRecordingVoice(false);
        voiceRecordingRef.current = null;

        try {
            await recording.stopAndUnloadAsync();
            const uri = recording.getURI();
            if (!uri) throw new Error('No recording produced');

            setVoiceModalVisible(false);
            setIsAiThinking(true);
            setAiGreeting("Listening...");

            const formData = new FormData();
            formData.append('audio', {
                uri,
                name: 'voice.m4a',
                type: 'audio/m4a',
            } as any);
            formData.append('rider_id', profile.id);

            const { data } = await supabase.functions.invoke('handle_voice', { body: formData });
            await processVoiceResult(data, data?.transcript || '');
        } catch (err) {
            setAiGreeting("Couldn't hear that. Please try again.");
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

    // Ride card sub-line carries the live driver-presence promise when drivers exist.
    const driverSubText = realtimeDrivers.length > 0
        ? `${realtimeDrivers.length} ${realtimeDrivers.length === 1 ? 'driver' : 'drivers'} nearby${driverEtaMin ? ` · ~${driverEtaMin} min` : ''}`
        : 'Get a taxi anywhere';

    const layers: Layer[] = useMemo(() => {
        const arr: Layer[] = [
            { id: 'ride', name: 'Ride', sub: driverSubText, accent: BRAND, icon: 'car-sport-sharp', search: homeSuggestion || 'Where to?' },
        ];
        if (featureFlags.grocery) arr.push({ id: 'market', name: 'Market', sub: 'Groceries delivered', accent: '#F59E0B', icon: 'cart-sharp', search: 'Shop groceries & more' });
        if (featureFlags.laundry) arr.push({ id: 'laundry', name: 'Laundry', sub: 'Fresh & folded', accent: '#34E6EC', icon: 'shirt-sharp', search: 'Schedule a pickup' });
        if (featureFlags.merchant) arr.push({ id: 'merchant', name: 'Food', sub: 'Delivery from local spots', accent: '#F97316', icon: 'fast-food-sharp', search: 'Order food & more' });
        // Each of these needs BOTH gates: the rider earned it / the vertical is
        // enabled (featureFlags), AND the platform switch on Platform Control is
        // on (platformFlags). Either one off hides the tile.
        if (featureFlags.caribbean_travel) arr.push({ id: 'escape', name: 'G-Escape', sub: 'Caribbean packages', accent: '#CBD6DE', icon: 'airplane-sharp', search: 'Browse escapes' });
        if (featureFlags.kiosk && platformFlags.kiosk) arr.push({ id: 'tap', name: 'Tap', sub: 'Scan a puck', accent: BRAND, icon: 'radio-sharp', search: 'Open NFC scanner' });
        if (featureFlags.events && platformFlags.events) arr.push({ id: 'events', name: 'Events', sub: 'Nightlife & fetes', accent: '#6D28D9', icon: 'calendar-sharp', search: 'What\'s happening' });
        if (featureFlags.fete && platformFlags.carnival) arr.push({ id: 'fete', name: 'Carnival', sub: 'Bands & fetes', accent: '#FF2D55', icon: 'musical-notes-sharp', search: 'Find your band' });
        if (nextUnlock) arr.push({ id: 'locked', name: nextUnlock.vertical, accent: '#34E6EC', icon: 'lock-closed', locked: true, progress: nextUnlock.progress, need: nextUnlock.required, label: nextUnlock.label });
        return arr;
    }, [featureFlags, platformFlags, nextUnlock, driverSubText, homeSuggestion]);

    const openDestinationSearch = () => {
        const accuracy = location?.coords?.accuracy;
        if (accuracy && accuracy > 50) {
            setLocationAccuracy(accuracy);
            setShowLocationConfirm(true);
        } else {
            navigation.navigate('DestinationSearch', {
                currentLocation: { latitude: currentLat, longitude: currentLng },
            });
        }
    };

    const handleLayerPrimary = (layer: Layer) => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        switch (layer.id) {
            case 'ride': openDestinationSearch(); break;
            case 'market': navigation.navigate('GroceryStorefront'); break;
            case 'laundry': navigation.navigate('LaundryLanding'); break;
            case 'merchant': navigation.navigate('FoodDelivery'); break;
            case 'escape': navigation.navigate('EscapeStorefront'); break;
            case 'tap': (navigation.navigate as any)('NfcScan'); break;
            case 'events': navigation.navigate('Events'); break;
            case 'fete': navigation.navigate('Carnival'); break;
            default: break;
        }
    };

    // Store says this build is older than the minimum allowed.
    const needsUpdate = (() => {
        const min = systemStatus.config?.min_version_rider;
        const cur = Constants.expoConfig?.version;
        if (!min || !cur) return false;
        const c = cur.split('.').map(Number), n = min.split('.').map(Number);
        for (let i = 0; i < 3; i++) {
            if ((c[i] || 0) < (n[i] || 0)) return true;
            if ((c[i] || 0) > (n[i] || 0)) return false;
        }
        return false;
    })();

    const m = useTheme();
    const g = greetingFor();
    const firstName = ((profile as any)?.full_name || profile?.name || '').split(' ')[0] || undefined;

    // Mascot gently bobs; the search key drops on press.
    const bob = useRef(new Animated.Value(0)).current;
    useEffect(() => {
        if (reducedMotion) return;
        const loop = Animated.loop(Animated.sequence([
            Animated.timing(bob, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
            Animated.timing(bob, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        ]));
        loop.start();
        return () => loop.stop();
    }, []);
    const mascotBob = bob.interpolate({ inputRange: [0, 1], outputRange: [0, -5] });
    const searchPress = useRef(new Animated.Value(0)).current;
    const searchDown = searchPress.interpolate({ inputRange: [0, 1], outputRange: [0, 5] });
    const searchIn = () => Animated.timing(searchPress, { toValue: 1, duration: 70, useNativeDriver: true }).start();
    const searchOut = () => Animated.spring(searchPress, { toValue: 0, speed: 18, bounciness: 10, useNativeDriver: true }).start();
    const night = m.key === 'night';
    const tileStyle = night ? 'navigation-night-v1' : 'light-v11';

    // Sheet entrance: glides up once, content fades in after it.
    const sheetRise = useRef(new Animated.Value(reducedMotion ? 0 : 40)).current;
    const sheetFade = useRef(new Animated.Value(reducedMotion ? 1 : 0)).current;
    useEffect(() => {
        if (reducedMotion) return;
        Animated.parallel([
            Animated.timing(sheetRise, { toValue: 0, duration: 480, easing: Easing.bezier(0.23, 1, 0.32, 1), useNativeDriver: true }),
            Animated.timing(sheetFade, { toValue: 1, duration: 360, easing: Easing.bezier(0.23, 1, 0.32, 1), useNativeDriver: true }),
        ]).start();
    }, []);

    const otherLayers = layers.filter(l => l.id !== 'ride' && !l.locked);
    const lockedLayer = layers.find(l => l.locked);
    const fieldBg = night ? m.sheet[1] : '#FFFFFF';

    return (
        <View style={{ flex: 1, backgroundColor: m.page }}>
            <StatusBar style={m.statusBar} />

            {/* Map — fills the top of the screen behind the sheet */}
            <MapView
                style={StyleSheet.absoluteFillObject}
                provider={PROVIDER_DEFAULT}
                customMapStyle={night ? DARK_MAP_STYLE : []}
                initialRegion={{ latitude: currentLat, longitude: currentLng, latitudeDelta: 0.015, longitudeDelta: 0.015 }}
                mapPadding={{ top: insets.top + 60, right: 0, bottom: sheetH, left: 0 }}
                showsUserLocation
                userInterfaceStyle={night ? 'dark' : 'light'}
            >
                {ENV.MAPBOX_PUBLIC_TOKEN && (
                    <UrlTile
                        key={tileStyle}
                        urlTemplate={`https://api.mapbox.com/styles/v1/mapbox/${tileStyle}/tiles/256/{z}/{x}/{y}@2x?access_token=${ENV.MAPBOX_PUBLIC_TOKEN}`}
                        shouldReplaceMapContent={true}
                    />
                )}
                {realtimeDrivers.map(d => (
                    <Marker key={d.id} coordinate={{ latitude: (d.lat as any) || 0, longitude: (d.lng as any) || 0 }} anchor={{ x: 0.5, y: 0.5 }} rotation={d.heading || 0}>
                        <Image source={CAR_ASSET} style={{ width: 40, height: 40 }} resizeMode="contain" />
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
                                destination: { latitude: place.lat, longitude: place.lng, address: place.address || place.label },
                            });
                        }}
                    >
                        <View style={{ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: m.accent, borderWidth: 2, borderColor: '#FFFFFF' }}>
                            <Ionicons name={place.label === 'Work' ? 'briefcase' : place.label === 'Home' ? 'home' : 'heart'} size={14} color="#FFFFFF" />
                        </View>
                    </Marker>
                ))}
            </MapView>
            {Platform.OS === 'web' && ENV.MAPBOX_PUBLIC_TOKEN ? (
                // Web preview only: a still map in the same place as the live phone map.
                <View pointerEvents="none" style={StyleSheet.absoluteFillObject}><Image resizeMode="cover" style={StyleSheet.absoluteFillObject}
                    source={{ uri: `https://api.mapbox.com/styles/v1/mapbox/${tileStyle}/static/${currentLng},${currentLat},14.5,0/600x1200@2x?access_token=${ENV.MAPBOX_PUBLIC_TOKEN}&attribution=false&logo=false` }} /></View>
            ) : null}
            <LinearGradient pointerEvents="none" colors={m.mapWash as any} style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 180 }} />

            {/* Your pickup, centred in the visible map */}
            <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: Math.max(insets.top + 70, (height - sheetH) / 2 - 30), alignItems: 'center' }}>
                <View style={{ backgroundColor: m.sheet[1], borderRadius: 14, borderWidth: 2, borderBottomWidth: 4, borderColor: night ? '#3A3049' : '#ECE6F3', paddingHorizontal: 12, paddingVertical: 6, marginBottom: 6 }}>
                    <Txt variant="label">Your pickup</Txt>
                </View>
                <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(139,124,255,0.22)', alignItems: 'center', justifyContent: 'center' }}>
                    <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: '#8B7CFF', borderWidth: 3, borderColor: '#FFFFFF' }} />
                </View>
            </View>

            {/* Top bar */}
            <View style={{ position: 'absolute', top: insets.top + 12, left: GUTTER, right: GUTTER, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <IconButton icon="menu" label="Open menu" tone="filled" onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setIsMenuOpen(true); }} />
                <View style={{ flexDirection: 'row', alignItems: 'center', height: 36, paddingHorizontal: 14, borderRadius: 18, backgroundColor: m.sheet[1], borderWidth: 1, borderColor: m.sheetBorder }}>
                    <View style={{ width: 7, height: 7, borderRadius: 4, marginRight: 8, backgroundColor: realtimeDrivers.length > 0 ? '#2FB57C' : m.faint }} />
                    <Txt variant="label">{realtimeDrivers.length > 0 ? driverSubText : 'Finding drivers near you'}</Txt>
                </View>
                <View>
                    <IconButton icon="notifications-outline" label="Notifications" tone="filled" onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); navigation.navigate('Notifications'); }} />
                    {unreadCount > 0 && <View pointerEvents="none" style={{ position: 'absolute', top: 8, right: 9, width: 9, height: 9, borderRadius: 5, backgroundColor: '#E5484D', borderWidth: 1.5, borderColor: m.sheet[1] }} />}
                </View>
            </View>

            {!systemStatus.stripe_ready && (
                <View style={{ position: 'absolute', top: insets.top + 66, left: GUTTER, right: GUTTER, flexDirection: 'row', alignItems: 'center', padding: SPACE.md, borderRadius: 14, backgroundColor: night ? 'rgba(245,158,11,0.16)' : '#FFF6E5' }}>
                    <Ionicons name="information-circle" size={16} color="#D97706" />
                    <Txt variant="caption" style={{ marginLeft: SPACE.sm, flex: 1 }}>Card payments are paused right now. Cash still works.</Txt>
                </View>
            )}

            {/* Bottom sheet */}
            <Animated.View
                onLayout={(e) => setSheetH(e.nativeEvent.layout.height)}
                style={{ position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: height - insets.top - 72, opacity: sheetFade, transform: [{ translateY: sheetRise }] }}
            >
                {m.glow ? (
                    <LinearGradient pointerEvents="none" colors={m.glow as any} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }}
                        style={{ position: 'absolute', left: 0, right: 0, top: -60, height: 90, opacity: 0.55 }} />
                ) : null}
                <LinearGradient
                    colors={m.sheet as any}
                    style={{ borderTopLeftRadius: RADIUS.sheet, borderTopRightRadius: RADIUS.sheet, borderWidth: 1, borderBottomWidth: 0, borderColor: m.sheetBorder,
                        shadowColor: '#000', shadowOpacity: m.shadowOpacity, shadowRadius: 24, shadowOffset: { width: 0, height: -6 }, elevation: 16 }}
                >
                    <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: m.chipBorder, alignSelf: 'center', marginTop: 10, marginBottom: 6 }} />
                    <ScrollView
                        bounces={false}
                        showsVerticalScrollIndicator={false}
                        keyboardShouldPersistTaps="handled"
                        contentContainerStyle={{ paddingHorizontal: GUTTER, paddingTop: SPACE.md, paddingBottom: Math.max(insets.bottom, SPACE.lg) + SPACE.sm }}
                    >
                        {/* G says hello */}
                        <Pop>
                            <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
                                <Animated.Image source={require('../../assets/logo.png')} resizeMode="contain"
                                    style={{ width: 92, height: 92, marginLeft: -14, marginRight: -10, transform: [{ translateY: mascotBob }] }} />
                                <View style={{ flex: 1, marginLeft: SPACE.sm, marginBottom: 6 }}>
                                    <View style={{ backgroundColor: night ? '#2A2238' : '#FFFFFF', borderRadius: 18, borderWidth: 2, borderBottomWidth: 4,
                                        borderColor: night ? '#3A3049' : '#ECE6F3', paddingHorizontal: SPACE.md, paddingVertical: SPACE.sm }}>
                                        <Txt variant="headline">{g.hello}{firstName ? `, ${firstName}` : ''}!</Txt>
                                        <Txt variant="body" tone="dim" numberOfLines={2}>
                                            {isAiThinking || visionLoading
                                                ? (visionLoading ? 'Looking at your photo…' : 'Thinking…')
                                                : (aiGreeting && aiGreeting !== 'Where to next?' ? aiGreeting : `Where are we going ${g.when}?`)}
                                        </Txt>
                                    </View>
                                    {/* bubble tail */}
                                    <View style={{ position: 'absolute', left: -6, bottom: 14, width: 14, height: 14, transform: [{ rotate: '45deg' }],
                                        backgroundColor: night ? '#2A2238' : '#FFFFFF', borderLeftWidth: 2, borderBottomWidth: 2, borderColor: night ? '#3A3049' : '#ECE6F3' }} />
                                </View>
                                {platformFlags.aiAssistant && (
                                    <View style={{ marginLeft: SPACE.sm, marginBottom: 6 }}>
                                        <IconButton icon="mic" label="Ask G by voice" onPress={() => {
                                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                                            setVoiceInputText('');
                                            setVoiceModalVisible(true);
                                        }} />
                                    </View>
                                )}
                            </View>
                        </Pop>

                        {/* Where to? — a big chunky key */}
                        <Pop delay={70}>
                            <Pressable
                                accessibilityRole="search" accessibilityLabel="Where to?"
                                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); openDestinationSearch(); }}
                                onPressIn={searchIn} onPressOut={searchOut}
                                style={{ marginTop: SPACE.lg }}
                            >
                                <View style={{ borderRadius: 20, backgroundColor: '#5B4BD6' }}>
                                    <Animated.View style={{ height: 60, borderRadius: 20, overflow: 'hidden', flexDirection: 'row', alignItems: 'center',
                                        paddingLeft: SPACE.lg, paddingRight: 8, transform: [{ translateY: searchDown }] , marginBottom: 5 }}>
                                        <LinearGradient colors={BRAND_GRADIENT} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFillObject} />
                                        <Ionicons name="search" size={22} color="#FFFFFF" />
                                        <Txt variant="headline" tone="onBrand" style={{ flex: 1, marginLeft: SPACE.md, fontSize: 19 }} numberOfLines={1}>{homeSuggestion || 'Where to?'}</Txt>
                                        <Pressable
                                            accessibilityRole="button" accessibilityLabel="Ride with a photo of where you are"
                                            onPress={handleVisionSighting} hitSlop={6}
                                            style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center' }}
                                        >
                                            <Ionicons name="camera" size={20} color="#FFFFFF" />
                                        </Pressable>
                                    </Animated.View>
                                </View>
                            </Pressable>
                        </Pop>

                        {/* Saved places */}
                        <Pop delay={130}>
                            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: SPACE.md }}>
                                <Chip icon="home" label="Home" onPress={() => handleQuickAction('Home')} />
                                <Chip icon="briefcase" label="Work" onPress={() => handleQuickAction('Work')} />
                                <Chip icon="time" label="Recent" onPress={() => handleQuickAction('Recent')} />
                            </View>
                        </Pop>

                        {/* Fare preview (voice / saved place on its way to booking) */}
                        {(selectedDestinationPreview || isEstimatingFare) && (
                            <Card style={{ marginTop: SPACE.sm }}>
                                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                    <View style={{ flex: 1 }}>
                                        <Txt variant="bodyStrong" numberOfLines={1}>{selectedDestinationPreview?.address || 'Getting your price…'}</Txt>
                                        <Txt variant="caption" tone="dim" style={{ marginTop: 2 }}>
                                            {isEstimatingFare ? 'Getting your price…' : estimatedFare ? `About ${formatTTDDollars(estimatedFare / 100)}` : 'Price not available yet'}
                                        </Txt>
                                    </View>
                                    {!isEstimatingFare && (
                                        <Pressable accessibilityRole="button" accessibilityLabel="Clear" onPress={clearFarePreview} hitSlop={8}>
                                            <Ionicons name="close-circle" size={22} color={m.faint} />
                                        </Pressable>
                                    )}
                                </View>
                                {stopSuggestions.length > 0 && selectedDestinationPreview && (
                                    <View style={{ marginTop: SPACE.md }}>
                                        <Txt variant="overline" tone="faint" style={{ marginBottom: SPACE.sm }}>ADD A STOP ON THE WAY</Txt>
                                        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                                            {stopSuggestions.map((stop, i) => (
                                                <Chip key={i} label={stop.name} onPress={() => {
                                                    navigation.navigate('RideConfirmation', {
                                                        destination: { latitude: selectedDestinationPreview.lat, longitude: selectedDestinationPreview.lng, address: selectedDestinationPreview.address },
                                                        pickup: { latitude: currentLat, longitude: currentLng, address: 'Current Location' },
                                                        stop: { name: stop.name, latitude: stop.lat, longitude: stop.lng },
                                                    });
                                                    clearFarePreview();
                                                }} />
                                            ))}
                                        </View>
                                    </View>
                                )}
                            </Card>
                        )}

                        {/* G's tip */}
                        {proactiveAction && (
                            <Pop>
                                <Card style={{ marginTop: SPACE.sm, flexDirection: 'row', alignItems: 'flex-start' }}>
                                    <Ionicons name="sparkles" size={16} color="#8B7CFF" style={{ marginTop: 2 }} />
                                    <Txt variant="body" style={{ flex: 1, marginHorizontal: SPACE.md }}>{proactiveAction}</Txt>
                                    <Pressable accessibilityRole="button" accessibilityLabel="Dismiss tip" onPress={() => setProactiveAction(null)} hitSlop={8}>
                                        <Ionicons name="close" size={18} color={m.faint} />
                                    </Pressable>
                                </Card>
                            </Pop>
                        )}

                        {/* Services — bright tiles that bounce */}
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: SPACE.md, marginHorizontal: -SPACE.xs }}>
                            {[layers[0], ...otherLayers].map((l, i) => (
                                <Pop key={l.id} delay={180 + i * 50} style={{ width: '25%', paddingHorizontal: SPACE.xs, marginBottom: SPACE.md }}>
                                    <ServiceTile
                                        label={l.name}
                                        icon={(i === 0 ? 'car-sport' : (l.icon || 'apps').replace('-sharp', '')) as any}
                                        color={TILE_COLORS[l.id] || '#8B7CFF'}
                                        onPress={() => handleLayerPrimary(l)}
                                    />
                                </Pop>
                            ))}
                            {lockedLayer && (
                                <Pop delay={180 + (otherLayers.length + 1) * 50} style={{ width: '25%', paddingHorizontal: SPACE.xs, marginBottom: SPACE.md }}>
                                    <ServiceTile label={lockedLayer.name} icon="lock-closed" color={night ? '#4A4058' : '#C9C1D6'} onPress={() => toast(lockedLayer.label || `Keep riding to unlock ${lockedLayer.name}`)} />
                                </Pop>
                            )}
                        </View>

                        {/* Your progress */}
                        <Pop delay={320}>
                            <Card style={{ marginTop: SPACE.xs }} onPress={() => navigation.navigate('Subscription')}>
                                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                    <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: '#FFB020', borderBottomWidth: 4, borderColor: shade('#FFB020'), alignItems: 'center', justifyContent: 'center' }}>
                                        <Ionicons name="trophy" size={22} color="#FFFFFF" />
                                    </View>
                                    <View style={{ flex: 1, marginLeft: SPACE.md }}>
                                        <Txt variant="headline">{lockedLayer ? `Unlock ${lockedLayer.name}` : 'Your G-Level'}</Txt>
                                        <Txt variant="caption" tone="dim" numberOfLines={1}>
                                            {lockedLayer
                                                ? `${Math.max(0, (lockedLayer.need ?? 0) - (lockedLayer.progress ?? 0))} more to go`
                                                : 'Every ride moves you up and unlocks perks'}
                                        </Txt>
                                    </View>
                                    <Ionicons name="chevron-forward" size={18} color={m.faint} />
                                </View>
                                <View style={{ marginTop: SPACE.md }}>
                                    <Progress value={lockedLayer ? (lockedLayer.progress ?? 0) / Math.max(1, lockedLayer.need ?? 1) : 0.08} color="#FFB020" />
                                </View>
                            </Card>
                        </Pop>

                        {/* Nearby shops */}
                        {nearbyVendors.length > 0 && (
                            <Section title="Shops near you">
                                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -GUTTER }} contentContainerStyle={{ paddingHorizontal: GUTTER, gap: SPACE.md }}>
                                    {nearbyVendors.map(v => (
                                        <Card key={v.id} style={{ width: 168, padding: SPACE.md }} onPress={() => {
                                            navigation.navigate('ProductListing', { merchant: { ...v, category: v.store_type } });
                                        }}>
                                            <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: '#2FB57C', alignItems: 'center', justifyContent: 'center', marginBottom: SPACE.sm }}>
                                                <Ionicons name="storefront" size={18} color="#FFFFFF" />
                                            </View>
                                            <Txt variant="bodyStrong" numberOfLines={1}>{v.name}</Txt>
                                            <Txt variant="caption" tone={(v as any).is_usual ? 'accent' : 'dim'} numberOfLines={1}>
                                                {(v as any).is_featured ? 'Featured' : (v as any).is_usual ? 'Your usual' : v.is_open ? 'Open now' : 'Closed'} · ~{v.avg_delivery_minutes} min
                                            </Txt>
                                        </Card>
                                    ))}
                                </ScrollView>
                            </Section>
                        )}

                        {/* Trust */}
                        <Pop delay={380}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: SPACE.md, padding: SPACE.md, borderRadius: RADIUS.card, backgroundColor: night ? 'rgba(47,181,124,0.12)' : '#EAF8F1', borderWidth: 2, borderColor: night ? 'rgba(47,181,124,0.25)' : '#C9EEDB' }}>
                                <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: '#2FB57C', alignItems: 'center', justifyContent: 'center' }}>
                                    <Ionicons name="shield-checkmark" size={19} color="#FFFFFF" />
                                </View>
                                <View style={{ flex: 1, marginLeft: SPACE.md }}>
                                    <Txt variant="headline">You're in safe hands</Txt>
                                    <Txt variant="caption" tone="dim">Verified drivers · G Guardian on call 24/7</Txt>
                                </View>
                            </View>
                        </Pop>
                    </ScrollView>
                </LinearGradient>
            </Animated.View>

            <Sidebar
                visible={isMenuOpen}
                onClose={() => setIsMenuOpen(false)}
                navigation={navigation}
                user={{ name: profile?.name || 'Rider', rating: 5.0, photo_url: profile?.avatar_url ?? undefined }}
            />

            <SavedPlaceModal visible={!!activeModalLabel} defaultLabel={activeModalLabel || ''} onClose={() => setActiveModalLabel(null)} onSave={handleSavePlace} />
            <RecentRidesModal visible={showRecentModal} onClose={() => setShowRecentModal(false)} recentLocations={recentRides} onSelect={async (loc) => {
                setShowRecentModal(false);
                await fetchFareEstimate(loc.latitude, loc.longitude, loc.address || 'Selected Location');
                setTimeout(() => {
                    navigation.navigate('RideConfirmation', {
                        destination: { latitude: loc.latitude, longitude: loc.longitude, address: loc.address },
                        pickup: { latitude: currentLat, longitude: currentLng, address: 'Current Location' },
                    });
                    clearFarePreview();
                }, 1500);
            }} />

            {/* Full-screen notices */}
            {systemStatus.config?.maintenance_mode === 'true' && (
                <Overlay>
                    <EmptyState icon="construct-outline" title="We'll be right back" body="G 868 is getting a quick update. Please try again in a few minutes." />
                </Overlay>
            )}
            {needsUpdate && (
                <Overlay>
                    <EmptyState
                        icon="cloud-download-outline" title="Update G 868"
                        body="A newer version is ready. Update the app to keep riding safely."
                        action={<Button title="Open the store" onPress={() => Linking.openURL(Platform.OS === 'ios' ? 'https://apps.apple.com' : 'market://details?id=com.gtaxi.rider').catch(() => {})} />}
                    />
                </Overlay>
            )}

            {/* Pickup accuracy check */}
            <Modal visible={showLocationConfirm} transparent animationType="fade" onRequestClose={() => setShowLocationConfirm(false)}>
                <View style={{ flex: 1, backgroundColor: 'rgba(10,6,20,0.55)', justifyContent: 'flex-end' }}>
                    <View style={{ backgroundColor: m.sheet[1], borderTopLeftRadius: RADIUS.sheet, borderTopRightRadius: RADIUS.sheet, padding: GUTTER, paddingBottom: Math.max(insets.bottom, SPACE.lg) + SPACE.sm }}>
                        <Txt variant="title">Is your pickup right?</Txt>
                        <Txt variant="body" tone="dim" style={{ marginTop: SPACE.xs }}>
                            Your phone's location is only accurate to about {Math.round(locationAccuracy || 0)} metres. Check the pin before you book.
                        </Txt>
                        <View style={{ height: 160, borderRadius: RADIUS.card, overflow: 'hidden', marginVertical: SPACE.lg }}>
                            <MapView
                                liteMode
                                style={{ flex: 1 }}
                                region={{ latitude: currentLat, longitude: currentLng, latitudeDelta: 0.005, longitudeDelta: 0.005 }}
                                customMapStyle={night ? DARK_MAP_STYLE : []}
                                scrollEnabled={false}
                                zoomEnabled={false}
                            >
                                <Marker coordinate={{ latitude: currentLat, longitude: currentLng }} />
                            </MapView>
                        </View>
                        <Button title="Yes, this is right" onPress={() => {
                            setShowLocationConfirm(false);
                            navigation.navigate('DestinationSearch', { currentLocation: { latitude: currentLat, longitude: currentLng } });
                        }} />
                        <Button title="Move the pin" variant="ghost" style={{ marginTop: SPACE.md }} onPress={() => {
                            setShowLocationConfirm(false);
                            navigation.navigate('DestinationSearch', { currentLocation: { latitude: currentLat, longitude: currentLng }, editPickupMode: true });
                        }} />
                    </View>
                </View>
            </Modal>

            {/* Ask G (voice or typed) */}
            <Modal visible={voiceModalVisible} transparent animationType="slide" onRequestClose={() => setVoiceModalVisible(false)}>
                <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, backgroundColor: 'rgba(10,6,20,0.55)', justifyContent: 'flex-end' }}>
                    <View style={{ backgroundColor: m.sheet[1], borderTopLeftRadius: RADIUS.sheet, borderTopRightRadius: RADIUS.sheet, padding: GUTTER, paddingBottom: Math.max(insets.bottom, SPACE.lg) + SPACE.sm, alignItems: 'center' }}>
                        <Txt variant="title">Ask G</Txt>
                        <Txt variant="body" tone="dim" style={{ marginTop: SPACE.xs, textAlign: 'center' }}>
                            {isRecordingVoice ? 'Listening. Tap again to send.' : 'Tap the mic and say where you want to go, or type it.'}
                        </Txt>
                        <Pressable
                            accessibilityRole="button" accessibilityLabel={isRecordingVoice ? 'Stop and send' : 'Start speaking'}
                            onPress={isRecordingVoice ? stopVoiceRecordingAndSend : startVoiceRecording}
                            style={{ marginVertical: SPACE.xl }}
                        >
                            {isRecordingVoice ? (
                                <View style={{ width: 76, height: 76, borderRadius: 38, backgroundColor: '#E5484D', alignItems: 'center', justifyContent: 'center' }}>
                                    <Ionicons name="stop" size={30} color="#FFFFFF" />
                                </View>
                            ) : <BrandBadge icon="mic" size={76} round />}
                        </Pressable>
                        <Field
                            style={{ alignSelf: 'stretch' }}
                            placeholder="e.g. Take me to Trincity Mall"
                            value={voiceInputText}
                            onChangeText={setVoiceInputText}
                            autoCapitalize="sentences"
                            returnKeyType="send"
                            onSubmitEditing={() => {
                                const text = voiceInputText.trim();
                                setVoiceModalVisible(false);
                                if (text) handleVoiceComplete(text);
                            }}
                        />
                        <View style={{ flexDirection: 'row', alignSelf: 'stretch', gap: SPACE.md }}>
                            <Button title="Cancel" variant="secondary" style={{ flex: 1 }} onPress={() => setVoiceModalVisible(false)} />
                            <Button title="Send" icon="send" style={{ flex: 1 }} onPress={() => {
                                const text = voiceInputText.trim();
                                setVoiceModalVisible(false);
                                if (text) handleVoiceComplete(text);
                            }} />
                        </View>
                    </View>
                </KeyboardAvoidingView>
            </Modal>
        </View>
    );
}

function Overlay({ children }: { children: React.ReactNode }) {
    const m = useTheme();
    return <View style={[StyleSheet.absoluteFill, { backgroundColor: m.page, justifyContent: 'center', zIndex: 50 }]}>{children}</View>;
}

const TILE_COLORS: Record<string, string> = {
    ride: '#8B7CFF', market: '#2FB57C', laundry: '#3FD9E8', merchant: '#FF8A3D',
    escape: '#4C9AFF', tap: '#B65CFF', events: '#FF5C8A', fete: '#FFB020',
};

// A bright square key with a 3D lip that drops when pressed.
function ServiceTile({ label, icon, color, onPress }: { label: string; icon: any; color: string; onPress: () => void }) {
    const press = useRef(new Animated.Value(0)).current;
    const down = press.interpolate({ inputRange: [0, 1], outputRange: [0, 5] });
    return (
        <Pressable accessibilityRole="button" accessibilityLabel={label}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onPress(); }}
            onPressIn={() => Animated.timing(press, { toValue: 1, duration: 70, useNativeDriver: true }).start()}
            onPressOut={() => Animated.spring(press, { toValue: 0, speed: 18, bounciness: 12, useNativeDriver: true }).start()}
            style={{ alignItems: 'center' }}>
            <View style={{ alignSelf: 'stretch', borderRadius: 20, backgroundColor: shade(color) }}>
                <Animated.View style={{ height: 64, borderRadius: 20, backgroundColor: color, alignItems: 'center', justifyContent: 'center', marginBottom: 5, transform: [{ translateY: down }] }}>
                    <View pointerEvents="none" style={{ position: 'absolute', top: 6, left: 12, right: 12, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.28)' }} />
                    <Ionicons name={icon} size={26} color="#FFFFFF" />
                </Animated.View>
            </View>
            <Txt variant="label" numberOfLines={1} style={{ marginTop: 6 }}>{label}</Txt>
        </Pressable>
    );
}
