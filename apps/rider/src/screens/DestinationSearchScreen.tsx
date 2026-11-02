import React, { useState, useEffect, useRef } from 'react';
import {
    View, TextInput, Pressable, FlatList, ScrollView, ActivityIndicator, Keyboard,
    KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useNetInfo } from '@react-native-community/netinfo';
import { supabase, SavedPlace, Location as RideLocation, DEFAULT_LOCATION } from '@gtaxi/core';
import { logAppEvent } from '../services/analytics';
import { Button, EmptyState, FONT, GUTTER, IconButton, RADIUS, Row, Section, SPACE, Txt, useTheme } from '../ui/kit';
import { getRecentRides, getSavedPlaces, savePlace } from '../services/api';
import { AppScreenProps } from '../navigation/types';

interface RecentItem { id: string; name: string; address: string; latitude: number; longitude: number; }

export function DestinationSearchScreen({ navigation, route }: AppScreenProps<'DestinationSearch'>) {
    const insets = useSafeAreaInsets();
    const netInfo = useNetInfo();
    // `stop`: a shop the rider wants to stop at on the way (Home shop card);
    // carried through to RideConfirmation once they pick where they're going.
    const { currentLocation, source, sourceMetadata, kioskId, taxiStandId, editPickupMode, saveMode, stop, pinned, initialQuery } = route.params || {};

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
            const lat = 'latitude' in loc ? loc.latitude : (loc as any).coords?.latitude;
            const lng = 'longitude' in loc ? loc.longitude : (loc as any).coords?.longitude;
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

    useEffect(() => {
        if (initialQuery) onChangeQuery(initialQuery);
    }, [initialQuery]);

    const runSearch = async (val: string) => {
        const reqId = ++reqIdRef.current;
        try {
            // Send the rider's position so nearby matches come first.
            const near = currentLocation && typeof currentLocation.latitude === 'number' && typeof currentLocation.longitude === 'number'
                ? { lat: currentLocation.latitude, lng: currentLocation.longitude } : {};
            const { data, error: gErr } = await supabase.functions.invoke('geocode', {
                body: { query: val, limit: 10, ...near },
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
        if (saveMode) {
            const store = async (label: string, icon: string) => {
                const saved = await savePlace({ label, address, lat: latitude, lng: longitude, icon } as any);
                if (!saved) {
                    Alert.alert('Could not save', 'Please try again.');
                    return;
                }
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                navigation.goBack();
            };
            const short = (address || 'Saved place').split(',')[0].slice(0, 40);
            Alert.alert('Save this place as', address, [
                { text: 'Home', onPress: () => store('Home', '🏠') },
                { text: 'Work', onPress: () => store('Work', '💼') },
                { text: short, onPress: () => store(short, '📍') },
                { text: 'Cancel', style: 'cancel' },
            ]);
            return;
        }

        if (editPickupMode) {
            navigation.replace('DestinationSearch', {
                currentLocation: { latitude, longitude, address },
            });
            return;
        }

        logAppEvent('rider_destination_searched');
        navigation.navigate('RideConfirmation', {
            destination: { latitude, longitude, address },
            pickup: currentLocation || { latitude: DEFAULT_LOCATION.latitude, longitude: DEFAULT_LOCATION.longitude, address: 'Current Location' },
            source,
            sourceMetadata,
            kioskId,
            taxiStandId,
            stop,
        });
    };

    // Back from PinOnMap with a hand-placed spot: carry on as if search found it.
    useEffect(() => {
        if (!pinned) return;
        navigation.setParams({ pinned: undefined });
        choose(pinned.latitude, pinned.longitude, pinned.address);
    }, [pinned]);

    const pinOnMap = () => navigation.navigate('PinOnMap', {
        near: currentLocation ? { latitude: currentLocation.latitude, longitude: currentLocation.longitude } : undefined,
        label: query.trim(),
    });
    const askG = () => navigation.navigate('Home', { screen: 'Map', params: { askG: query.trim() } } as never);

    // Never a dead end: whatever search says, there is always a next step.
    const wayOut = (
        <View style={{ marginTop: SPACE.lg }}>
            <Button title="Set it on the map" icon="location" variant="secondary" onPress={pinOnMap} />
            {query.trim().length >= 2 && !saveMode && !editPickupMode
                ? <Button title="Ask G to find it" icon="sparkles" variant="ghost" onPress={askG} style={{ marginTop: SPACE.sm }} />
                : null}
        </View>
    );

    const m = useTheme();
    const placeholder = editPickupMode ? 'Search for your pickup point' : saveMode ? 'Search for a place to save' : 'Where to?';

    const place = (key: string, icon: any, title: string, subtitle: string, onPress: () => void, last?: boolean) => (
        <Row key={key} icon={icon} title={title} subtitle={subtitle || undefined} onPress={onPress} last={last} />
    );

    return (
        <View style={{ flex: 1, backgroundColor: m.page }}>
            <StatusBar style={m.statusBar} />
            <View style={{ paddingTop: insets.top + SPACE.sm, paddingHorizontal: GUTTER - 4, paddingBottom: SPACE.md, flexDirection: 'row', alignItems: 'center' }}>
                <IconButton icon="chevron-back" label="Back" onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); navigation.goBack(); }} />
                <View style={{ flex: 1, marginLeft: SPACE.sm, height: 52, borderRadius: RADIUS.pill, backgroundColor: m.field, flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACE.lg, borderWidth: 1.5, borderColor: m.accent }}>
                    <Ionicons name="search" size={18} color={m.searchIcon} />
                    <TextInput
                        ref={inputRef}
                        style={{ flex: 1, height: '100%', marginLeft: SPACE.sm, color: m.ink, fontFamily: FONT.semibold, fontSize: 16 }}
                        placeholder={placeholder}
                        placeholderTextColor={m.faint}
                        value={query}
                        onChangeText={onChangeQuery}
                        selectionColor={m.accent}
                        autoFocus
                        returnKeyType="search"
                        accessibilityLabel={placeholder}
                    />
                    {isLoading ? <ActivityIndicator size="small" color={m.accent} /> : query.length > 0 ? (
                        <Pressable accessibilityRole="button" accessibilityLabel="Clear search" hitSlop={8} onPress={() => onChangeQuery('')}>
                            <Ionicons name="close-circle" size={18} color={m.faint} />
                        </Pressable>
                    ) : null}
                </View>
            </View>
            {editPickupMode && (
                <Txt variant="caption" tone="dim" style={{ paddingHorizontal: GUTTER, marginBottom: SPACE.sm }}>Choose the exact spot where the driver should meet you.</Txt>
            )}
            {stop && !editPickupMode && (
                <View style={{ marginHorizontal: GUTTER, marginBottom: SPACE.md, flexDirection: 'row', alignItems: 'center', padding: SPACE.md, borderRadius: 16,
                    backgroundColor: m.field, borderWidth: 2, borderBottomWidth: 4, borderColor: m.chipBorder }}>
                    <View style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: '#FF8A3D', alignItems: 'center', justifyContent: 'center' }}>
                        <Ionicons name="storefront" size={17} color="#FFFFFF" />
                    </View>
                    <View style={{ flex: 1, marginLeft: SPACE.md }}>
                        <Txt variant="overline" tone="faint">STOP ON THE WAY</Txt>
                        <Txt variant="bodyStrong" numberOfLines={1}>{stop.name}</Txt>
                    </View>
                </View>
            )}

            {netInfo.isConnected === false && (
                <View style={{ marginHorizontal: GUTTER, marginBottom: SPACE.sm, padding: SPACE.md, borderRadius: 14, flexDirection: 'row', alignItems: 'center', backgroundColor: m.key === 'day' ? '#FFF6E5' : 'rgba(245,158,11,0.16)' }}>
                    <Ionicons name="cloud-offline-outline" size={16} color="#D97706" />
                    <Txt variant="caption" style={{ flex: 1, marginLeft: SPACE.sm }}>You are offline. Search needs a connection; saved places still work.</Txt>
                </View>
            )}

            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
                {query.length > 0 ? (
                    <FlatList
                        data={results}
                        keyExtractor={(item: any, i) => item.id?.toString() || `res-${i}`}
                        renderItem={({ item, index }) => place(
                            `r-${index}`, 'location-outline',
                            item.name || item.address?.split(',')[0] || 'Place', item.address || '',
                            () => choose(item.latitude, item.longitude, item.name || item.address),
                            index === results.length - 1,
                        )}
                        keyboardShouldPersistTaps="handled"
                        contentContainerStyle={{ paddingHorizontal: GUTTER, paddingBottom: insets.bottom + SPACE.xxl }}
                        ListEmptyComponent={
                            isLoading ? null : error ? (
                                <EmptyState icon="alert-circle-outline" title="Search is not working right now" body="Check your connection and try again."
                                    action={<Button title="Try again" variant="secondary" onPress={() => runSearch(query.trim())} />} />
                            ) : query.trim().length >= 2 ? (
                                <EmptyState icon="search-outline" title={`We can't find "${query.trim()}" yet`} body="Set it on the map, or tell G in your own words." />
                            ) : null
                        }
                        ListFooterComponent={isLoading ? null : wayOut}
                    />
                ) : (
                    <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}
                        contentContainerStyle={{ paddingHorizontal: GUTTER, paddingBottom: insets.bottom + SPACE.xxl }}>
                        {saved.length > 0 && (
                            <Section title="Saved" style={{ marginTop: SPACE.sm }}>
                                {saved.map((p, i) => place(p.id, p.label === 'Home' ? 'home-outline' : p.label === 'Work' ? 'briefcase-outline' : 'bookmark-outline',
                                    p.label, p.address, () => choose(p.lat, p.lng, p.address || p.label), i === saved.length - 1))}
                            </Section>
                        )}
                        {recents.length > 0 && (
                            <Section title="Recent">
                                {recents.map((r, i) => place(r.id, 'time-outline', r.name, r.address, () => choose(r.latitude, r.longitude, r.address || r.name), i === recents.length - 1))}
                            </Section>
                        )}
                        {nearbyPins.length > 0 && (
                            <Section title="Nearby">
                                {nearbyPins.map((pin: any, i: number) => place(pin.id || `pin-${i}`, 'business-outline', pin.name,
                                    `${pin.distance_meters ? `${Math.round(pin.distance_meters)} m · ` : ''}${pin.address || ''}`,
                                    () => choose(pin.latitude, pin.longitude, pin.address || pin.name), i === nearbyPins.length - 1))}
                            </Section>
                        )}
                        {saved.length === 0 && recents.length === 0 && nearbyPins.length === 0 && (
                            <EmptyState icon="navigate-outline" title="Where are you going?" body="Type a landmark, a shop or an address." />
                        )}
                        {wayOut}
                    </ScrollView>
                )}
            </KeyboardAvoidingView>
        </View>
    );
}
