import React, { useEffect, useState } from 'react';
import {
    View, Text, StyleSheet, FlatList, ActivityIndicator,
    TouchableOpacity,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@gtaxi/core';
import { useAuth } from '../context/AuthContext';
import { SURFACE, VOICES } from '@gtaxi/design-system';
import { elevationGlow, ghostBorder, glassSurface } from '@gtaxi/design-system/utils/style-rules';

interface ScheduledRide {
    id: string;
    pickup_address: string;
    dropoff_address: string;
    total_fare_cents: number;
    scheduled_for: string;
    vehicle_type?: string;
}

interface NavigationProp {
    navigate: (screen: string, params?: object) => void;
    goBack: () => void;
}

export function ScheduledRidesScreen({ navigation }: { navigation: NavigationProp }) {
    const insets = useSafeAreaInsets();
    const { driver } = useAuth();
    const [rides, setRides] = useState<ScheduledRide[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!driver?.id) { setLoading(false); return; }
        const fetchScheduled = async () => {
            // Explicitly scope to this driver's own scheduled rides. RLS already
            // restricts a driver to assigned/offered/searching rides, but scoping
            // here makes intent clear and avoids fetching rows RLS would drop anyway.
            const { data } = await supabase
                .from('rides')
                .select('id, pickup_address, dropoff_address, total_fare_cents, scheduled_for, vehicle_type')
                .eq('driver_id', driver.id)
                .eq('status', 'scheduled')
                .eq('driver_id', driver.id)
                .order('scheduled_for', { ascending: true })
                .limit(30);

            if (data) setRides(data);
            setLoading(false);
        };
        fetchScheduled();
    }, [driver?.id]);

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
                <View style={s.cardTop}>
                    <Ionicons name="calendar-outline" size={16} color={VOICES.driver.accent} />
                    <Text style={{ marginLeft: 8, fontSize: 14, fontWeight: '600', color: '#EAF3F6' }}>{formattedDate}</Text>
                </View>

                <View style={s.addressRow}>
                    <View style={s.dot} />
                    <Text style={{ flex: 1, fontSize: 14, fontWeight: '400', color: '#EAF3F6' }} numberOfLines={1}>{item.pickup_address}</Text>
                </View>

                <View style={s.addressRow}>
                    <View style={s.square} />
                    <Text style={{ flex: 1, fontSize: 14, fontWeight: '400', color: '#EAF3F6' }} numberOfLines={1}>{item.dropoff_address}</Text>
                </View>

                <View style={s.cardDivider} />

                <View style={s.cardBottom}>
                    <Text style={{fontSize: 16, fontWeight: '800', color: VOICES.driver.accent}}>${fair}</Text>
                    <View style={s.tag}>
                        <Text style={{fontSize: 11, fontWeight: '700', color: VOICES.driver.accent}}>{item.vehicle_type ? item.vehicle_type.charAt(0).toUpperCase() + item.vehicle_type.slice(1).replace('_', ' ') : 'Standard'}</Text>
                    </View>
                </View>
            </TouchableOpacity>
        );
    };

    return (
        <View style={s.root}>
            <StatusBar style="light" />

            <BlurView tint="dark" intensity={80} style={[s.header, { paddingTop: insets.top + 8 }, glassSurface(80, 0.2)]}>
                <TouchableOpacity
                    style={s.headerBtn}
                    onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); navigation.goBack(); }}
                >
                    <Ionicons name="chevron-back" size={24} color="#EAF3F6" />
                </TouchableOpacity>
                <Text style={{fontSize: 16, fontWeight: '700', color: '#EAF3F6'}}>Scheduled</Text>
                <View style={s.headerBtn} pointerEvents="none" />
            </BlurView>

            {loading ? (
                <View style={s.center}><ActivityIndicator color={VOICES.driver.accent} /></View>
            ) : (
                <FlatList
                    data={rides}
                    keyExtractor={t => t.id}
                    renderItem={renderItem}
                    contentContainerStyle={[s.list, { paddingTop: insets.top + 80, paddingBottom: insets.bottom + 20 }] as any}
                    ListEmptyComponent={
                        <View style={s.empty}>
                            <Ionicons name="calendar-outline" size={48} color="rgba(255,255,255,0.6)" />
                            <Text style={{ marginTop: 24, fontSize: 16, fontWeight: '700', color: '#EAF3F6' }}>No scheduled rides</Text>
                            <Text style={{ textAlign: 'center', marginTop: 8, fontSize: 14, fontWeight: '400', color: 'rgba(255,255,255,0.6)' }}>Go online to receive trips</Text>
                        </View>
                    }
                />
            )}
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: SURFACE.base },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    header: {
        position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 16, paddingBottom: 12, ...ghostBorder(0.15),
    },
    headerBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' },
    list: { paddingHorizontal: 20 },
    card: {
        backgroundColor: SURFACE.containerLow,
        borderRadius: 16, padding: 20, marginBottom: 16,
        ...elevationGlow(0.12),
    },
    cardTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
    addressRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
    dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: VOICES.driver.accent, marginRight: 12 },
    square: { width: 8, height: 8, backgroundColor: VOICES.driver.accent, marginRight: 12 },
    cardDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.05)', marginVertical: 8 },
    cardBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
    tag: { backgroundColor: VOICES.driver.accent + '1A', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
    empty: { marginTop: 100, alignItems: 'center', paddingHorizontal: 40 },
});
