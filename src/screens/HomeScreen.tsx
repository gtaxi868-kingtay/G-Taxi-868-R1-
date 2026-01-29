import React, { useEffect, useState, useRef } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    SafeAreaView,
    ActivityIndicator,
    Platform,
    Image,
    Animated,
    Dimensions,
} from 'react-native';
import * as Location from 'expo-location';
import { DEFAULT_LOCATION } from '../config/env';
import { theme } from '../theme';
import { RainBackground } from '../components/RainBackground';
import { GlassView } from '../components/GlassView';
import { GlassButton } from '../components/GlassButton';
import { MapComponent } from '../components/MapComponent';
import { SavedPlaceModal } from '../components/SavedPlaceModal';
import { RecentRidesModal } from '../components/RecentRidesModal';
import { getOnlineDrivers, getSavedPlaces, savePlace, getRecentRides } from '../services/api';
import { Driver, SavedPlace, Location as RideLocation } from '../types/ride';

const { width, height } = Dimensions.get('window');

interface HomeScreenProps {
    navigation: any;
}

export function HomeScreen({ navigation }: HomeScreenProps) {
    const [location, setLocation] = useState<Location.LocationObject | null>(null);
    const [loading, setLoading] = useState(true);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [drivers, setDrivers] = useState<Driver[]>([]); // Ghost Cars state
    const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([]);
    const [recentRides, setRecentRides] = useState<RideLocation[]>([]);
    const [activeModalLabel, setActiveModalLabel] = useState<string | null>(null); // 'Home', 'Work', or null
    const [showRecentModal, setShowRecentModal] = useState(false);

    const pulseAnim = useRef(new Animated.Value(1)).current;

    const fetchPlaces = async () => {
        const places = await getSavedPlaces();
        setSavedPlaces(places);
    };

    useEffect(() => {
        (async () => {
            try {
                const { status } = await Location.requestForegroundPermissionsAsync();
                if (status !== 'granted') {
                    setErrorMsg('Location permission denied');
                    setLoading(false);
                    return;
                }

                const currentLocation = await Location.getCurrentPositionAsync({
                    accuracy: Location.Accuracy.Balanced,
                });
                setLocation(currentLocation);

                // Once we have location, fetch nearby drivers
                console.log('[Home] Fetching drivers...');
                const onlineDrivers = await getOnlineDrivers();
                console.log('[Home] Drivers loaded:', onlineDrivers.length);
                setDrivers(onlineDrivers); // Initial seed

            } catch (error) {
                console.log('Location error:', error);
                setErrorMsg('Using default location');
            } finally {
                setLoading(false);
            }
        })();

        fetchPlaces();
    }, []);

    // Ghost Car Simulation Loop
    useEffect(() => {
        if (drivers.length === 0) return;

        const interval = setInterval(() => {
            setDrivers(currentDrivers =>
                currentDrivers.map(d => ({
                    ...d,
                    // Jitter position slightly to simulate driving
                    lat: d.lat + (Math.random() - 0.5) * 0.0002, // ~20 meters
                    lng: d.lng + (Math.random() - 0.5) * 0.0002,
                    heading: d.heading + (Math.random() - 0.5) * 10, // Slight turn
                }))
            );
        }, 3000); // Update every 3 seconds

        return () => clearInterval(interval);
    }, [drivers.length > 0]);

    useEffect(() => {
        // Pulse animation
        Animated.loop(
            Animated.sequence([
                Animated.timing(pulseAnim, {
                    toValue: 1.2,
                    duration: 1500,
                    useNativeDriver: Platform.OS !== 'web',
                }),
                Animated.timing(pulseAnim, {
                    toValue: 1,
                    duration: 1500,
                    useNativeDriver: Platform.OS !== 'web',
                }),
            ])

        ).start();
    }, []);

    const handleQuickAction = async (label: string) => {
        if (label === 'Home' || label === 'Work') {
            const place = savedPlaces.find(p => p.label === label);
            if (place) {
                // Navigate to Ride Confirmation with saved destination
                navigation.navigate('RideConfirmation', {
                    destination: {
                        latitude: place.lat,
                        longitude: place.lng,
                        address: place.address,
                    },
                    pickup: location ? {
                        latitude: location.coords.latitude,
                        longitude: location.coords.longitude,
                        address: 'Current Location',
                    } : undefined
                });
            } else {
                // Prompt to save
                setActiveModalLabel(label);
            }
        } else if (label === 'Recent') {
            setLoading(true);
            const recents: RideLocation[] = await getRecentRides(); // Explicit type
            setRecentRides(recents);
            setLoading(false);
            setShowRecentModal(true);
        } else {
            // For now, these are placeholders
            console.log('Action:', label);
        }
    };

    const handleRecentSelect = (selectedLocation: RideLocation) => {
        navigation.navigate('RideConfirmation', {
            destination: {
                latitude: selectedLocation.latitude,
                longitude: selectedLocation.longitude,
                address: selectedLocation.address,
            },
            pickup: location ? {
                latitude: location.coords.latitude,
                longitude: location.coords.longitude,
                address: 'Current Location',
            } : undefined
        });
    };

    const handleSavePlace = async (label: string, address: string) => {
        // In a real app, we'd Geocode the address here to get lat/lng
        // For now, we'll mock it relative to current location or default
        const mockLat = (location?.coords.latitude || DEFAULT_LOCATION.latitude) + (Math.random() - 0.5) * 0.05;
        const mockLng = (location?.coords.longitude || DEFAULT_LOCATION.longitude) + (Math.random() - 0.5) * 0.05;

        await savePlace({
            label,
            address,
            lat: mockLat,
            lng: mockLng,
            icon: label === 'Home' ? '🏠' : '💼',
        });
        await fetchPlaces();
    };

    const currentLat = location?.coords.latitude ?? DEFAULT_LOCATION.latitude;
    const currentLng = location?.coords.longitude ?? DEFAULT_LOCATION.longitude;

    return (
        <View style={styles.container}>
            {/* Reusable Rain Background Component */}
            <RainBackground />

            <SafeAreaView style={styles.safeArea}>
                {/* Header with Glass Button */}
                <View style={styles.header}>
                    <TouchableOpacity
                        style={styles.menuButton}
                        onPress={() => navigation.navigate('Profile')}
                        activeOpacity={0.7}
                    >
                        <GlassView style={styles.menuButtonInner} intensity="medium">
                            <Text style={styles.menuIcon}>☰</Text>
                        </GlassView>
                    </TouchableOpacity>

                    {/* Large Logo */}
                    <Image
                        source={require('../../assets/logo.png')}
                        style={styles.headerLogo}
                        resizeMode="contain"
                    />

                    <View style={styles.placeholder} />
                </View>

                {/* Map Area - Real Map (Cross Platform) */}
                <View style={styles.mapContainer}>
                    <MapComponent
                        location={location}
                        loading={loading}
                        currentLat={currentLat}
                        currentLng={currentLng}
                        drivers={drivers}
                    />
                </View>

                {/* Bottom Glass Card - Using GlassView container */}
                <GlassView style={styles.bottomCard} intensity="heavy">
                    {/* Main CTA */}
                    <TouchableOpacity
                        style={styles.searchButton}
                        onPress={() => navigation.navigate('DestinationSearch', {
                            currentLocation: { latitude: currentLat, longitude: currentLng }
                        })}
                        activeOpacity={0.8}
                    >
                        <View style={styles.searchIconContainer}>
                            <Text style={styles.searchIcon}>📍</Text>
                        </View>
                        <View style={styles.searchTextContainer}>
                            <Text style={styles.searchTitle}>Where to?</Text>
                            <Text style={styles.searchSubtitle}>Set your destination</Text>
                        </View>
                        <View style={styles.searchArrow}>
                            <Text style={styles.arrowText}>→</Text>
                        </View>
                    </TouchableOpacity>

                    {/* Quick Actions - Glass buttons */}
                    <View style={styles.quickActions}>
                        {[
                            { icon: '🏠', label: 'Home' },
                            { icon: '💼', label: 'Work' },
                            { icon: '⭐', label: 'Saved' },
                            { icon: '🕐', label: 'Recent' },
                        ].map((item, index) => (
                            <TouchableOpacity
                                key={index}
                                style={styles.quickAction}
                                activeOpacity={0.7}
                                onPress={() => handleQuickAction(item.label)}
                            >
                                <GlassView style={styles.quickActionGlass} intensity="light">
                                    <Text style={styles.quickActionIcon}>{item.icon}</Text>
                                </GlassView>
                                <Text style={styles.quickActionLabel}>{item.label}</Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                </GlassView>
            </SafeAreaView>

            {/* Saved Place Modal */}
            <SavedPlaceModal
                visible={!!activeModalLabel}
                defaultLabel={activeModalLabel || ''}
                onClose={() => setActiveModalLabel(null)}
                onSave={handleSavePlace}
            />

            {/* Recent Rides Modal */}
            <RecentRidesModal
                visible={showRecentModal}
                onClose={() => setShowRecentModal(false)}
                onSelect={handleRecentSelect}
                recentLocations={recentRides}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: theme.colors.background.primary,
    },
    safeArea: {
        flex: 1,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: theme.spacing.lg,
        paddingVertical: theme.spacing.md,
    },
    menuButton: {
        width: 48,
        height: 48,
    },
    menuButtonInner: {
        width: '100%',
        height: '100%',
        justifyContent: 'center',
        alignItems: 'center',
        borderRadius: theme.borderRadius.lg,
    },
    menuIcon: {
        fontSize: 20,
        color: theme.colors.text.primary,
    },
    headerLogo: {
        width: 56,
        height: 56,
    },
    placeholder: {
        width: 48,
    },
    mapContainer: {
        flex: 1,
        marginHorizontal: theme.spacing.lg,
        marginTop: theme.spacing.lg,
        marginBottom: theme.spacing.md,
        borderRadius: theme.borderRadius.xxl,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: theme.colors.glass.border,
    },
    map: {
        width: '100%',
        height: '100%',
    },
    mapLoaderOverlay: {
        ...StyleSheet.absoluteFillObject,
        justifyContent: 'center',
        alignItems: 'center',
    },
    bottomCard: {
        borderTopLeftRadius: theme.borderRadius.xxl,
        borderTopRightRadius: theme.borderRadius.xxl,
        paddingHorizontal: theme.spacing.xl,
        paddingTop: theme.spacing.xxl,
        paddingBottom: Platform.OS === 'ios' ? 34 : theme.spacing.xxl,
        borderBottomWidth: 0,
    },
    searchButton: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: theme.colors.glass.backgroundLight,
        borderRadius: theme.borderRadius.xl,
        padding: theme.spacing.lg,
        borderWidth: 2,
        borderColor: theme.colors.brand.primary,
        ...theme.shadows.glow,
    },
    searchIconContainer: {
        width: 52,
        height: 52,
        borderRadius: theme.borderRadius.lg,
        backgroundColor: theme.colors.brand.primary,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: theme.spacing.md,
    },
    searchIcon: {
        fontSize: 24,
    },
    searchTextContainer: {
        flex: 1,
    },
    searchTitle: {
        fontSize: theme.typography.sizes.xl,
        fontWeight: theme.typography.weights.bold,
        color: theme.colors.text.primary,
    },
    searchSubtitle: {
        fontSize: theme.typography.sizes.sm,
        color: theme.colors.text.secondary,
        marginTop: 2,
    },
    searchArrow: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: theme.colors.glass.background,
        borderWidth: 1,
        borderColor: theme.colors.glass.border,
        justifyContent: 'center',
        alignItems: 'center',
    },
    arrowText: {
        fontSize: 18,
        color: theme.colors.brand.primary,
        fontWeight: theme.typography.weights.bold,
    },
    quickActions: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginTop: theme.spacing.xxl,
    },
    quickAction: {
        alignItems: 'center',
    },
    quickActionGlass: {
        width: 60,
        height: 60,
        borderRadius: theme.borderRadius.lg,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: theme.spacing.sm,
    },
    quickActionIcon: {
        fontSize: 24,
    },
    quickActionLabel: {
        fontSize: theme.typography.sizes.xs,
        color: theme.colors.text.secondary,
        fontWeight: theme.typography.weights.medium,
    },
});
