import React, { useEffect, useState } from 'react';
import {
    View, StyleSheet, FlatList, ActivityIndicator,
    TouchableOpacity, Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../../shared/supabase';
import { Txt } from '../design-system/primitives';

const { width } = Dimensions.get('window');

// ── Driver-only tokens ────────────────────────────────────────────────────────
const C = {
    bg: '#07050F',
    surface: '#110E22',
    surfaceHigh: '#1A1530',
    border: 'rgba(139,92,246,0.15)',
    purple: '#7C3AED',
    purpleLight: '#A78BFA',
    gold: '#F59E0B',
    white: '#FFFFFF',
    muted: 'rgba(255,255,255,0.45)',
    faint: 'rgba(255,255,255,0.06)',
};

interface ScheduledRide {
    id: string;
    pickup_address: string;
    dropoff_address: string;
    total_fare_cents: number;
    scheduled_for: string;
    vehicle_type?: string;
}

export function ScheduledRidesScreen({ navigation }: any) {
    const insets = useSafeAreaInsets();
    const [rides, setRides] = useState<ScheduledRide[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchScheduled = async () => {
            const { data } = await supabase
                .from('rides')
                .select('id, pickup_address, dropoff_address, total_fare_cents, scheduled_for, vehicle_type')
                .eq('status', 'scheduled')
                .order('scheduled_for', { ascending: true })
                .limit(30);

            if (data) setRides(data);
            setLoading(false);
        };
        fetchScheduled();
    }, []);

    const renderItem = ({ item }: { item: ScheduledRide }) => {
        const fair = (item.total_fare_cents / 100).toFixed(2);
        const dateObj = new Date(item.scheduled_for);
        const formattedDate = dateObj.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

        return (
            <TouchableOpacity
                activeOpacity={0.9}
                style={s.card}
                onPress={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}
            >
                {/* Top row: calendar icon + formatted date/time (bold) */}
                <View style={s.cardTop}>
                    <Ionicons name="calendar-outline" size={16} color={C.purpleLight} />
                    <Txt variant="bodyBold" color={C.white} style={{ marginLeft: 8 }}>{formattedDate}</Txt>
                </View>

                {/* Pickup row: dot + address */}
                <View style={s.addressRow}>
                    <View style={s.dot} />
                    <Txt variant="bodyReg" color={C.white} numberOfLines={1} style={{ flex: 1 }}>{item.pickup_address}</Txt>
                </View>

                {/* Dropoff row: square + address */}
                <View style={s.addressRow}>
                    <View style={s.square} />
                    <Txt variant="bodyReg" color={C.white} numberOfLines={1} style={{ flex: 1 }}>{item.dropoff_address}</Txt>
                </View>

                <View style={s.cardDivider} />

                {/* Bottom row: estimated fare gold | vehicle type tag */}
                <View style={s.cardBottom}>
                    <Txt variant="headingM" weight="heavy" color={C.gold}>${fair}</Txt>
                    <View style={s.tag}>
                        <Txt variant="caption" weight="heavy" color={C.purpleLight}>{item.vehicle_type?.toUpperCase() || 'STANDARD'}</Txt>
                    </View>
                </View>
            </TouchableOpacity>
        );
    };

    return (
        <View style={s.root}>
            <StatusBar style="light" />

            {/* HEADER (BlurView): [← back] | ["Scheduled" centered] | [spacer] */}
            <BlurView tint="dark" intensity={80} style={[s.header, { paddingTop: insets.top + 8 }]}>
                <TouchableOpacity
                    style={s.headerBtn}
                    onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); navigation.goBack(); }}
                >
                    <Ionicons name="chevron-back" size={24} color={C.white} />
                </TouchableOpacity>
                <Txt variant="headingM" weight="bold" color={C.white}>Scheduled</Txt>
                <View style={s.headerBtn} pointerEvents="none" />
            </BlurView>

            {loading ? (
                <View style={s.center}><ActivityIndicator color={C.purple} /></View>
            ) : (
                <FlatList
                    data={rides}
                    keyExtractor={t => t.id}
                    renderItem={renderItem}
                    contentContainerStyle={[s.list, { paddingTop: insets.top + 80, paddingBottom: insets.bottom + 20 }]}
                    ListEmptyComponent={
                        <View style={s.empty}>
                            <Ionicons name="calendar-outline" size={48} color={C.muted} />
                            <Txt variant="headingM" weight="bold" color={C.white} style={{ marginTop: 24 }}>No scheduled rides</Txt>
                            <Txt variant="bodyReg" color={C.muted} style={{ textAlign: 'center', marginTop: 8 }}>Go online to receive trips</Txt>
                        </View>
                    }
                />
            )}
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: C.bg },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    header: {
        position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderColor: C.border
    },
    headerBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' },
    list: { paddingHorizontal: 20 },
    card: {
        backgroundColor: C.surface, borderRadius: 16, padding: 20, marginBottom: 16,
        borderWidth: 1, borderColor: 'rgba(124, 58, 237, 0.2)', shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 10
    },
    cardTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
    addressRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
    dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.purple, marginRight: 12 },
    square: { width: 8, height: 8, backgroundColor: C.gold, marginRight: 12 },
    cardDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.05)', marginVertical: 8 },
    cardBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
    tag: { backgroundColor: 'rgba(124, 58, 237, 0.1)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
    empty: { marginTop: 100, alignItems: 'center', paddingHorizontal: 40 },
});
