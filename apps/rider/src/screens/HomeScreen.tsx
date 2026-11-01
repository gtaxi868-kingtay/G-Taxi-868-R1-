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
import { callG, hasRealPlace } from '../services/askG';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Reanimated, { useAnimatedStyle, useReducedMotion, useSharedValue } from 'react-native-reanimated';
import { HomeSheet } from '../components/home/HomeSheet';
import { CarMarker } from '../components/home/CarMarker';
import { useTouchPoints } from '../hooks/useTouchPoints';
import { usualTrip, type UsualTrip } from '../utils/usualTrip';
import { ShopPin } from '../components/home/ShopPin';
import { ShopCarousel } from '../components/home/ShopCarousel';
import { ShopActionSheet, type ShopAction } from '../components/home/ShopActionSheet';
import { attachOffers, rankShops, type MapShop } from '../components/home/rankShops';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useNetInfo } from '@react-native-community/netinfo';
import { useAuth } from '../context/AuthContext';
import { useRide } from '../context/RideContext';
import { useNearbyDrivers } from '../hooks/useNearbyDrivers';
import { usePlatformFlags } from '../hooks/usePlatformFlags';
import { initializeSupabaseClient, DEFAULT_LOCATION, ENV } from '@gtaxi/core';
import { KeyTile } from '../components/KeyTile';
import { useServices, SERVICE_ROUTES, SERVICE_COLORS } from '../hooks/useServices';
import type { Layer } from '../components/home/LayerDeck';
import { greetingFor } from '../theme/mood';
import { CrystalGradient, RaisedIcon,
    BRAND_GRADIENT, BrandBadge, Button, Card, Chip, EmptyState, Field, GUTTER, IconButton,
    Pop, Progress, RADIUS, Section, shade, SPACE, Txt, useTheme,
} from '../ui/kit';
import { toast } from '../components/Toast';

const { supabase } = initializeSupabaseClient('native');


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
import type { TabScreenProps } from '../navigation/types';

