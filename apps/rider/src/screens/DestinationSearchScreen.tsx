import React, { useState, useRef, useEffect, useCallback } from 'react';
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
    ActivityIndicator,
    Alert,
} from 'react-native';
import { theme } from '../theme';
import { supabase } from '../../../../shared/supabase';
import { useAuth } from '../context/AuthContext';
import { tokens } from '../design-system/tokens';
import { Card, Surface, Txt } from '../design-system/primitives';

const { width, height } = Dimensions.get('window');

// Location result type
interface LocationResult {
    id: string;
    name: string;
    address: string;
    latitude: number;
    longitude: number;
    category: string;
}

// Default suggestions when no search
const DEFAULT_SUGGESTIONS: LocationResult[] = [
    { id: '1', name: 'Piarco International Airport', address: 'Golden Grove Road, Piarco', latitude: 10.5956, longitude: -61.3372, category: 'airport' },
    { id: '2', name: 'Queen\'s Park Savannah', address: 'Queens Park West, Port of Spain', latitude: 10.6718, longitude: -61.5175, category: 'landmark' },
    { id: '3', name: 'Trincity Mall', address: 'Churchill Roosevelt Highway, Trincity', latitude: 10.6108, longitude: -61.3511, category: 'mall' },
    { id: '4', name: 'MovieTowne', address: 'Invaders Bay, Port of Spain', latitude: 10.6533, longitude: -61.5283, category: 'entertainment' },
    { id: '5', name: 'Maracas Beach', address: 'North Coast Road, Maracas Bay', latitude: 10.7583, longitude: -61.4292, category: 'beach' },
];

interface DestinationSearchScreenProps {
    navigation: any;
    route?: {
        params?: {
            currentLocation?: { latitude: number; longitude: number };
            mode?: 'search' | 'save';
        };
    };
}

