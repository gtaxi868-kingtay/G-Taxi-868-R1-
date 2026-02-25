import React, { useEffect, useState, useRef } from 'react';
import {
    View,
    StyleSheet,
    TouchableOpacity,
    Image,
    Animated,
    Dimensions,
    Platform,
    Pressable,
    Easing,
    Alert
} from 'react-native';
import MapView, { Marker, PROVIDER_DEFAULT, AnimatedRegion, UrlTile } from 'react-native-maps';
import * as Location from 'expo-location';
import { LinearGradient } from 'expo-linear-gradient';
import { DEFAULT_LOCATION, ENV } from '../../../../shared/env';
import { tokens } from '../design-system/tokens';
import { useAuth } from '../context/AuthContext';
import { Surface, Card, Txt } from '../design-system/primitives';
import { SavedPlaceModal } from '../components/SavedPlaceModal';
import { RecentRidesModal } from '../components/RecentRidesModal';
import { getOnlineDrivers, getSavedPlaces, savePlace, getRecentRides } from '../services/api';
import { Driver, SavedPlace, Location as RideLocation } from '../types/ride';
import { Sidebar } from '../components/Sidebar';
import { useNearbyDrivers } from '../hooks/useNearbyDrivers';
import { supabase } from '../../../../shared/supabase';

const { width, height } = Dimensions.get('window');
const CAR_ASSET_STANDARD = require('../../assets/images/car_gtaxi_standard_v7.png');

