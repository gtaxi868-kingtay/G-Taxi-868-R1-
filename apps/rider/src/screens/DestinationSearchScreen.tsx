import React, { useState, useEffect, useRef } from 'react';
import {
    View, StyleSheet, TextInput, TouchableOpacity,
    FlatList, Dimensions, ActivityIndicator, Keyboard
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../../shared/supabase';
import { Txt } from '../design-system/primitives';

const { width, height } = Dimensions.get('window');

// ── Rider Design Tokens ──────────────────────────────────────────────────────
const R = {
    bg: '#07050F',
    surface: '#110E22',
    border: 'rgba(255,255,255,0.08)',
    purple: '#7C3AED',
    purpleLight: '#A78BFA',
    white: '#FFFFFF',
    muted: 'rgba(255,255,255,0.4)',
};

export function DestinationSearchScreen({ navigation, route }: any) {
    const insets = useSafeAreaInsets();
    const { currentLocation } = route.params || {};

    const [query, setQuery] = useState('');
    const [results, setResults] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [recentSearches, setRecentSearches] = useState<any[]>([]);

    const inputRef = useRef<TextInput>(null);

    useEffect(() => {
        // Focus input on mount
        setTimeout(() => inputRef.current?.focus(), 100);
        loadRecentSearches();
    }, []);

    const loadRecentSearches = async () => {
        // Simple mock of recent searches for now or fetch from local storage if implemented
        setRecentSearches([
            { id: 'r1', name: 'Piarco Airport', address: 'Golden Grove Rd, Piarco' },
            { id: 'r2', name: 'Trincity Mall', address: 'Trincity Central Rd' },
        ]);
    };

    const searchPlaces = async (val: string) => {
        setQuery(val);
        if (val.length < 2) {
            setResults([]);
            return;
        }

        setIsLoading(true);
        try {
            // WIRING_RULE: Keep exact Mapbox geocoding call
            const { data, error } = await supabase.functions.invoke('geocode', {
                body: { query: val, limit: 10 },
            });
            if (data?.success && data?.data) {
                setResults(data.data);
            }
        } catch (err) {
            console.error(err);
        } finally {
            setIsLoading(false);
        }
    };

    const handleSelect = (item: any) => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        Keyboard.dismiss();

        // WIRING_RULE: Result tap navigates to RideConfirmation
        navigation.navigate('RideConfirmation', {
            destination: {
                latitude: item.latitude,
                longitude: item.longitude,
                address: item.name || item.address,
            },
            pickup: currentLocation || { latitude: 10.66, longitude: -61.51, address: 'Current Location' }
        });
    };

    const renderItem = ({ item }: { item: any }) => (
        <TouchableOpacity style={s.resultRow} onPress={() => handleSelect(item)}>
            <View style={s.iconCircle}>
                <Ionicons name="location-sharp" size={18} color={R.purpleLight} />
            </View>
            <View style={s.resultInfo}>
                <Txt variant="bodyBold" color={R.white}>{item.name || item.address?.split(',')[0]}</Txt>
                <Txt variant="small" color={R.muted} numberOfLines={1}>{item.address}</Txt>
            </View>
        </TouchableOpacity>
    );

    return (
        <View style={s.root}>
            <StatusBar style="light" />

            {/* Header row: [← back circle] | search TextInput autofocus */}
            <View style={[s.header, { paddingTop: insets.top + 10 }]}>
                <TouchableOpacity
                    style={s.backBtn}
                    onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); navigation.goBack(); }}
                >
                    <Ionicons name="chevron-back" size={24} color={R.white} />
                </TouchableOpacity>

                <View style={s.inputContainer}>
                    <Ionicons name="search" size={18} color={R.muted} style={s.searchIcon} />
                    <TextInput
                        ref={inputRef}
                        style={s.input}
                        placeholder="Where to?"
                        placeholderTextColor={R.muted}
                        value={query}
                        onChangeText={searchPlaces}
                        selectionColor={R.purpleLight}
                        autoFocus
                    />
                    {isLoading && <ActivityIndicator size="small" color={R.purple} />}
                </View>
            </View>

            {/* Results list or Recent Searches */}
            <FlatList
                data={query.length > 0 ? results : recentSearches}
                keyExtractor={item => item.id}
                renderItem={renderItem}
                contentContainerStyle={s.list}
                ListHeaderComponent={
                    query.length === 0 ? (
                        <View style={s.sectionHeader}>
                            <Ionicons name="time-outline" size={16} color={R.muted} />
                            <Txt variant="caption" weight="bold" color={R.muted} style={{ marginLeft: 8 }}>RECENT SEARCHES</Txt>
                        </View>
                    ) : null
                }
                ListEmptyComponent={
                    !isLoading && query.length > 0 ? (
                        <View style={s.empty}>
                            <Txt variant="bodyReg" color={R.muted}>No results found</Txt>
                        </View>
                    ) : null
                }
            />
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: R.bg },
    header: {
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: 16, paddingBottom: 16,
        borderBottomWidth: 1, borderColor: R.border
    },
    backBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: R.surface, alignItems: 'center', justifyContent: 'center' },

    inputContainer: {
        flex: 1, height: 50, backgroundColor: R.surface,
        borderRadius: 12, marginLeft: 12, flexDirection: 'row',
        alignItems: 'center', paddingHorizontal: 12,
        borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)'
    },
    searchIcon: { marginRight: 8 },
    input: { flex: 1, color: R.white, fontSize: 16 },

    list: { paddingBottom: 40 },
    sectionHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 24, paddingBottom: 12 },
    resultRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, paddingHorizontal: 20 },
    iconCircle: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' },
    resultInfo: { flex: 1, marginLeft: 16 },
    empty: { marginTop: 40, alignItems: 'center' },
});