export function DestinationSearchScreen({ navigation, route }: DestinationSearchScreenProps) {
    const isSaveMode = route?.params?.mode === 'save';
    const [searchText, setSearchText] = useState('');
    const [results, setResults] = useState<LocationResult[]>(DEFAULT_SUGGESTIONS);
    const [savedPlaces, setSavedPlaces] = useState<LocationResult[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const { user } = useAuth();
    const cursorAnim = useRef(new Animated.Value(0)).current;
    const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // Background animation
    const floatAnim = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        if (user) {
            fetchSavedPlaces();
        }

        // Ambient Floating Animation
        Animated.loop(
            Animated.sequence([
                Animated.timing(floatAnim, { toValue: 1, duration: 4000, useNativeDriver: true }),
                Animated.timing(floatAnim, { toValue: 0, duration: 4000, useNativeDriver: true }),
            ])
        ).start();

        // Cursor/Focus Interaction Animation
        Animated.loop(
            Animated.sequence([
                Animated.timing(cursorAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
                Animated.timing(cursorAnim, { toValue: 0, duration: 800, useNativeDriver: true }),
            ])
        ).start();
    }, [user]);

    const fetchSavedPlaces = async () => {
        try {
            const { data, error } = await supabase
                .from('saved_places')
                .select('*')
                .eq('user_id', user?.id);

            if (data) {
                const formatted = data.map(p => ({
                    id: p.id,
                    name: p.label,
                    address: p.address,
                    latitude: p.latitude,
                    longitude: p.longitude,
                    category: 'saved'
                }));
                setSavedPlaces(formatted);
            }
        } catch (e) {
            console.error('Error fetching saved places:', e);
        }
    };

    const searchLocations = useCallback(async (query: string) => {
        if (query.length < 2) {
            setResults(DEFAULT_SUGGESTIONS);
            setIsLoading(false);
            return;
        }

        setIsLoading(true);
        try {
            const { data, error } = await supabase.functions.invoke('geocode', {
                body: { query, limit: 10 },
            });

            if (data?.success && data?.data) {
                setResults(data.data);
            } else {
                setResults([]);
            }
        } catch (err) {
            console.error('[Search] Exception:', err);
            setResults([]);
        } finally {
            setIsLoading(false);
        }
    }, []);

    const handleSearch = (text: string) => {
        setSearchText(text);
        if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
        if (text.length === 0) {
            setResults(DEFAULT_SUGGESTIONS);
            setIsLoading(false);
            return;
        }
        setIsLoading(true);
        searchTimeoutRef.current = setTimeout(() => {
            searchLocations(text);
        }, 300);
    };

    const handleSelectDestination = async (destination: LocationResult) => {
        if (isSaveMode) {
            Alert.prompt(
                'Save Place',
                'Enter a name for this place (e.g., Home, Work, Gym)',
                [
                    {
                        text: 'Save',
                        onPress: async (label: string | undefined) => {
                            if (!label) return;
                            const { error } = await supabase
                                .from('saved_places')
                                .insert({
                                    user_id: user?.id,
                                    label: label,
                                    address: destination.address,
                                    latitude: destination.latitude,
                                    longitude: destination.longitude,
                                    icon: label.toLowerCase().includes('home') ? '🏠' :
                                        label.toLowerCase().includes('work') ? '💼' : '📍'
                                });

                            if (error) {
                                Alert.alert('Error', 'Could not save place');
                            } else {
                                navigation.goBack();
                            }
                        }
                    }
                ]
            );
        } else {
            navigation.navigate('RideConfirmation', {
                destination: {
                    latitude: destination.latitude,
                    longitude: destination.longitude,
                    address: destination.name,
                },
                pickup: route?.params?.currentLocation ? {
                    latitude: route.params.currentLocation.latitude,
                    longitude: route.params.currentLocation.longitude,
                    address: 'Current Location',
                } : undefined
            });
        }
    };

    const floatTranslate = floatAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [0, 20],
    });

    return (
        <View style={styles.container}>
            {/* Ambient Background Orbs (Hybrid Restoration) */}
            <View style={StyleSheet.absoluteFill} pointerEvents="none">
                <Animated.View style={[styles.ambientOrb, { backgroundColor: tokens.colors.primary.purple, top: '10%', left: '20%', transform: [{ translateY: floatTranslate }] }]} />
                <Animated.View style={[styles.ambientOrb, { backgroundColor: tokens.colors.status.warning, bottom: '20%', right: '10%', transform: [{ translateY: floatTranslate }] }]} />
            </View>

            <SafeAreaView style={styles.safeArea}>
                {/* Hybrid Glass Header */}
                <View style={styles.headerGlass}>
                    <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButtonGlass}>
                        <Text style={styles.backArrowGlass}>←</Text>
                    </TouchableOpacity>
                    <Text style={styles.headerTitleHybrid}>Where to?</Text>
                </View>

                {/* Input Card (Hybrid Glass Style) */}
                <View style={styles.searchCardGlass}>
                    <View style={styles.inputStack}>
                        <View style={styles.rowHybrid}>
                            <View style={styles.dotPickupHybrid} />
                            <View style={styles.inputBoxHybrid}>
                                <Text style={styles.fixedLocationText}>Current Location</Text>
                            </View>
                        </View>
                        <View style={styles.lineConnectorHybrid} />
                        <View style={styles.rowHybrid}>
                            <View style={styles.squareDestHybrid} />
                            <View style={styles.inputBoxHybrid}>
                                <TextInput
                                    style={styles.textInputHybrid}
                                    placeholder="Search destination"
                                    placeholderTextColor="rgba(255,255,255,0.4)"
                                    value={searchText}
                                    onChangeText={handleSearch}
                                    autoFocus
                                />
                                {isLoading && <ActivityIndicator size="small" color="#276EF1" style={{ marginLeft: 8 }} />}
                            </View>
                        </View>
                    </View>
                </View>

                {/* Results List (Hybrid Style) */}
                <FlatList
                    data={searchText.length > 0
                        ? [...savedPlaces.filter(p =>
                            p.name.toLowerCase().includes(searchText.toLowerCase()) ||
                            p.address.toLowerCase().includes(searchText.toLowerCase())), ...results]
                        : [...savedPlaces, ...results]
                    }
                    keyExtractor={(item) => item.id}
                    contentContainerStyle={styles.listContentHybrid}
                    renderItem={({ item }) => (
                        <TouchableOpacity
                            style={styles.resultItemHybrid}
                            onPress={() => handleSelectDestination(item)}
                            activeOpacity={0.7}
                        >
                            <View style={styles.resultIconGlass}>
                                <Text style={styles.iconTextHybrid}>
                                    {item.category === 'saved' ? (item.name.toLowerCase().includes('home') ? '🏠' : '💼') :
                                        item.category === 'airport' ? '✈️' : '📍'}
                                </Text>
                            </View>
                            <View style={styles.resultDetailsHybrid}>
                                <Text style={styles.resultPrimaryText}>{item.name}</Text>
                                <Text style={styles.resultSecondaryText} numberOfLines={1}>{item.address}</Text>
                            </View>
                            <Text style={styles.resultChevronGlass}>›</Text>
                        </TouchableOpacity>
                    )}
                    ItemSeparatorComponent={() => <View style={styles.dividerHybrid} />}
                    ListEmptyComponent={
                        isLoading ? null : (
                            <View style={styles.emptyHybrid}>
                                <Text style={styles.emptyTextHybrid}>No results found</Text>
                            </View>
                        )
                    }
                />
            </SafeAreaView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#05050A',
    },
    ambientOrb: {
        position: 'absolute',
        width: 300,
        height: 300,
        borderRadius: 150,
        opacity: 0.3,
    },
    safeArea: {
        flex: 1,
    },
    headerGlass: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
        backgroundColor: 'rgba(5, 5, 10, 0.5)',
    },
    backButtonGlass: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: 'rgba(255,255,255,0.05)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    backArrowGlass: {
        fontSize: 24,
        color: '#FFFFFF',
    },
    headerTitleHybrid: {
        fontSize: 20,
        fontWeight: '700',
        color: '#FFFFFF',
        marginLeft: 12,
    },
    searchCardGlass: {
        margin: 16,
        backgroundColor: 'rgba(10, 10, 21, 0.8)',
        borderRadius: 20,
        padding: 20,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.08)',
        overflow: 'hidden',
    },
    inputStack: {
        gap: 0,
    },
    rowHybrid: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    dotPickupHybrid: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: '#9CA3AF',
        marginLeft: 10,
    },
    squareDestHybrid: {
        width: 8,
        height: 8,
        backgroundColor: '#FFF',
        marginLeft: 10,
    },
    lineConnectorHybrid: {
        width: 1,
        height: 20,
        backgroundColor: 'rgba(255,255,255,0.1)',
        marginLeft: 13.5,
    },
    inputBoxHybrid: {
        flex: 1,
        marginLeft: 16,
        paddingVertical: 10,
    },
    fixedLocationText: {
        color: '#9CA3AF',
        fontSize: 16,
    },
    textInputHybrid: {
        color: '#FFF',
        fontSize: 16,
        padding: 0,
    },
    listContentHybrid: {
        paddingHorizontal: 16,
        paddingBottom: 40,
    },
    resultItemHybrid: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 14,
    },
    resultIconGlass: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: 'rgba(255,255,255,0.05)',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 16,
    },
    iconTextHybrid: {
        fontSize: 18,
    },
    resultDetailsHybrid: {
        flex: 1,
    },
    resultPrimaryText: {
        color: '#FFF',
        fontSize: 16,
        fontWeight: '600',
        marginBottom: 2,
    },
    resultSecondaryText: {
        color: 'rgba(255,255,255,0.5)',
        fontSize: 14,
    },
    resultChevronGlass: {
        color: 'rgba(255,255,255,0.2)',
        fontSize: 20,
        marginLeft: 8,
    },
    dividerHybrid: {
        height: 1,
        backgroundColor: 'rgba(255,255,255,0.05)',
        marginLeft: 56,
    },
    emptyHybrid: {
        paddingVertical: 60,
        alignItems: 'center',
    },
    emptyTextHybrid: {
        color: 'rgba(255,255,255,0.4)',
        fontSize: 16,
    },
});
