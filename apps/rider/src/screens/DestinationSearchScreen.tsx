import React, { useState, useEffect, useRef } from 'react';
import {
    View, Text, StyleSheet, TextInput, TouchableOpacity,
    FlatList, useWindowDimensions, ActivityIndicator, Keyboard,
    KeyboardAvoidingView, Platform
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@gtaxi/core';
import { SURFACE, VOICES, ANIMATION } from '@gtaxi/design-system';
import { ghostBorder, elevationGlow, glassSurface } from '@gtaxi/design-system/utils/style-rules';
import { AppScreenProps } from '../navigation/types';

export function DestinationSearchScreen({ navigation, route }: AppScreenProps<'DestinationSearch'>) {
    const { width, height } = useWindowDimensions();
    const insets = useSafeAreaInsets();
    const { currentLocation, source, sourceMetadata, kioskId, taxiStandId } = route.params || {};

    const [query, setQuery] = useState('');
    const [results, setResults] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [recentSearches, setRecentSearches] = useState<{ id: string; name: string; address: string }[]>([]);

    const inputRef = useRef<TextInput>(null);

    useEffect(() => {
        const timer = setTimeout(() => inputRef.current?.focus(), 100);
        loadRecentSearches();
        return () => clearTimeout(timer);
    }, []);

    const loadRecentSearches = async () => {
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

        navigation.navigate('RideConfirmation', {
            destination: {
                latitude: item.latitude,
                longitude: item.longitude,
                address: item.name || item.address,
            },
            pickup: currentLocation || { latitude: 10.66, longitude: -61.51, address: 'Current Location' },
            source,
            sourceMetadata,
            kioskId,
            taxiStandId,
        });
    };

    const renderItem = ({ item }: { item: any }) => (
        <TouchableOpacity style={s.resultRow} onPress={() => handleSelect(item)}>
            <View style={s.iconCircle}>
                <Ionicons name="location-sharp" size={18} color="#00E5FF" />
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

            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                style={{ flex: 1 }}
            >
            <View style={[s.header, { paddingTop: insets.top + 10 }]}>
                <TouchableOpacity
                    style={s.backBtn}
                    onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); navigation.goBack(); }}
                >
                    <Ionicons name="chevron-back" size={24} color="#FFF" />
                </TouchableOpacity>

                <View style={s.inputContainer}>
                    <Ionicons name="search" size={18} color="rgba(255,255,255,0.6)" style={s.searchIcon} />
                    <TextInput
                        ref={inputRef}
                        style={s.input}
                        placeholder="Where to?"
                        placeholderTextColor="rgba(255,255,255,0.6)"
                        value={query}
                        onChangeText={searchPlaces}
                        selectionColor="#00E5FF"
                        autoFocus
                    />
                    {isLoading && <ActivityIndicator size="small" color={VOICES.rider.accent} />}
                </View>
            </View>

            <FlatList
                data={query.length > 0 ? results : recentSearches}
                keyExtractor={(item: any) => item.id}
                renderItem={renderItem}
                contentContainerStyle={s.list}
                ListHeaderComponent={
                    query.length === 0 ? (
                        <View style={s.sectionHeader}>
                            <Ionicons name="time-outline" size={16} color="rgba(255,255,255,0.6)" />
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
            </KeyboardAvoidingView>
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: SURFACE.base },
    header: { paddingHorizontal: 20, paddingBottom: 20, borderBottomLeftRadius: 32, borderBottomRightRadius: 32, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.03)' },
    
    input: { flex: 1, height: '100%', color: '#FFF', fontSize: 17, marginLeft: 12 },

    content: { flex: 1, padding: 20 },
    sectionLabel: { fontSize: 12, fontWeight: '800', color: 'rgba(255,255,255,0.6)', letterSpacing: 1 },

    resultRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.03)', padding: 16, borderRadius: 24, marginBottom: 12, ...ghostBorder() },
    iconCircle: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(0,229,255,0.1)', alignItems: 'center', justifyContent: 'center' },
    resultInfo: { marginLeft: 16, flex: 1 },
    resultName: { fontSize: 16, fontWeight: '700', color: '#FFF', marginBottom: 4 },
    resultAddress: { fontSize: 13, fontWeight: '500', color: 'rgba(255,255,255,0.6)' },

    loadingContainer: { marginTop: 40, alignItems: 'center' },
    backBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.03)', alignItems: 'center', justifyContent: 'center', ...ghostBorder() },
    inputContainer: { flex: 1, height: 50, backgroundColor: SURFACE.base, borderRadius: 12, marginLeft: 12, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, ...ghostBorder() },
    searchIcon: { marginRight: 8 },
    list: { paddingBottom: 40 },
    sectionHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 24, paddingBottom: 12 },
    empty: { marginTop: 40, alignItems: 'center' },
    emptyText: { fontSize: 15, fontWeight: '500', color: 'rgba(255,255,255,0.6)' },
});
