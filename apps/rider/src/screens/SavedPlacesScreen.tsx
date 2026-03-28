import React, { useState, useEffect } from 'react';
import {
    View, StyleSheet, TouchableOpacity, FlatList,
    Alert, Dimensions, ActivityIndicator
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../../shared/supabase';
import { useAuth } from '../context/AuthContext';
import { Txt } from '../design-system/primitives';

import { tokens } from '../design-system/tokens';

const { width } = Dimensions.get('window');

// --- Rider Design Tokens (Deprecated local, using tokens) ---
const R = {
    bg: tokens.colors.background.base,
    surface: tokens.colors.background.surface,
    border: tokens.colors.glass.stroke,
    purple: tokens.colors.primary.purple,
    purpleLight: tokens.colors.primary.cyan,
    gold: '#FFD700',
    white: tokens.colors.text.primary,
    muted: tokens.colors.text.secondary,
};

interface SavedPlace {
    id: string;
    label: string;
    address: string;
    latitude: number;
    longitude: number;
    icon: string;
}

export function SavedPlacesScreen({ navigation }: any) {
    const { user } = useAuth();
    const insets = useSafeAreaInsets();

    const [places, setPlaces] = useState<SavedPlace[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (user) fetchSavedPlaces();
    }, [user]);

    const fetchSavedPlaces = async () => {
        try {
            setLoading(true);
            const { data, error } = await supabase
                .from('saved_places')
                .select('*')
                .eq('user_id', user?.id)
                .order('created_at', { ascending: true });

            if (data) setPlaces(data);
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = (id: string, label: string) => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        Alert.alert(
            'Delete Place',
            `Are you sure you want to remove "${label}"?`,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: async () => {
                        const { error } = await supabase.from('saved_places').delete().eq('id', id);
                        if (!error) {
                            setPlaces(prev => prev.filter(p => p.id !== id));
                            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                        }
                    }
                }
            ]
        );
    };

    const renderItem = ({ item }: { item: SavedPlace }) => (
        <View style={s.card}>
            <View style={s.iconWrap}>
                <Txt style={{ fontSize: 20 }}>{item.icon || '📍'}</Txt>
            </View>
            <View style={s.info}>
                <Txt variant="bodyBold" color="#FFF">{item.label}</Txt>
                <Txt variant="small" color={R.muted} numberOfLines={1}>{item.address}</Txt>
            </View>
            <TouchableOpacity onPress={() => handleDelete(item.id, item.label)} style={s.deleteBtn}>
                <Ionicons name="trash-outline" size={20} color={R.muted} />
            </TouchableOpacity>
        </View>
    );

    return (
        <View style={s.root}>
            <StatusBar style="light" />

            <View style={[s.header, { paddingTop: insets.top + 10 }]}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={s.headerBtn}>
                    <Ionicons name="chevron-back" size={24} color="#FFF" />
                </TouchableOpacity>
                <Txt variant="headingM" weight="heavy" color="#FFF" style={{ marginLeft: 16 }}>Saved Places</Txt>
            </View>

            {loading ? (
                <View style={s.center}><ActivityIndicator color={R.purple} /></View>
            ) : (
                <FlatList
                    data={places}
                    keyExtractor={item => item.id}
                    renderItem={renderItem}
                    contentContainerStyle={[s.list, { paddingBottom: insets.bottom + 40 }]}
                    ListEmptyComponent={
                        <View style={s.empty}>
                            <Ionicons name="bookmark-outline" size={64} color={R.muted} />
                            <Txt variant="bodyReg" color={R.muted} style={{ marginTop: 16 }}>No saved places yet</Txt>
                        </View>
                    }
                />
            )}

            <View style={[s.footer, { paddingBottom: Math.max(insets.bottom, 24) }]}>
                <TouchableOpacity
                    style={s.addBtn}
                    onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); navigation.navigate('DestinationSearch', { mode: 'save' }); }}
                >
                    <LinearGradient 
                        colors={[tokens.colors.primary.purple, tokens.colors.primary.cyan]} 
                        start={{x: 0, y: 0}} 
                        end={{x: 1, y: 0}}
                        style={s.btnGradient}
                    >
                        <Ionicons name="add" size={24} color="#FFF" />
                        <Txt variant="bodyBold" color="#FFF" style={{ marginLeft: 8 }}>ADD NEW PLACE</Txt>
                    </LinearGradient>
                </TouchableOpacity>
            </View>
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: R.bg },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, marginBottom: 20 },
    headerBtn: { width: 44, height: 44, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' },

    list: { paddingHorizontal: 20 },
    card: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.03)', padding: 20, borderRadius: 32, marginBottom: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
    iconWrap: { width: 56, height: 56, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' },
    info: { flex: 1, marginLeft: 16 },
    deleteBtn: { padding: 12 },

    center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    empty: { marginTop: 100, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.02)', padding: 40, borderRadius: 40 },

    footer: { paddingHorizontal: 20, paddingTop: 16 },
    addBtn: { height: 64, borderRadius: 24, overflow: 'hidden' },
    btnGradient: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
});