export function HomeScreen({ navigation }: any) {
    const [location, setLocation] = useState<Location.LocationObject | null>(null);
    const [drivers, setDrivers] = useState<Driver[]>([]);
    const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([]);
    const [recentRides, setRecentRides] = useState<RideLocation[]>([]);
    const [activeModalLabel, setActiveModalLabel] = useState<string | null>(null);
    const [showRecentModal, setShowRecentModal] = useState(false);

    // Menu State
    const [isMenuOpen, setIsMenuOpen] = useState(false);

    // Phase 8: Database Feature Flags
    const [featureFlags, setFeatureFlags] = useState({ grocery: false, laundry: false });

    // Animations
    const bottomSheetAnim = useRef(new Animated.Value(100)).current; // Slide up
    const pulseAnim = useRef(new Animated.Value(1)).current;

    // Auth for sidebar user data
    const { profile } = useAuth();

    const fetchPlaces = async () => {
        const places = await getSavedPlaces();
        setSavedPlaces(places);
    };

    useEffect(() => {
        (async () => {
            try {
                const { status } = await Location.requestForegroundPermissionsAsync();
                if (status === 'granted') {
                    const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
                    setLocation(current);
                }
                const onlineDrivers = await getOnlineDrivers();
                setDrivers(onlineDrivers);
            } catch (error) {
                console.log('Location error:', error);
            }
        })();
        fetchPlaces();

        // Phase 8: Fetch System feature flags safely
        supabase.from('system_feature_flags').select('module_name, is_enabled').then(({ data }) => {
            if (data) {
                const flags = { grocery: false, laundry: false };
                data.forEach(flag => {
                    if (flag.module_name === 'grocery') flags.grocery = flag.is_enabled;
                    if (flag.module_name === 'laundry') flags.laundry = flag.is_enabled;
                });
                setFeatureFlags(flags);
            }
        });

        // Reveal Animation
        Animated.spring(bottomSheetAnim, {
            toValue: 0,
            useNativeDriver: true,
            damping: 20,
            mass: 1,
            stiffness: 100,
        }).start();

        // Driver Pulse
        Animated.loop(
            Animated.sequence([
                Animated.timing(pulseAnim, { toValue: 1.2, duration: 1500, useNativeDriver: true }),
                Animated.timing(pulseAnim, { toValue: 1, duration: 1500, useNativeDriver: true }),
            ])
        ).start();


    }, []);



    // --- REAL-TIME DRIVERS (from database) ---
    const currentLat = location?.coords.latitude || DEFAULT_LOCATION.latitude;
    const currentLng = location?.coords.longitude || DEFAULT_LOCATION.longitude;
    const { drivers: realtimeDrivers, loading: driversLoading } = useNearbyDrivers(currentLat, currentLng);

    const handleQuickAction = async (label: string) => {
        if (label === 'Home' || label === 'Work') {
            const place = savedPlaces.find(p => p.label === label);
            if (place) {
                navigation.navigate('RideConfirmation', {
                    destination: { latitude: place.lat, longitude: place.lng, address: place.address },
                    pickup: location ? { latitude: location.coords.latitude, longitude: location.coords.longitude, address: 'Current Location' } : undefined
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

    const handleSavePlace = async (label: string, address: string) => {
        const mockLat = (location?.coords.latitude || DEFAULT_LOCATION.latitude) + (Math.random() - 0.5) * 0.01;
        const mockLng = (location?.coords.longitude || DEFAULT_LOCATION.longitude) + (Math.random() - 0.5) * 0.01;
        await savePlace({ label, address, lat: mockLat, lng: mockLng, icon: label === 'Home' ? '🏠' : '💼' });
        await fetchPlaces();
    };

    return (
        <View style={styles.container}>
            {/* 3D Map Background */}
            <MapView
                style={styles.map}
                provider={PROVIDER_DEFAULT}
                initialRegion={{
                    latitude: currentLat,
                    longitude: currentLng,
                    latitudeDelta: 0.015,
                    longitudeDelta: 0.015,
                }}
                camera={{
                    center: { latitude: currentLat, longitude: currentLng },
                    pitch: 45, // 3D Tilt
                    heading: 0,
                    altitude: 1000,
                    zoom: 15
                }}
                pitchEnabled
                rotateEnabled
                showsUserLocation
                userInterfaceStyle="dark"
            >
                {/* Mapbox Dark Style Overlay - Restores the Premium Look */}
                {UrlTile && ENV?.MAPBOX_PUBLIC_TOKEN && (
                    <UrlTile
                        urlTemplate={`https://api.mapbox.com/styles/v1/mapbox/dark-v11/tiles/256/{z}/{x}/{y}@2x?access_token=${ENV.MAPBOX_PUBLIC_TOKEN}`}
                        shouldReplaceMapContent={true}
                        maximumZ={19}
                        flipY={false}
                    />
                )}

                {/* Real-Time Driver Markers from Database */}
                {realtimeDrivers.map((driver) => (
                    <Marker.Animated
                        key={driver.id}
                        coordinate={{
                            latitude: driver.lat as any,
                            longitude: driver.lng as any,
                        } as any}
                        anchor={{ x: 0.5, y: 0.5 }}
                        rotation={driver.heading || 0}
                    >
                        <Image
                            source={CAR_ASSET_STANDARD}
                            style={{
                                width: tokens.markers.car.width,
                                height: tokens.markers.car.height,
                            }}
                            resizeMode="contain"
                        />
                    </Marker.Animated>
                ))}
            </MapView>



            {/* Gradient Overlay for Depth */}
            <LinearGradient
                colors={['transparent', 'rgba(5, 5, 10, 0.5)', tokens.colors.background.base]}
                style={styles.gradientOverlay}
                pointerEvents="none"
            />

            {/* Menu Button - Top Left */}
            <TouchableOpacity
                style={[styles.menuBtn, { top: 60 }]}
                onPress={() => setIsMenuOpen(true)}
                activeOpacity={0.8}
            >
                <Surface style={styles.menuSurface} intensity={30}>
                    <Txt variant="headingM">≡</Txt>
                </Surface>
            </TouchableOpacity>

            {/* SIDEBAR OVERLAY */}
            <Sidebar
                visible={isMenuOpen}
                onClose={() => setIsMenuOpen(false)}
                navigation={navigation}
                user={{
                    name: profile?.full_name || 'Rider',
                    rating: 5.0,
                    photo_url: profile?.avatar_url ?? undefined,
                }}
            />

            {/* Bottom Floating Card (Hybrid Style) */}
            <Animated.View style={[styles.bottomContainer, { transform: [{ translateY: bottomSheetAnim }] }]}>
                {/* Visual Depth Card */}
                <Surface style={styles.glassSearchCard} intensity={40}>
                    {/* PHASE 8: Dynamic Service Tiles based on Feature Flags */}
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 }}>
                        <TouchableOpacity style={styles.serviceTile}>
                            <Txt variant="headingM">🚗</Txt>
                            <Txt variant="caption" weight="bold" color={tokens.colors.text.primary} style={{ marginTop: 4 }}>Rides</Txt>
                        </TouchableOpacity>

                        {featureFlags.grocery && (
                            <TouchableOpacity style={styles.serviceTile} onPress={() => Alert.alert('Coming Soon', 'Grocery delivery is rolling out in your area soon.')}>
                                <Txt variant="headingM">🛒</Txt>
                                <Txt variant="caption" weight="bold" color={tokens.colors.text.primary} style={{ marginTop: 4 }}>Grocery</Txt>
                            </TouchableOpacity>
                        )}

                        {featureFlags.laundry && (
                            <TouchableOpacity style={styles.serviceTile} onPress={() => Alert.alert('Coming Soon', 'Laundry pickup is rolling out in your area soon.')}>
                                <Txt variant="headingM">🧺</Txt>
                                <Txt variant="caption" weight="bold" color={tokens.colors.text.primary} style={{ marginTop: 4 }}>Laundry</Txt>
                            </TouchableOpacity>
                        )}
                    </View>

                    {/* Primary Search Bar */}
                    <TouchableOpacity
                        activeOpacity={0.9}
                        onPress={() => navigation.navigate('DestinationSearch', { currentLocation: { latitude: currentLat, longitude: currentLng } })}
                        style={styles.searchBarHybrid}
                    >
                        <View style={styles.searchSquareHybrid} />
                        <Txt variant="headingM" weight="bold" style={styles.whereToTextHybrid}>Where to?</Txt>

                        {/* Scheduling Pill (Uber Feature) */}
                        <TouchableOpacity style={styles.schedulePill} onPress={(e) => {
                            e.stopPropagation();
                            // Logic for scheduling picker would go here
                        }}>
                            <Surface style={styles.scheduleSurface} intensity={25}>
                                <Txt variant="caption" weight="bold">Now ▼</Txt>
                            </Surface>
                        </TouchableOpacity>
                    </TouchableOpacity>

                    {/* Quick Places List (Integrated Uber Functionality + G-Taxi Sleekness) */}
                    <View style={styles.quickPlacesIntegrated}>
                        <TouchableOpacity style={styles.placePillHybrid} onPress={() => handleQuickAction('Home')}>
                            <Surface style={styles.pillIconGlass} intensity={20}>
                                <Txt>🏠</Txt>
                            </Surface>
                            <Txt variant="bodyBold" style={{ marginLeft: 8 }}>Home</Txt>
                        </TouchableOpacity>

                        <TouchableOpacity style={styles.placePillHybrid} onPress={() => handleQuickAction('Work')}>
                            <Surface style={styles.pillIconGlass} intensity={20}>
                                <Txt>💼</Txt>
                            </Surface>
                            <Txt variant="bodyBold" style={{ marginLeft: 8 }}>Work</Txt>
                        </TouchableOpacity>

                        <TouchableOpacity style={styles.recentPillHybrid} onPress={() => handleQuickAction('Recent')}>
                            <Surface style={styles.pillIconGlass} intensity={20}>
                                <Txt>🕐</Txt>
                            </Surface>
                        </TouchableOpacity>
                    </View>
                </Surface>
            </Animated.View>

            {/* Modals */}
            <SavedPlaceModal
                visible={!!activeModalLabel}
                defaultLabel={activeModalLabel || ''}
                onClose={() => setActiveModalLabel(null)}
                onSave={handleSavePlace}
            />
            <RecentRidesModal
                visible={showRecentModal}
                onClose={() => setShowRecentModal(false)}
                onSelect={(loc) => {
                    setShowRecentModal(false);
                    navigation.navigate('RideConfirmation', {
                        destination: { latitude: loc.latitude, longitude: loc.longitude, address: loc.address },
                        pickup: location ? { latitude: location.coords.latitude, longitude: location.coords.longitude, address: 'Current Location' } : undefined
                    });
                }}
                recentLocations={recentRides}
            />
        </View >
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: tokens.colors.background.base,
    },
    serviceTile: {
        flex: 1,
        alignItems: 'center',
        paddingVertical: 12,
        backgroundColor: 'rgba(255,255,255,0.05)',
        borderRadius: 16,
        marginHorizontal: 4,
    },
    map: {
        width: width,
        height: height,
    },
    gradientOverlay: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: height * 0.4,
    },
    bottomContainer: {
        position: 'absolute',
        bottom: 30,
        left: 20,
        right: 20,
    },

    glassSearchCard: {
        backgroundColor: 'rgba(10, 10, 21, 0.8)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.08)',
        borderRadius: 24,
    },
    searchBarHybrid: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 20,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255,255,255,0.05)',
    },
    searchSquareHybrid: {
        width: 10,
        height: 10,
        backgroundColor: '#FFF',
        marginRight: 16,
    },
    whereToTextHybrid: {
        flex: 1,
        color: '#FFF',
    },
    schedulePill: {
        marginLeft: 8,
    },
    scheduleSurface: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 16,
        backgroundColor: 'rgba(255,255,255,0.05)',
    },
    quickPlacesIntegrated: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        gap: 12,
    },
    placePillHybrid: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(255,255,255,0.03)',
        padding: 10,
        borderRadius: 12,
    },
    pillIconGlass: {
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(255,255,255,0.05)',
    },
    recentPillHybrid: {
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
    },
    menuBtn: {
        position: 'absolute',
        left: 20,
        zIndex: 50,
    },
    menuSurface: {
        width: 48,
        height: 48,
        borderRadius: 24,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(5, 5, 10, 0.7)',
    },
});
