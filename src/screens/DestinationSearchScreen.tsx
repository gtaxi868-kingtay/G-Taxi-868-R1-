import React, { useState, useRef, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TextInput,
    TouchableOpacity,
    SafeAreaView,
    FlatList,
    Animated,
    Dimensions,
    Platform,
} from 'react-native';
import { theme } from '../theme';

const { width, height } = Dimensions.get('window');

// Mock destinations - will be replaced with Mapbox Geocoding
const MOCK_DESTINATIONS = [
    { id: '1', name: 'Piarco International Airport', address: 'Golden Grove Road, Piarco', lat: 10.5956, lng: -61.3372 },
    { id: '2', name: 'Queen\'s Park Savannah', address: 'Queen\'s Park West, Port of Spain', lat: 10.6718, lng: -61.5175 },
    { id: '3', name: 'Maracas Beach', address: 'North Coast Road, Maracas Bay', lat: 10.7583, lng: -61.4292 },
    { id: '4', name: 'MovieTowne', address: 'Invaders Bay, Port of Spain', lat: 10.6533, lng: -61.5283 },
    { id: '5', name: 'Trincity Mall', address: 'Churchill Roosevelt Highway, Trincity', lat: 10.6108, lng: -61.3511 },
];

interface DestinationSearchScreenProps {
    navigation: any;
    route?: {
        params?: {
            currentLocation?: { latitude: number; longitude: number };
        };
    };
}

