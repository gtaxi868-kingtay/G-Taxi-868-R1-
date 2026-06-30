import React, { useState, useEffect, useRef } from 'react';
import {
    View, Text, StyleSheet, TextInput, TouchableOpacity,
    FlatList, ScrollView, ActivityIndicator, Keyboard,
    KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useNetInfo } from '@react-native-community/netinfo';
import { supabase, SavedPlace, Location as RideLocation, DEFAULT_LOCATION } from '@gtaxi/core';
import { SURFACE, VOICES } from '@gtaxi/design-system';
import { ghostBorder } from '@gtaxi/design-system/utils/style-rules';
import { getRecentRides, getSavedPlaces } from '../services/api';
import { AppScreenProps } from '../navigation/types';

interface RecentItem { id: string; name: string; address: string; latitude: number; longitude: number; }

export function DestinationSearchScreen({ navigation, route }: AppScreenProps<'DestinationSearch'>) {
    const insets = useSafeAreaInsets();
    const netInfo = useNetInfo();
    const { currentLocation, source, sourceMetadata, kioskId, taxiStandId, editPickupMode } = route.params || {};

    const [query, setQuery] = useState('');
    const [results, setResults] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(false);
    const [recents, setRecents] = useState<RecentItem[]>([]);
    const [saved, setSaved] = useState<SavedPlace[]>([]);
    const [nearbyPins, setNearbyPins] = useState<any[]>([]);

    const inputRef = useRef<TextInput>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const reqIdRef = useRef(0);

    useEffect(() => {
        const timer = setTimeout(() => inputRef.current?.focus(), 100);
        loadLists();
        loadNearbyPins();
        return () => {
            clearTimeout(timer);
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
    }, []);

    const loadLists = async () => {
        try {
            const [recentRides, savedPlaces] = await Promise.all([getRecentRides(), getSavedPlaces()]);
            setRecents(
                (recentRides || [])
                    .filter((r: RideLocation) => Number.isFinite(r.latitude) && Number.isFinite(r.longitude))
                    .map((r: RideLocation, i: number) => ({
                        id: `recent-${i}`,
                        name: (r.address || 'Recent trip').split(',')[0],
                        address: r.address || '',
                        latitude: r.latitude,
                        longitude: r.longitude,
                    }))
            );
            setSaved(savedPlaces || []);
        } catch (err) {
            console.warn('[DestinationSearch] could not load recents/saved:', err);
        }
    };

    // P0: Zero Unverified Addresses — load verified pins near current location
    const loadNearbyPins = async () => {
        try {
            const mod = await import('expo-location');
            const loc = currentLocation || (await mod.getCurrentPositionAsync?.({}));
            if (!loc) return;
            const lat = 'latitude' in loc ? loc.latitude : loc.coords?.latitude;
            const lng = 'longitude' in loc ? loc.longitude : loc.coords?.longitude;
            if (!lat || !lng) return;
            const { data } = await supabase.functions.invoke('geocode', {
                body: { lat, lng, limit: 8 },
            });
            if (data?.success && Array.isArray(data?.data)) {
                setNearbyPins(data.data);
            }
        } catch (err) {
            // Non-critical — nearby pins are just convenience
        }
    };

    // Debounced geocode with stale-response guarding.
    const onChangeQuery = (val: string) => {
        setQuery(val);
        setError(false);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        if (val.trim().length < 2) {
            setResults([]);
            setIsLoading(false);
            return;
        }
        setIsLoading(true);
        debounceRef.current = setTimeout(() => runSearch(val.trim()), 300);
    };

    const runSearch = async (val: string) => {
        const reqId = ++reqIdRef.current;
        try {
            const { data, error: gErr } = await supabase.functions.invoke('geocode', {
                body: { query: val, limit: 10 },
            });
            if (reqId !== reqIdRef.current) return; // a newer keystroke superseded this one
            if (gErr) throw gErr;
            if (data?.success && Array.isArray(data?.data)) {
                setResults(data.data);
                setError(false);
            } else {
                setResults([]);
            }
        } catch (err) {
            if (reqId === reqIdRef.current) {
                console.warn('[DestinationSearch] geocode failed:', err);
                setError(true);
                setResults([]);
            }
        } finally {
            if (reqId === reqIdRef.current) setIsLoading(false);
        }
    };

    const choose = (latitude: number, longitude: number, address: string) => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        Keyboard.dismiss();

        // editPickupMode: the rider is correcting their PICKUP (from Home's GPS-accuracy
        // prompt). Set it as the new pickup, then drop back into a normal destination search.
        if (editPickupMode) {
            navigation.replace('DestinationSearch', {
                currentLocation: { latitude, longitude, address },
            });
            return;
        }

        navigation.navigate('RideConfirmation', {
            destination: { latitude, longitude, address },
            pickup: currentLocation || { latitude: DEFAULT_LOCATION.latitude, longitude: DEFAULT_LOCATION.longitude, address: 'Current Location' },
            source,
            sourceMetadata,
            kioskId,
            taxiStandId,
        });
    };

    const renderResult = ({ item }: { item: any }) => (
        <TouchableOpacity
            style={s.row}
            onPress={() => choose(item.latitude, item.longitude, item.name || item.address)}
            accessibilityLabel={`Select ${item.name || item.address}`}
            accessibilityRole="button"
        >
            <View style={s.rowIconNeutral}>
                <Ionicons name="location-sharp" size={18} color="rgba(242,245,248,0.6)" />
            </View>
            <View style={s.rowInfo}>
                <Text style={s.rowName}>{item.name || item.address?.split(',')[0]}</Text>
                <Text style={s.rowAddress} numberOfLines={1}>{item.address}</Text>
            </View>
        </TouchableOpacity>
    );

    const placeholder = editPickupMode ? 'Select a verified pickup point' : 'Search verified locations';

    return (
        <View style={s.root}>
            <StatusBar style="light" />
            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                style={{ flex: 1 }}
            >
                <View style={[s.header, { paddingTop: insets.top + 10 }]}>
                    <View style={s.headerRow}>
                        <TouchableOpacity
                            style={s.backBtn}
                            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); navigation.goBack(); }}
                            accessibilityLabel="Go back"
                            accessibilityRole="button"
                        >
                            <Ionicons name="chevron-back" size={24} color="#FFF" />
                        </TouchableOpacity>

                        <View style={s.inputContainer}>
                            <Ionicons name="search" size={18} color="rgba(242,245,248,0.5)" style={{ marginRight: 8 }} />
                            <TextInput
                                ref={inputRef}
                                style={s.input}
                                placeholder={placeholder}
                                placeholderTextColor="rgba(242,245,248,0.4)"
                                value={query}
                                onChangeText={onChangeQuery}
                                selectionColor={VOICES.rider.accent}
                                autoFocus
                                returnKeyType="search"
                            />
                            {isLoading && <ActivityIndicator size="small" color={VOICES.rider.accent} />}
                        </View>
                    </View>
                    {editPickupMode && (
                        <Text style={s.editHint}>Choose a more precise pickup point</Text>
                    )}
                </View>

                {netInfo.isConnected === false && (
                    <View style={s.offlineBanner}>
                        <Ionicons name="cloud-offline-outline" size={15} color="#F59E0B" />
                        <Text style={s.offlineText}>You're offline — search needs a connection. Saved places still work.</Text>
                    </View>
                )}

                {query.length > 0 ? (
                    <FlatList
                        data={results}
                        keyExtractor={(item: any, i) => item.id?.toString() || `res-${i}`}
                        renderItem={renderResult}
                        keyboardShouldPersistTaps="handled"
                        contentContainerStyle={s.list}
                        ListEmptyComponent={
                            isLoading ? null : error ? (
                                <View style={s.empty}>
                                    <Ionicons name="alert-circle-outline" size={32} color="#EF4444" />
                                    <Text style={s.emptyText}>Couldn't search right now</Text>
                                    <TouchableOpacity style={s.retryBtn} onPress={() => runSearch(query.trim())} accessibilityRole="button" accessibilityLabel="Retry search">
                                        <Text style={s.retryText}>Retry</Text>
                                    </TouchableOpacity>
                                </View>
                            ) : (
                                <View style={s.empty}>
                                    <Text style={s.emptyText}>No match for "{query}"</Text>
                                    <Text style={s.emptySub}>Only Verified Merchant Pins and landmarks are available. Try a different search.</Text>
                                </View>
                            )
                        }
                    />
                ) : (
                    <ScrollView
                        contentContainerStyle={s.list}
                        keyboardShouldPersistTaps="handled"
                        showsVerticalScrollIndicator={false}
                    >
                        {saved.length > 0 && (
                            <>
                                <View style={s.sectionHeader}>
                                    <Ionicons name="star-outline" size={15} color="rgba(242,245,248,0.5)" />
                                    <Text style={s.sectionLabel}>Saved</Text>
                                </View>
                                {saved.map((p) => (
                                    <TouchableOpacity
                                        key={p.id}
                                        style={s.row}
                                        onPress={() => choose(p.lat, p.lng, p.address || p.label)}
                                        accessibilityLabel={`Select saved place ${p.label}`}
                                        accessibilityRole="button"
                                    >
                                        <View style={s.rowIconBrand}>
                                            <Ionicons name={(p.icon as any) || 'bookmark'} size={18} color={VOICES.rider.accent} />
                                        </View>
                                        <View style={s.rowInfo}>
                                            <Text style={s.rowName}>{p.label}</Text>
                                            <Text style={s.rowAddress} numberOfLines={1}>{p.address}</Text>
                                        </View>
                                    </TouchableOpacity>
                                ))}
                            </>
                        )}

                        {recents.length > 0 ? (
                            <>
                                <View style={s.sectionHeader}>
                                    <Ionicons name="time-outline" size={15} color="rgba(242,245,248,0.5)" />
                                    <Text style={s.sectionLabel}>Recent</Text>
                                </View>
                                {recents.map((r) => (
                                    <TouchableOpacity
                                        key={r.id}
                                        style={s.row}
                                        onPress={() => choose(r.latitude, r.longitude, r.address || r.name)}
                                        accessibilityLabel={`Select recent ${r.name}`}
                                        accessibilityRole="button"
                                    >
                                        <View style={s.rowIconNeutral}>
                                            <Ionicons name="location-sharp" size={18} color="rgba(242,245,248,0.6)" />
                                        </View>
                                        <View style={s.rowInfo}>
                                            <Text style={s.rowName}>{r.name}</Text>
                                            <Text style={s.rowAddress} numberOfLines={1}>{r.address}</Text>
                                        </View>
                                    </TouchableOpacity>
                                ))}
                            </>
                        ) : saved.length === 0 && nearbyPins.length === 0 ? (
                            <View style={s.empty}>
                                <Ionicons name="navigate-outline" size={32} color="rgba(242,245,248,0.3)" />
                                <Text style={s.emptyText}>Select a verified location</Text>
                                <Text style={s.emptySub}>Only Verified Merchant Pins, landmarks, and your saved places are available for safety.</Text>
                            </View>
                        ) : null}

                        {nearbyPins.length > 0 && query.length === 0 && (
                            <>
                                <View style={s.sectionHeader}>
                                    <Ionicons name="location-outline" size={15} color="rgba(242,245,248,0.5)" />
                                    <Text style={s.sectionLabel}>Verified Pins Nearby</Text>
                                </View>
                                {nearbyPins.map((pin: any, i: number) => (
                                    <TouchableOpacity
                                        key={pin.id || `pin-${i}`}
                                        style={s.row}
                                        onPress={() => choose(pin.latitude, pin.longitude, pin.address || pin.name)}
                                        accessibilityLabel={`Select ${pin.name}`}
                                        accessibilityRole="button"
                                    >
                                        <View style={s.rowIconBrand}>
                                            <Ionicons name="business" size={18} color="#FFF" />
                                        </View>
                                        <View style={s.rowInfo}>
                                            <Text style={s.rowName}>{pin.name}</Text>
                                            <Text style={s.rowAddress} numberOfLines={1}>
                                                {pin.distance_meters ? `${Math.round(pin.distance_meters)}m` : ''} {pin.address}
                                            </Text>
                                        </View>
                                    </TouchableOpacity>
                                ))}
                            </>
                        )}
                    </ScrollView>
                )}
            </KeyboardAvoidingView>
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: SURFACE.base },
    header: {
        paddingHorizontal: 20, paddingBottom: 16,
        borderBottomLeftRadius: 28, borderBottomRightRadius: 28,
        backgroundColor: SURFACE.containerLow,
    },
    headerRow: { flexDirection: 'row', alignItems: 'center' },
    backBtn: {
        width: 44, height: 44, borderRadius: 14,
        backgroundColor: 'rgba(255,255,255,0.05)',
        alignItems: 'center', justifyContent: 'center',
        ...ghostBorder(0.1),
    },
    inputContainer: {
        flex: 1, height: 50, backgroundColor: SURFACE.base, borderRadius: 14,
        marginLeft: 12, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14,
        ...ghostBorder(0.1),
    },
    input: { flex: 1, height: '100%', color: '#F2F5F8', fontSize: 16 },
    editHint: { fontSize: 12, color: 'rgba(242,245,248,0.5)', marginTop: 10, marginLeft: 4 },

    offlineBanner: {
        flexDirection: 'row', alignItems: 'center', gap: 8,
        marginHorizontal: 20, marginTop: 14, padding: 12, borderRadius: 12,
        backgroundColor: 'rgba(245,158,11,0.1)', borderWidth: 1, borderColor: 'rgba(245,158,11,0.22)',
    },
    offlineText: { flex: 1, fontSize: 12, color: '#F59E0B', fontWeight: '600' },

    list: { padding: 20, paddingBottom: 40 },
    sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 8, paddingBottom: 12 },
    sectionLabel: { fontSize: 10, fontWeight: '700', color: 'rgba(242,245,248,0.5)', letterSpacing: 1, textTransform: 'uppercase' },

    row: {
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: SURFACE.containerLow, padding: 14, borderRadius: 18, marginBottom: 10,
        ...ghostBorder(0.06),
    },
    rowIconBrand: { width: 44, height: 44, borderRadius: 14, backgroundColor: `${VOICES.rider.accent}22`, alignItems: 'center', justifyContent: 'center' },
    rowIconNeutral: { width: 44, height: 44, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' },
    rowInfo: { marginLeft: 14, flex: 1 },
    rowName: { fontSize: 15, fontWeight: '700', color: '#F2F5F8', marginBottom: 2 },
    rowAddress: { fontSize: 13, fontWeight: '500', color: 'rgba(242,245,248,0.5)' },

    empty: { marginTop: 48, alignItems: 'center', gap: 8 },
    emptyText: { fontSize: 16, fontWeight: '700', color: 'rgba(242,245,248,0.7)' },
    emptySub: { fontSize: 13, color: 'rgba(242,245,248,0.4)', textAlign: 'center', paddingHorizontal: 40 },
    retryBtn: { marginTop: 10, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 14, backgroundColor: VOICES.rider.accent },
    retryText: { fontSize: 14, fontWeight: '800', color: SURFACE.base },
});
