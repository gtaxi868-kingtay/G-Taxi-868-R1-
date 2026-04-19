import React, { useState, useEffect, useRef } from 'react';
import {
    View, Text, StyleSheet, TextInput, TouchableOpacity,
    FlatList, Dimensions, ActivityIndicator, Keyboard
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../../shared/supabase';

const { width, height } = Dimensions.get('window');

// Blueberry Luxe Color System
const COLORS = {
    bgPrimary: '#0D0B1E',
    bgSecondary: '#160B32',
    gradientStart: '#1A0533',
    gradientEnd: '#0D1B4B',
    purple: '#7B5CF0',
    purpleDark: '#5B3FD0',
    purpleLight: '#9B7CF0',
    cyan: '#00E5FF',
    cyanDark: '#0099BB',
    cyanSoft: 'rgba(0,229,255,0.1)',
    white: '#FFFFFF',
    textSecondary: 'rgba(255,255,255,0.6)',
    textMuted: 'rgba(255,255,255,0.4)',
    glassBg: 'rgba(255,255,255,0.06)',
    glassBorder: 'rgba(123,92,240,0.3)',
    success: '#00FF94',
    warning: '#F59E0B',
    error: '#EF4444',
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
                <Ionicons name="location-sharp" size={18} color={COLORS.cyan} />
            </View>
            <View style={s.resultInfo}>
                <Text style={s.resultName}>{item.name || item.address?.split(',')[0]}</Text>
                <Text style={s.resultAddress} numberOfLines={1}>{item.address}</Text>
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
                    <Ionicons name="chevron-back" size={24} color={COLORS.white} />
                </TouchableOpacity>

                <View style={s.inputContainer}>
                    <Ionicons name="search" size={18} color={COLORS.textMuted} style={s.searchIcon} />
                    <TextInput
                        ref={inputRef}
                        style={s.input}
                        placeholder="Where to?"
                        placeholderTextColor={COLORS.textMuted}
                        value={query}
                        onChangeText={searchPlaces}
                        selectionColor={COLORS.cyan}
                        autoFocus
                    />
                    {isLoading && <ActivityIndicator size="small" color={COLORS.purple} />}
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
                            <Ionicons name="time-outline" size={16} color={COLORS.textMuted} />
                            <Text style={[s.sectionLabel, { marginLeft: 8 }]}>RECENT SEARCHES</Text>
                        </View>
                    ) : null
                }
                ListEmptyComponent={
                    !isLoading && query.length > 0 ? (
                        <View style={s.empty}>
                            <Text style={s.emptyText}>No results found</Text>
                        </View>
                    ) : null
                }
            />
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: COLORS.bgPrimary },
    header: { paddingHorizontal: 20, paddingBottom: 20, borderBottomLeftRadius: 32, borderBottomRightRadius: 32, overflow: 'hidden', backgroundColor: COLORS.glassBg },
    
    backCircle: { width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.glassBg, alignItems: 'center', justifyContent: 'center', marginBottom: 20, borderWidth: 1, borderColor: COLORS.glassBorder },
    
    inputRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.glassBg, borderRadius: 20, paddingHorizontal: 16, height: 60, borderWidth: 1, borderColor: COLORS.glassBorder },
    input: { flex: 1, height: '100%', color: COLORS.white, fontSize: 17, marginLeft: 12 },

    content: { flex: 1, padding: 20 },
    sectionLabel: { fontSize: 12, fontWeight: '800', color: COLORS.textMuted, letterSpacing: 1 },

    resultRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.glassBg, padding: 16, borderRadius: 24, marginBottom: 12, borderWidth: 1, borderColor: COLORS.glassBorder },
    iconCircle: { width: 48, height: 48, borderRadius: 24, backgroundColor: COLORS.cyanSoft, alignItems: 'center', justifyContent: 'center' },
    resultInfo: { marginLeft: 16, flex: 1 },
    resultName: { fontSize: 16, fontWeight: '700', color: COLORS.white, marginBottom: 4 },
    resultAddress: { fontSize: 13, fontWeight: '500', color: COLORS.textMuted },

    loadingContainer: { marginTop: 40, alignItems: 'center' },
    backBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.glassBg, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.glassBorder },
    inputContainer: { flex: 1, height: 50, backgroundColor: COLORS.bgSecondary, borderRadius: 12, marginLeft: 12, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, borderWidth: 1, borderColor: COLORS.glassBorder },
    searchIcon: { marginRight: 8 },
    list: { paddingBottom: 40 },
    sectionHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 24, paddingBottom: 12 },
    empty: { marginTop: 40, alignItems: 'center' },
    emptyText: { fontSize: 15, fontWeight: '500', color: COLORS.textMuted },
});