export function DestinationSearchScreen({ navigation, route }: DestinationSearchScreenProps) {
    const [searchText, setSearchText] = useState('');
    const [results, setResults] = useState(MOCK_DESTINATIONS);
    const cursorAnim = useRef(new Animated.Value(0)).current;

    // Background animation
    const floatAnim = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        Animated.loop(
            Animated.sequence([
                Animated.timing(floatAnim, {
                    toValue: 1,
                    duration: 4000,
                    useNativeDriver: true,
                }),
                Animated.timing(floatAnim, {
                    toValue: 0,
                    duration: 4000,
                    useNativeDriver: true,
                }),
            ])
        ).start();

        // Cursor blink animation
        Animated.loop(
            Animated.sequence([
                Animated.timing(cursorAnim, {
                    toValue: 1,
                    duration: 800,
                    useNativeDriver: true,
                }),
                Animated.timing(cursorAnim, {
                    toValue: 0,
                    duration: 800,
                    useNativeDriver: true,
                }),
            ])
        ).start();
    }, []);

    const handleSearch = (text: string) => {
        setSearchText(text);
        if (text.length === 0) {
            setResults(MOCK_DESTINATIONS);
        } else {
            const filtered = MOCK_DESTINATIONS.filter(
                d => d.name.toLowerCase().includes(text.toLowerCase()) ||
                    d.address.toLowerCase().includes(text.toLowerCase())
            );
            setResults(filtered);
        }
    };

    const handleSelectDestination = (destination: typeof MOCK_DESTINATIONS[0]) => {
        navigation.navigate('RideConfirmation', {
            destination: {
                latitude: destination.lat,
                longitude: destination.lng,
                address: destination.name,
            },
            pickup: route?.params?.currentLocation ? {
                latitude: route.params.currentLocation.latitude,
                longitude: route.params.currentLocation.longitude,
                address: 'Current Location',
            } : undefined
        });
    };

    const floatTranslate = floatAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [0, 20],
    });

    const cursorOpacity = cursorAnim.interpolate({
        inputRange: [0, 0.5, 1],
        outputRange: [1, 0, 1],
    });

    return (
        <View style={styles.container}>
            {/* Background Orbs */}
            <Animated.View
                style={[
                    styles.backgroundOrb,
                    styles.orbTop,
                    { transform: [{ translateY: floatTranslate }] }
                ]}
            />
            <Animated.View
                style={[
                    styles.backgroundOrb,
                    styles.orbBottom,
                    { transform: [{ translateY: Animated.multiply(floatTranslate, -1) }] }
                ]}
            />

            <SafeAreaView style={styles.safeArea}>
                {/* Header */}
                <View style={styles.header}>
                    <TouchableOpacity
                        style={styles.glassButton}
                        onPress={() => navigation.goBack()}
                    >
                        <Text style={styles.backText}>←</Text>
                    </TouchableOpacity>
                    <Text style={styles.headerTitle}>Where to?</Text>
                    <View style={styles.placeholder} />
                </View>

                {/* Glass Search Container */}
                <View style={styles.glassSearchContainer}>
                    {/* Top edge highlight */}
                    <View style={styles.glassHighlight} />

                    {/* Pickup Row */}
                    <View style={styles.inputRow}>
                        <View style={styles.dotContainer}>
                            <View style={styles.dotPickup} />
                            <View style={styles.connectionLine} />
                        </View>
                        <View style={styles.glassInputWrapper}>
                            <Text style={styles.inputLabel}>Pickup</Text>
                            <Text style={styles.inputValueFixed}>Current Location</Text>
                        </View>
                    </View>

                    {/* Destination Row */}
                    <View style={styles.inputRow}>
                        <View style={styles.dotContainer}>
                            <View style={styles.dotDestination} />
                        </View>
                        <View style={[styles.glassInputWrapper, styles.glassInputActive]}>
                            <Text style={styles.inputLabel}>Destination</Text>
                            <View style={styles.textInputContainer}>
                                <TextInput
                                    style={styles.input}
                                    placeholder="Search destination..."
                                    placeholderTextColor={theme.colors.text.tertiary}
                                    value={searchText}
                                    onChangeText={handleSearch}
                                    autoFocus
                                    selectionColor={theme.colors.brand.primary}
                                />
                                {searchText.length === 0 && (
                                    <Animated.View style={[styles.cursor, { opacity: cursorOpacity }]} />
                                )}
                            </View>
                        </View>
                    </View>
                </View>

                {/* Results List */}
                <FlatList
                    data={results}
                    keyExtractor={(item) => item.id}
                    contentContainerStyle={styles.resultsList}
                    showsVerticalScrollIndicator={false}
                    renderItem={({ item }) => (
                        <TouchableOpacity
                            style={styles.glassResultItem}
                            onPress={() => handleSelectDestination(item)}
                            activeOpacity={0.7}
                        >
                            <View style={styles.resultIconContainer}>
                                <Text style={styles.resultIcon}>📍</Text>
                            </View>
                            <View style={styles.resultText}>
                                <Text style={styles.resultName}>{item.name}</Text>
                                <Text style={styles.resultAddress}>{item.address}</Text>
                            </View>
                            <View style={styles.resultArrow}>
                                <Text style={styles.arrowText}>→</Text>
                            </View>
                        </TouchableOpacity>
                    )}
                    ListEmptyComponent={
                        <View style={styles.emptyState}>
                            <Text style={styles.emptyEmoji}>🔍</Text>
                            <Text style={styles.emptyText}>No results found</Text>
                            <Text style={styles.emptySubtext}>Try a different search term</Text>
                        </View>
                    }
                    ListHeaderComponent={
                        <View style={styles.listHeader}>
                            <Text style={styles.listTitle}>SUGGESTED DESTINATIONS</Text>
                        </View>
                    }
                />
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

    // Background Orbs
    backgroundOrb: {
        position: 'absolute',
        borderRadius: 999,
    },
    orbTop: {
        width: 400,
        height: 400,
        backgroundColor: theme.colors.brand.glowSubtle,
        top: -150,
        right: -100,
        opacity: 0.5,
    },
    orbBottom: {
        width: 300,
        height: 300,
        backgroundColor: theme.colors.accent.purple,
        bottom: 100,
        left: -100,
        opacity: 0.15,
    },

    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: theme.spacing.lg,
        paddingVertical: theme.spacing.md,
    },
    glassButton: {
        width: 44,
        height: 44,
        borderRadius: theme.borderRadius.md,
        backgroundColor: theme.colors.glass.background,
        borderWidth: 1,
        borderColor: theme.colors.glass.border,
        justifyContent: 'center',
        alignItems: 'center',
        ...(Platform.OS === 'web' ? {
            backdropFilter: 'blur(10px)',
            WebkitBackdropFilter: 'blur(10px)',
        } : {}),
    },
    backText: {
        color: theme.colors.text.primary,
        fontSize: 22,
    },
    headerTitle: {
        color: theme.colors.text.primary,
        fontSize: theme.typography.sizes.xl,
        fontWeight: theme.typography.weights.bold,
        letterSpacing: 1,
    },
    placeholder: {
        width: 44,
    },

    // Glass Search Container
    glassSearchContainer: {
        margin: theme.spacing.lg,
        backgroundColor: theme.colors.glass.background,
        borderRadius: theme.borderRadius.xl,
        padding: theme.spacing.lg,
        borderWidth: 1,
        borderColor: theme.colors.glass.border,
        overflow: 'hidden',
        ...(Platform.OS === 'web' ? {
            backdropFilter: 'blur(30px)',
            WebkitBackdropFilter: 'blur(30px)',
        } : {}),
    },
    glassHighlight: {
        position: 'absolute',
        top: 0,
        left: 20,
        right: 20,
        height: 1,
        backgroundColor: theme.colors.glass.highlight,
    },

    inputRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: theme.spacing.md,
    },
    dotContainer: {
        width: 24,
        alignItems: 'center',
        height: '100%',
        paddingTop: 12,
    },
    dotPickup: {
        width: 12,
        height: 12,
        borderRadius: 6,
        backgroundColor: theme.colors.text.tertiary,
    },
    dotDestination: {
        width: 12,
        height: 12,
        borderRadius: 6,
        backgroundColor: theme.colors.brand.primary,
        ...theme.shadows.glow,
    },
    connectionLine: {
        width: 2,
        height: 40,
        backgroundColor: theme.colors.glass.borderLight,
        marginVertical: 4,
    },

    glassInputWrapper: {
        flex: 1,
        marginLeft: theme.spacing.md,
        backgroundColor: theme.colors.glass.backgroundLight,
        borderRadius: theme.borderRadius.lg,
        paddingHorizontal: theme.spacing.lg,
        paddingVertical: theme.spacing.md,
        borderWidth: 1,
        borderColor: theme.colors.glass.border,
    },
    glassInputActive: {
        borderColor: theme.colors.brand.primary,
        backgroundColor: theme.colors.glass.background,
    },
    inputLabel: {
        fontSize: theme.typography.sizes.xs,
        color: theme.colors.text.secondary,
        marginBottom: 4,
        fontWeight: theme.typography.weights.medium,
        letterSpacing: 0.5,
    },
    inputValueFixed: {
        fontSize: theme.typography.sizes.md,
        color: theme.colors.text.primary,
        paddingVertical: 4,
    },
    textInputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    input: {
        flex: 1,
        fontSize: theme.typography.sizes.md,
        color: theme.colors.text.primary,
        padding: 0,
        margin: 0,
        paddingVertical: 4,
    },
    cursor: {
        width: 2,
        height: 20,
        backgroundColor: theme.colors.brand.primary,
    },

    // Results
    resultsList: {
        paddingHorizontal: theme.spacing.lg,
        paddingBottom: theme.spacing.xxl,
    },
    listHeader: {
        marginBottom: theme.spacing.md,
    },
    listTitle: {
        color: theme.colors.text.tertiary,
        fontSize: theme.typography.sizes.xs,
        fontWeight: theme.typography.weights.bold,
        letterSpacing: 1,
    },

    glassResultItem: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: theme.colors.glass.background,
        borderRadius: theme.borderRadius.lg,
        padding: theme.spacing.lg,
        marginBottom: theme.spacing.md,
        borderWidth: 1,
        borderColor: theme.colors.glass.border,
        ...(Platform.OS === 'web' ? {
            backdropFilter: 'blur(10px)',
            WebkitBackdropFilter: 'blur(10px)',
        } : {}),
    },
    resultIconContainer: {
        width: 40,
        height: 40,
        borderRadius: theme.borderRadius.md,
        backgroundColor: theme.colors.glass.backgroundLight,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: theme.spacing.md,
    },
    resultIcon: {
        fontSize: 20,
    },
    resultText: {
        flex: 1,
    },
    resultName: {
        color: theme.colors.text.primary,
        fontSize: theme.typography.sizes.md,
        fontWeight: theme.typography.weights.semibold,
        marginBottom: 4,
    },
    resultAddress: {
        color: theme.colors.text.secondary,
        fontSize: theme.typography.sizes.sm,
    },
    resultArrow: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: theme.colors.glass.backgroundLight,
        justifyContent: 'center',
        alignItems: 'center',
    },
    arrowText: {
        color: theme.colors.brand.primary,
        fontSize: 16,
    },

    emptyState: {
        padding: theme.spacing.xxxl,
        alignItems: 'center',
    },
    emptyEmoji: {
        fontSize: 48,
        marginBottom: theme.spacing.md,
    },
    emptyText: {
        color: theme.colors.text.secondary,
        fontSize: theme.typography.sizes.lg,
        fontWeight: theme.typography.weights.medium,
    },
    emptySubtext: {
        color: theme.colors.text.tertiary,
        fontSize: theme.typography.sizes.sm,
        marginTop: theme.spacing.xs,
    },
});