export function HomeScreen({ navigation, route }: TabScreenProps<'Map'>) {
    const { width, height } = useWindowDimensions();
    const insets = useSafeAreaInsets();
    const { profile, user } = useAuth();
    // Platform-wide switches from the admin's Platform Control page. One query
    // for all of them, kept live over realtime.
    const { flags: platformFlags } = usePlatformFlags();
    // Which services this rider has unlocked (shared with the Services tab).
    const { layers, featureFlags, homeSuggestion } = useServices();

    const [location, setLocation] = useState<Location.LocationObject | null>(null);
    const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([]);
    const [recentRides, setRecentRides] = useState<RideLocation[]>([]);
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

    const nfcDedupCache = useRef<Map<string, number>>(new Map());
    const netInfo = useNetInfo();

    const [voiceModalVisible, setVoiceModalVisible] = useState(false);
    const [voiceInputText, setVoiceInputText] = useState('');

    const [selectedDestinationPreview, setSelectedDestinationPreview] = useState<{lat: number, lng: number, address: string} | null>(null);
    const [estimatedFare, setEstimatedFare] = useState<number | null>(null);
    const [isEstimatingFare, setIsEstimatingFare] = useState(false);
    // Every active shop with a location near the rider (all types, not just
    // grocery). These are the map pins and the swipe cards.
    const [shops, setShops] = useState<MapShop[]>([]);
    const [selectedShopId, setSelectedShopId] = useState<string | null>(null);
    const [actionShop, setActionShop] = useState<MapShop | null>(null);
    // "Your usual": where this rider most often goes at this time of day.
    const [usual, setUsual] = useState<UsualTrip | null>(null);
    useEffect(() => {
        if (!user?.id) return;
        let cancelled = false;
        supabase
            .from('rides')
            .select('created_at, status, dropoff_lat, dropoff_lng, dropoff_address')
            .eq('rider_id', user.id)
            .order('created_at', { ascending: false })
            .limit(60)
            .then(({ data, error }: any) => {
                if (cancelled || error) return;
                setUsual(usualTrip(data || []));
            }, () => {});
        return () => { cancelled = true; };
    }, [user?.id]);
    const mapRef = useRef<MapView>(null);
    const [stopSuggestions, setStopSuggestions] = useState<{ name: string; lat: number; lng: number }[]>([]);

    const reducedMotion = useReducedMotion();

    const [sheetH, setSheetH] = useState(360);
    const [boxH, setBoxH] = useState(0);

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

    }, []);

    useEffect(() => {
        const lat = location?.coords?.latitude || DEFAULT_LOCATION.latitude;
        const lng = location?.coords?.longitude || DEFAULT_LOCATION.longitude;
        // g_rank_merchants: active shops within 20 km, ranked; it does NOT bill
        // promotion impressions (checked live 2026-10-25), so loading pins for
        // every rider costs shops nothing. All store types, up to 30.
        const toShop = (m: any): MapShop => ({
            id: m.merchant_id ?? m.id,
            name: m.name,
            lat: m.lat,
            lng: m.lng,
            distance_m: m.distance_m ?? m.distance_meters,
            is_featured: !!(m.is_featured ?? m.is_promoted),
            is_open: !!m.is_open,
            store_type: m.store_type,
            category: m.category ?? m.store_type,
            address: m.address ?? '',
            cover_image_url: m.cover_image_url ?? null,
            avg_delivery_minutes: m.avg_delivery_minutes ?? 30,
            delivery_fee_cents: m.delivery_fee_cents ?? 0,
            is_usual: !!m.is_usual,
        });
        // Offers are a layer on top: if they fail, the pins still show.
        const showShops = (list: MapShop[]) => {
            setShops(list);
            if (list.length === 0) return;
            supabase
                .rpc('partner_offers_for_rider', { p_merchant_ids: list.map(s => s.id) })
                .then(
                    ({ data: offers, error }) => {
                        if (!error && offers?.length) setShops(cur => attachOffers(cur, offers));
                    },
                    (err: unknown) => console.warn('[HomeScreen] partner offers failed:', err),
                );
        };
        supabase
            .rpc('g_rank_merchants', { p_rider_id: profile?.id ?? null, p_lat: lat, p_lng: lng, p_store_type: null, p_limit: 30 })
            .then(
                ({ data, error }) => {
                    if (error || !data) {
                        // Older fallback; same behaviour it always had.
                        supabase
                            .rpc('get_nearby_merchants', { p_lat: lat, p_lng: lng, p_radius_km: 15, p_store_type: null })
                            .then(
                                ({ data: fallback }) => showShops(rankShops((fallback || []).map(toShop))),
                                (err: unknown) => console.warn('[HomeScreen] shop pins failed:', err),
                            );
                        return;
                    }
                    showShops(rankShops(data.map(toShop)));
                },
                (err: unknown) => console.warn('[HomeScreen] g_rank_merchants failed:', err),
            );
    }, [location, profile?.id]);

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
    // G-Touch Points riders are allowed to see (live/activated only).
    const touchPoints = useTouchPoints();

    // Trust caption: convert the abstract map dots into an explicit promise.
    // ETA is a rough estimate from nearest driver distance (~30km/h urban => m/500 ≈ min),
    // surfaced with a "~" so it never reads as a hard guarantee.
    const nearestDriverMeters = realtimeDrivers.reduce<number | null>((min, d) => {
        const dlat = d.lat, dlng = d.lng;
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
        const { data, problem } = await callG('g_rider_concierge', { message: text, lat: currentLat, lng: currentLng });
        setAiGreeting(problem ?? data?.reply ?? "I'm here. Tell me where you're going.");
    };

    // Shared by both the typed-text path and the real voice-recording path
    // below — handle_voice returns the same {success, intent, destination,
    // reply} shape either way, transcription happens server-side.
    const processVoiceResult = async (data: any, fallbackText: string) => {
        if (data.intent === 'need_destination') {
            setAiGreeting(data.reply || "I couldn't place that. Pick it from the list.");
            searchForPlace(data.destination?.label || fallbackText);
            return;
        }
        if (data.intent === 'book_ride' && hasRealPlace(data.destination)) {
            setAiGreeting(data.reply);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
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
            return;
        }
        // Non-ride requests (remember/order/reminder/chat) go to G's concierge
        // for a richer, memory-aware reply. Concierge is consent-gated and has
        // no payment tools.
        const text = data.transcript || fallbackText;
        if (text) await askConcierge(text);
        else setAiGreeting(data.reply || "I'm here. Tell me where you're going.");
    };

    const searchForPlace = (query: string) => {
        navigation.navigate('DestinationSearch', {
            currentLocation: { latitude: currentLat, longitude: currentLng, address: 'Your Location' },
            initialQuery: query,
        });
    };

    const handleVoiceComplete = async (text: string) => {
        if (!profile?.id || !text) return;
        setIsAiThinking(true);
        setAiGreeting("On it...");

        try {
            const { data, problem } = await callG('handle_voice', { text, rider_id: profile.id, lat: currentLat, lng: currentLng });
            if (problem || !data?.success) await askConcierge(text);
            else await processVoiceResult(data, text);
        } catch {
            setAiGreeting("G couldn't do that right now. You can still type where you're going.");
        } finally {
            setIsAiThinking(false);
        }
    };

    // Search sends a rider here when it can't find what they typed.
    useEffect(() => {
        const text = route?.params?.askG;
        if (!text || !profile?.id) return;
        navigation.setParams({ askG: undefined });
        handleVoiceComplete(text);
    }, [route?.params?.askG, profile?.id]);

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

            formData.append('lat', String(currentLat));
            formData.append('lng', String(currentLng));

            const { data, problem } = await callG('handle_voice', formData);
            if (problem || !data?.success) setAiGreeting(problem ?? "I didn't catch that. Try again, a little closer to the mic.");
            else await processVoiceResult(data, data.transcript || '');
        } catch (err) {
            setAiGreeting("Couldn't reach the recording. Try again, or type where you're going.");
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

            // The photo pins down WHERE THE RIDER IS (vision_pickup's own prompt:
            // "the user has sent a photo and their current GPS"). It used to be
            // sent as the DESTINATION with GPS as pickup, i.e. a ride from here
            // to here. Now it becomes the pickup and the rider picks where to go.
            const refinedLat = Number(data.refined_lat), refinedLng = Number(data.refined_lng);
            const hasRefined = Number.isFinite(refinedLat) && Number.isFinite(refinedLng);
            navigation.navigate('DestinationSearch', {
                currentLocation: {
                    latitude: hasRefined ? refinedLat : currentPos.coords.latitude,
                    longitude: hasRefined ? refinedLng : currentPos.coords.longitude,
                    address: data.landmark_name || data.address || 'Your Location',
                },
            });

        } catch (err: any) {
            console.warn("Vision pickup failed:", err?.message);
            // Never show a raw provider error to a rider.
            Alert.alert("Couldn't read that photo", "We couldn't work out where you are from the photo. Check your pickup pin on the map, then tap Where to?.");
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
        if (layer.id === 'ride') { openDestinationSearch(); return; }
        const route = SERVICE_ROUTES[layer.id];
        if (route) (navigation.navigate as any)(route);
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

    // Live sheet height (UI thread) so the pickup pin stays centred in the
    // map that is still visible while the sheet is dragged.
    const sheetHeight = useSharedValue(0);
    const pickupStyle = useAnimatedStyle(() => ({
        top: Math.max(insets.top + 84, (boxH - sheetHeight.value) / 2 - 40),
    }));

    // Swiping to a shop's card: fly the map to it and grow its pin. The map's
    // bottom padding follows the sheet, so the shop lands in the visible part.
    const selectShop = React.useCallback((shop: MapShop | null) => {
        setSelectedShopId(shop?.id ?? null);
        const target = shop ? { latitude: shop.lat, longitude: shop.lng } : { latitude: currentLat, longitude: currentLng };
        mapRef.current?.animateCamera({ center: target }, { duration: reducedMotion ? 0 : 450 });
    }, [currentLat, currentLng, reducedMotion]);

    const openShop = React.useCallback((shop: MapShop) => {
        Haptics.selectionAsync().catch(() => {});
        setSelectedShopId(shop.id);
        setActionShop(shop);
    }, []);

    const onShopAction = (action: ShopAction, shop: MapShop) => {
        const here = { latitude: currentLat, longitude: currentLng, address: 'Current Location' };
        switch (action) {
            case 'ride':
                navigation.navigate('RideConfirmation', {
                    pickup: here,
                    destination: { latitude: shop.lat, longitude: shop.lng, address: shop.address || shop.name },
                });
                break;
            case 'stop':
                // Pick where you're going; the shop rides along as a stop.
                navigation.navigate('DestinationSearch', {
                    currentLocation: here,
                    stop: { name: shop.name, latitude: shop.lat, longitude: shop.lng, address: shop.address, merchantId: shop.id, storeType: shop.store_type },
                });
                break;
            case 'deliver':
                (navigation.navigate as any)('ProductListing', {
                    merchant: {
                        id: shop.id, name: shop.name, store_type: shop.store_type, category: shop.category || shop.store_type,
                        address: shop.address || '', delivery_fee_cents: shop.delivery_fee_cents ?? 0,
                        avg_delivery_minutes: shop.avg_delivery_minutes ?? 30, is_open: shop.is_open, distance_meters: shop.distance_m,
                    },
                });
                break;
            default:
                break;
        }
    };

    const otherLayers = layers.filter(l => l.id !== 'ride' && !l.locked);
    const lockedLayer = layers.find(l => l.locked);
    const fieldBg = night ? m.sheet[1] : '#FFFFFF';

    return (
        <View style={{ flex: 1, backgroundColor: m.page }} onLayout={(e) => setBoxH(e.nativeEvent.layout.height)}>
            <StatusBar style={m.statusBar} />

            {/* Map — fills the top of the screen behind the sheet */}
            <MapView
                ref={mapRef}
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
                    <CarMarker key={d.id} lat={d.lat} lng={d.lng} heading={d.heading} glide={!reducedMotion} />
                ))}
                {touchPoints.map(p => (
                    <Marker key={`tp-${p.id}`} coordinate={{ latitude: p.lat, longitude: p.lng }} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}
                        accessibilityLabel={`G-Touch Point, ${p.name}`}
                        onPress={() => toast(`${p.name}: a G-Touch Point. Tap your phone or keychain here to book.`)}>
                        <View style={{ width: 28, height: 28, borderRadius: 9, backgroundColor: '#B65CFF', borderWidth: 2, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' }}>
                            <Ionicons name="radio" size={15} color="#FFFFFF" />
                        </View>
                    </Marker>
                ))}
                {shops.map(shop => (
                    <ShopPin key={`shop-${shop.id}`} shop={shop} selected={shop.id === selectedShopId} onPress={openShop} />
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
            <LinearGradient pointerEvents="none" colors={m.mapWash as any} style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 180 }} />

            {/* Your pickup, centred in the map that is still visible above the sheet */}
            <Reanimated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, right: 0, alignItems: 'center' }, pickupStyle]}>
                <View style={{ backgroundColor: m.sheet[1], borderRadius: 14, borderWidth: 2, borderBottomWidth: 4, borderColor: night ? '#3A3049' : '#ECE6F3', paddingHorizontal: 12, paddingVertical: 6, marginBottom: 6 }}>
                    <Txt variant="label">Your pickup</Txt>
                </View>
                <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(139,124,255,0.22)', alignItems: 'center', justifyContent: 'center' }}>
                    <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: '#8B7CFF', borderWidth: 3, borderColor: '#FFFFFF' }} />
                </View>
            </Reanimated.View>

            {/* Top bar: G greets you on the map, so it shows even with the sheet down */}
            <View style={{ position: 'absolute', top: insets.top + 12, left: GUTTER, right: GUTTER, flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', paddingLeft: 4, paddingRight: 14, paddingVertical: 4, borderRadius: 24,
                    backgroundColor: m.sheet[1], borderWidth: 2, borderBottomWidth: 4, borderColor: night ? '#3A3049' : '#ECE6F3', marginRight: SPACE.md }}>
                    <Image source={require('../../assets/logo.png')} resizeMode="contain" style={{ width: 38, height: 38 }} />
                    <View style={{ flexShrink: 1, marginLeft: 6 }}>
                        <Txt variant="headline" numberOfLines={1}>{g.hello}{firstName ? `, ${firstName}` : ''}</Txt>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <View style={{ width: 7, height: 7, borderRadius: 4, marginRight: 6, backgroundColor: realtimeDrivers.length > 0 ? '#2FB57C' : m.faint }} />
                            <Txt variant="caption" tone="dim" numberOfLines={1}>{realtimeDrivers.length > 0 ? driverSubText : 'Finding drivers near you'}</Txt>
                        </View>
                    </View>
                </View>
                <View>
                    <IconButton icon="notifications-outline" label="Notifications" tone="filled" onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); navigation.navigate('Notifications'); }} />
                    {unreadCount > 0 && <View pointerEvents="none" style={{ position: 'absolute', top: 8, right: 9, width: 9, height: 9, borderRadius: 5, backgroundColor: '#E5484D', borderWidth: 1.5, borderColor: m.sheet[1] }} />}
                </View>
            </View>

            {!systemStatus.stripe_ready && (
                <View style={{ position: 'absolute', top: insets.top + 74, left: GUTTER, right: GUTTER, flexDirection: 'row', alignItems: 'center', padding: SPACE.md, borderRadius: 14, backgroundColor: night ? 'rgba(245,158,11,0.16)' : '#FFF6E5' }}>
                    <Ionicons name="information-circle" size={16} color="#D97706" />
                    <Txt variant="caption" style={{ marginLeft: SPACE.sm, flex: 1 }}>Card payments are paused right now. Cash still works.</Txt>
                </View>
            )}

            {/* The Where-to sheet: drag it (or tap the handle) between peek, half and full */}
            {boxH > 0 && (
                <HomeSheet
                    available={Math.max(320, boxH - insets.top - 76)}
                    height={sheetHeight}
                    onSettled={setSheetH}
                    top={
                        <>
                        <Pressable
                            accessibilityRole="search" accessibilityLabel="Where to?"
                            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); openDestinationSearch(); }}
                            onPressIn={searchIn} onPressOut={searchOut}
                        >
                            <View style={{ borderRadius: 20, backgroundColor: '#5B4BD6' }}>
                                <Animated.View style={{ height: 60, borderRadius: 20, overflow: 'hidden', flexDirection: 'row', alignItems: 'center',
                                    paddingLeft: SPACE.lg, paddingRight: 8, transform: [{ translateY: searchDown }], marginBottom: 5 }}>
                                    <CrystalGradient colors={BRAND_GRADIENT} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFillObject} />
                                    <RaisedIcon name="search" size={22} />
                                    <Txt variant="headline" tone="onBrand" style={{ flex: 1, marginLeft: SPACE.md, fontSize: 19 }} numberOfLines={1}>{homeSuggestion || 'Where to?'}</Txt>
                                    {platformFlags.aiAssistant && (
                                        <Pressable
                                            accessibilityRole="button" accessibilityLabel="Ask G by voice"
                                            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setVoiceInputText(''); setVoiceModalVisible(true); }}
                                            hitSlop={6}
                                            style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center', marginRight: 6 }}
                                        >
                                            <RaisedIcon name="mic" size={20} />
                                        </Pressable>
                                    )}
                                    <Pressable
                                        accessibilityRole="button" accessibilityLabel="Ride with a photo of where you are"
                                        onPress={handleVisionSighting} hitSlop={6}
                                        style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center' }}
                                    >
                                        <RaisedIcon name="camera" size={20} />
                                    </Pressable>
                                </Animated.View>
                            </View>
                        </Pressable>
                        <ShopCarousel shops={shops} selectedId={selectedShopId} onSelect={selectShop} onOpen={openShop} />
                        </>
                    }
                >
                    {/* Your usual (only when there is a real habit) + saved places */}
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                        {usual && (
                            <Chip icon="repeat" label={`Again: ${usual.address.split(',')[0].slice(0, 22)}`} onPress={() => {
                                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                                navigation.navigate('RideConfirmation', {
                                    pickup: { latitude: currentLat, longitude: currentLng, address: 'Current Location' },
                                    destination: { latitude: usual.lat, longitude: usual.lng, address: usual.address },
                                });
                            }} />
                        )}
                        <Chip icon="home" label="Home" onPress={() => handleQuickAction('Home')} />
                        <Chip icon="briefcase" label="Work" onPress={() => handleQuickAction('Work')} />
                        <Chip icon="time" label="Recent" onPress={() => handleQuickAction('Recent')} />
                    </View>

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
                            <KeyTile
                                title={l.name}
                                icon={(i === 0 ? 'car-sport' : (l.icon || 'apps').replace('-sharp', '')) as any}
                                color={SERVICE_COLORS[l.id] || '#8B7CFF'}
                                onPress={() => handleLayerPrimary(l)}
                            />
                        </Pop>
                    ))}
                    {lockedLayer && (
                        <Pop delay={180 + (otherLayers.length + 1) * 50} style={{ width: '25%', paddingHorizontal: SPACE.xs, marginBottom: SPACE.md }}>
                            <KeyTile title={lockedLayer.name} icon="lock-closed" locked color={night ? '#4A4058' : '#C9C1D6'} onPress={() => toast(lockedLayer.label || `Keep riding to unlock ${lockedLayer.name}`)} />
                        </Pop>
                    )}
                </View>

                {/* G's line for you (the hello itself is on the map) */}
                <Pop>
                    <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
                        <Animated.Image source={require('../../assets/logo.png')} resizeMode="contain"
                            style={{ width: 92, height: 92, marginLeft: -14, marginRight: -10, transform: [{ translateY: mascotBob }] }} />
                        <View style={{ flex: 1, marginLeft: SPACE.sm, marginBottom: 6 }}>
                            <View style={{ backgroundColor: night ? '#2A2238' : '#FFFFFF', borderRadius: 18, borderWidth: 2, borderBottomWidth: 4,
                                borderColor: night ? '#3A3049' : '#ECE6F3', paddingHorizontal: SPACE.md, paddingVertical: SPACE.sm }}>
                                <Txt variant="overline" tone="accent">G SAYS</Txt>
                                <Txt variant="body" numberOfLines={3} style={{ marginTop: 2 }}>
                                    {isAiThinking || visionLoading
                                        ? (visionLoading ? 'Looking at your photo…' : 'Thinking…')
                                        : (aiGreeting && aiGreeting !== 'Where to next?' ? aiGreeting : `Where are we going ${g.when}?`)}
                                </Txt>
                            </View>
                            {/* bubble tail */}
                            <View style={{ position: 'absolute', left: -6, bottom: 14, width: 14, height: 14, transform: [{ rotate: '45deg' }],
                                backgroundColor: night ? '#2A2238' : '#FFFFFF', borderLeftWidth: 2, borderBottomWidth: 2, borderColor: night ? '#3A3049' : '#ECE6F3' }} />
                        </View>
                    </View>
                </Pop>

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
                </HomeSheet>
            )}

            <ShopActionSheet shop={actionShop} onClose={() => setActionShop(null)} onAction={onShopAction} />

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
