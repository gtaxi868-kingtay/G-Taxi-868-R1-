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

import { tokens } from '../design-system/tokens';

const { width, height } = Dimensions.get('window');

// --- Rider Design Tokens (Deprecated local, using tokens) ---
const R = {
    bg: tokens.colors.background.base,
    surface: tokens.colors.background.surface,
    border: tokens.colors.glass.stroke,
    purple: tokens.colors.primary.purple,
    purpleLight: tokens.colors.primary.cyan,
    white: tokens.colors.text.primary,
    muted: tokens.colors.text.secondary,
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
    header: { paddingHorizontal: 20, paddingBottom: 20, borderBottomLeftRadius: 32, borderBottomRightRadius: 32, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.02)' },
    
    backCircle: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
    
    inputRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 20, paddingHorizontal: 16, height: 60, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
    input: { flex: 1, height: '100%', color: '#FFF', fontSize: 17, marginLeft: 12 },

    content: { flex: 1, padding: 20 },
    sectionLabel: { marginBottom: 16, opacity: 0.6, letterSpacing: 1 },

    resultRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.02)', padding: 16, borderRadius: 24, marginBottom: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.03)' },
    iconCircle: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(123, 97, 255, 0.1)', alignItems: 'center', justifyContent: 'center' },
    resultInfo: { marginLeft: 16, flex: 1 },

    loadingContainer: { marginTop: 40, alignItems: 'center' },
    backBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: R.surface, alignItems: 'center', justifyContent: 'center' },
    inputContainer: { flex: 1, height: 50, backgroundColor: R.surface, borderRadius: 12, marginLeft: 12, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12 },
    searchIcon: { marginRight: 8 },
    list: { paddingBottom: 40 },
    sectionHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 24, paddingBottom: 12 },
    empty: { marginTop: 40, alignItems: 'center' },
});
