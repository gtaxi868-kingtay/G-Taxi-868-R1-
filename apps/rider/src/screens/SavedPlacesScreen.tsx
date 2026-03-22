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

const { width } = Dimensions.get('window');

// ── Rider Design Tokens ──────────────────────────────────────────────────────
const R = {
    bg: '#07050F',
    surface: '#110E22',
    border: 'rgba(255,255,255,0.08)',
    purple: '#7C3AED',
    purpleLight: '#A78BFA',
    gold: '#F59E0B',
    white: '#FFFFFF',
    muted: 'rgba(255,255,255,0.4)',
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

            <BlurView tint="dark" intensity={80} style={[s.header, { paddingTop: insets.top + 10 }]}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={s.headerBtn}>
                    <Ionicons name="chevron-back" size={24} color="#FFF" />
                </TouchableOpacity>
                <Txt variant="headingM" weight="heavy" color="#FFF">Saved Places</Txt>
                <View style={{ width: 44 }} />
            </BlurView>

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

            <View style={[s.footer, { paddingBottom: Math.max(insets.bottom, 20) }]}>
                <TouchableOpacity
                    style={s.addBtn}
                    onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); navigation.navigate('DestinationSearch', { mode: 'save' }); }}
                >
                    <LinearGradient colors={[R.purple, '#4C1D95']} style={s.btnGradient}>
                        <Ionicons name="add" size={24} color="#FFF" />
                        <Txt variant="bodyBold" color="#FFF" style={{ marginLeft: 8 }}>Add New Place</Txt>
                    </LinearGradient>
                </TouchableOpacity>
            </View>
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: R.bg },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 16, borderBottomWidth: 1, borderColor: R.border },
    headerBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: R.surface, alignItems: 'center', justifyContent: 'center' },

    list: { padding: 24 },
    card: { flexDirection: 'row', alignItems: 'center', backgroundColor: R.surface, padding: 16, borderRadius: 24, marginBottom: 12, borderWidth: 1, borderColor: R.border },
    iconWrap: { width: 48, height: 48, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.03)', alignItems: 'center', justifyContent: 'center' },
    info: { flex: 1, marginLeft: 16 },
    deleteBtn: { padding: 8 },

    center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    empty: { marginTop: 100, alignItems: 'center' },

    footer: { paddingHorizontal: 24, paddingTop: 16 },
    addBtn: { height: 60, borderRadius: 30, overflow: 'hidden' },
    btnGradient: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
});
