import React, { useEffect, useState, useRef } from 'react';
import {
    View, StyleSheet, TouchableOpacity, Image,
    Dimensions, Alert, Platform
} from 'react-native';
import MapView, { Marker, PROVIDER_DEFAULT, UrlTile } from 'react-native-maps';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Reanimated, {
    useSharedValue, withSpring, withTiming,
    useAnimatedStyle, withDelay,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { DEFAULT_LOCATION, ENV } from '../../../../shared/env';
import { useAuth } from '../context/AuthContext';
import { useNearbyDrivers } from '../hooks/useNearbyDrivers';
import { supabase } from '../../../../shared/supabase';
import { Txt, Card, Surface } from '../design-system/primitives';
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
    const [activeModalLabel, setActiveModalLabel] = useState<string | null>(null);
    const [showRecentModal, setShowRecentModal] = useState(false);

    // Reanimated
    const panelY = useSharedValue(120);
    const mapPitch = useSharedValue(45);

    useEffect(() => {
        // Location & Initialization
        (async () => {
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status === 'granted') {
                const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
                setLocation(current);
            }
        })();

        // Fetch Places
        fetchPlaces();

        // Fetch Feature Flags
        supabase.from('system_feature_flags').select('id, is_active').then(({ data }) => {
            if (data) {
                const flags = { grocery: false, laundry: false };
                data.forEach(f => {
                    if (f.id === 'grocery_module') flags.grocery = f.is_active;
                    if (f.id === 'laundry_module') flags.laundry = f.is_active;
                });
                setFeatureFlags(flags);
            }
        });

        // Animations
        panelY.value = withSpring(0, { damping: 18, stiffness: 120 });
        mapPitch.value = withDelay(1000, withTiming(30, { duration: 1500 }));

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

            <LinearGradient colors={['rgba(7,5,15,0.4)', 'transparent', 'rgba(7,5,15,0.8)']} style={StyleSheet.absoluteFill} pointerEvents="none" />

            {/* Menu ≡ */}
            <TouchableOpacity
                style={[s.menuBtn, { top: insets.top + 10 }]}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setIsMenuOpen(true); }}
            >
                <BlurView tint="dark" intensity={100} style={s.menuCircle}>
                    <Ionicons name="menu-outline" size={24} color="#FFF" />
                </BlurView>
            </TouchableOpacity>

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
            <Reanimated.View style={[s.panel, animatedPanel, { paddingBottom: insets.bottom + 20 }]}>
                <BlurView tint="dark" intensity={80} style={s.blurCard}>
                    <View style={s.cardInner}>

                        {/* Service Tiles */}
                        <View style={s.tiles}>
                            <TouchableOpacity style={{ flex: 1 }}>
                                <Card padding="xs" intensity={50} style={[{ height: 80, alignItems: 'center', justifyContent: 'center' }, s.tileActive]}>
                                    <Ionicons name="car" size={24} color="#FFF" />
                                    <Txt variant="caption" weight="bold" color="#FFF" style={{ marginTop: 6 }}>Rides</Txt>
                                </Card>
                            </TouchableOpacity>

                            {featureFlags.grocery && (
                                <TouchableOpacity style={{ flex: 1 }} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); Alert.alert("Coming Soon"); }}>
                                    <Card padding="xs" intensity={15} style={{ height: 80, alignItems: 'center', justifyContent: 'center' }}>
                                        <Ionicons name="cart-outline" size={24} color="rgba(255,255,255,0.4)" />
                                        <Txt variant="caption" weight="bold" color="rgba(255,255,255,0.4)" style={{ marginTop: 6 }}>Grocery</Txt>
                                    </Card>
                                </TouchableOpacity>
                            )}

                            {featureFlags.laundry && (
                                <TouchableOpacity style={{ flex: 1 }} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); Alert.alert("Coming Soon"); }}>
                                    <Card padding="xs" intensity={15} style={{ height: 80, alignItems: 'center', justifyContent: 'center' }}>
                                        <Ionicons name="shirt-outline" size={24} color="rgba(255,255,255,0.4)" />
                                        <Txt variant="caption" weight="bold" color="rgba(255,255,255,0.4)" style={{ marginTop: 6 }}>Laundry</Txt>
                                    </Card>
                                </TouchableOpacity>
                            )}
                        </View>

                        {/* Search Bar: "Where to?" bold white */}
                        <TouchableOpacity
                            onPress={() => {
                                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                                navigation.navigate('DestinationSearch', { currentLocation: { latitude: currentLat, longitude: currentLng } });
                            }}
                        >
                            <Surface intensity={20} style={s.searchBarInner}>
                                <View style={s.dot} />
                                <Txt variant="headingM" weight="heavy" color="#FFF" style={{ flex: 1 }}>Where to?</Txt>
                            </Surface>
                        </TouchableOpacity>

                        {/* Quick pills */}
                        <View style={s.pills}>
                            <TouchableOpacity style={s.pill} onPress={() => handleQuickAction('Home')}>
                                <Ionicons name="home-outline" size={16} color="#FFF" />
                                <Txt variant="bodyBold" color="#FFF" style={{ marginLeft: 8 }}>Home</Txt>
                            </TouchableOpacity>
                            <TouchableOpacity style={s.pill} onPress={() => handleQuickAction('Work')}>
                                <Ionicons name="briefcase-outline" size={16} color="#FFF" />
                                <Txt variant="bodyBold" color="#FFF" style={{ marginLeft: 8 }}>Work</Txt>
                            </TouchableOpacity>
                            <TouchableOpacity style={s.recentPill} onPress={() => handleQuickAction('Recent')}>
                                <Ionicons name="time-outline" size={20} color="rgba(255,255,255,0.4)" />
                            </TouchableOpacity>
                        </View>

                    </View>
                </BlurView>
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
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: '#07050F' },
    map: { width, height },
    carMarker: { width: 34, height: 34 },
    menuBtn: { position: 'absolute', left: 20, zIndex: 100 },
    menuCircle: { width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center', borderTopWidth: 1, borderBottomWidth: 1, borderColor: 'rgba(255,255,255,0.1)', overflow: 'hidden' },

    panel: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 20 },
    blurCard: { borderRadius: 32, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
    cardInner: { padding: 24 },

    tiles: { flexDirection: 'row', gap: 12, marginBottom: 24 },
    tileActive: { backgroundColor: '#7C3AED' },

    searchBarInner: { flexDirection: 'row', alignItems: 'center', height: 64, borderRadius: 20, paddingHorizontal: 20, marginBottom: 20, overflow: 'hidden' },
    dot: { width: 10, height: 10, backgroundColor: '#FFF', marginRight: 16 },

    pills: { flexDirection: 'row', gap: 10, alignItems: 'center' },
    pill: { flex: 1, flexDirection: 'row', alignItems: 'center', height: 48, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 16, paddingHorizontal: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.03)' },
    recentPill: { width: 48, height: 48, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.03)', alignItems: 'center', justifyContent: 'center' },
});
