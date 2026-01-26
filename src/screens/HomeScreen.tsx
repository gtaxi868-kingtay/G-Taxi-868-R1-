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

const { width, height } = Dimensions.get('window');

interface HomeScreenProps {
    navigation: any;
}

export function HomeScreen({ navigation }: HomeScreenProps) {
    const [location, setLocation] = useState<Location.LocationObject | null>(null);
    const [loading, setLoading] = useState(true);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    const pulseAnim = useRef(new Animated.Value(1)).current;

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
            } catch (error) {
                console.log('Location error:', error);
                setErrorMsg('Using default location');
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    useEffect(() => {
        // Pulse animation
        Animated.loop(
            Animated.sequence([
                Animated.timing(pulseAnim, {
                    toValue: 1.2,
                    duration: 1500,
                    useNativeDriver: true,
                }),
                Animated.timing(pulseAnim, {
                    toValue: 1,
                    duration: 1500,
                    useNativeDriver: true,
                }),
            ])
        ).start();
    }, []);

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

                {/* Map Area - Glass Container */}
                <View style={styles.mapContainer}>
                    <GlassView style={styles.glassMap} intensity="medium">
                        {loading ? (
                            <View style={styles.loadingContainer}>
                                <ActivityIndicator size="large" color={theme.colors.brand.primary} />
                                <Text style={styles.loadingText}>Getting location...</Text>
                            </View>
                        ) : (
                            <View style={styles.locationDisplay}>
                                <Animated.View
                                    style={[
                                        styles.locationPulse,
                                        { transform: [{ scale: pulseAnim }] }
                                    ]}
                                />
                                <View style={styles.locationDot}>
                                    <View style={styles.locationDotInner} />
                                </View>
                                <Text style={styles.coordsLabel}>YOUR LOCATION</Text>
                                <Text style={styles.coords}>
                                    {currentLat.toFixed(4)}°, {currentLng.toFixed(4)}°
                                </Text>
                            </View>
                        )}
                    </GlassView>
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
                            <TouchableOpacity key={index} style={styles.quickAction} activeOpacity={0.7}>
                                <GlassView style={styles.quickActionGlass} intensity="light">
                                    <Text style={styles.quickActionIcon}>{item.icon}</Text>
                                </GlassView>
                                <Text style={styles.quickActionLabel}>{item.label}</Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                </GlassView>
            </SafeAreaView>
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
        margin: theme.spacing.lg,
        borderRadius: theme.borderRadius.xxl,
        overflow: 'hidden',
    },
    glassMap: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        borderRadius: theme.borderRadius.xxl,
    },
    loadingContainer: {
        alignItems: 'center',
    },
    loadingText: {
        marginTop: theme.spacing.md,
        color: theme.colors.text.secondary,
        fontSize: theme.typography.sizes.md,
    },
    locationDisplay: {
        alignItems: 'center',
    },
    locationPulse: {
        position: 'absolute',
        width: 80,
        height: 80,
        borderRadius: 40,
        backgroundColor: theme.colors.brand.glow,
        opacity: 0.3,
    },
    locationDot: {
        width: 60,
        height: 60,
        borderRadius: 30,
        backgroundColor: theme.colors.glass.backgroundLight,
        borderWidth: 2,
        borderColor: theme.colors.brand.primary,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: theme.spacing.lg,
        ...theme.shadows.glow,
    },
    locationDotInner: {
        width: 16,
        height: 16,
        borderRadius: 8,
        backgroundColor: theme.colors.brand.primary,
    },
    coordsLabel: {
        fontSize: theme.typography.sizes.xs,
        fontWeight: theme.typography.weights.bold,
        color: theme.colors.text.tertiary,
        letterSpacing: 2,
        marginBottom: theme.spacing.xs,
    },
    coords: {
        color: theme.colors.text.secondary,
        fontSize: theme.typography.sizes.sm,
        fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
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
