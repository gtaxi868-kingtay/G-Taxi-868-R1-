import React, { useEffect, useState } from 'react';
import {
    View, StyleSheet, FlatList, TouchableOpacity,
    ActivityIndicator, Dimensions
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
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
    green: '#10B981',
    red: '#EF4444',
    white: '#FFFFFF',
    muted: 'rgba(255,255,255,0.4)',
};

export function TripsScreen({ navigation }: any) {
    const { user } = useAuth();
    const insets = useSafeAreaInsets();

    const [trips, setTrips] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (user?.id) fetchTrips();
    }, [user?.id]);

    const fetchTrips = async () => {
        setLoading(true);
        // BUG_FIX: Ensure rides query filters by rider_id AND sorts by created_at DESC
        const { data, error } = await supabase
            .from('rides')
            .select('*')
            .eq('rider_id', user?.id)
            .order('created_at', { ascending: false });

        if (data && !error) setTrips(data);
        setLoading(false);
    };

    const renderTrip = ({ item }: { item: any }) => {
        const date = new Date(item.created_at);
        const isCompleted = item.status === 'completed' || item.status === 'closed';
        const isCancelled = item.status === 'canceled' || item.status === 'cancelled';

        return (
            <TouchableOpacity
                style={s.card}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); navigation.navigate('Receipt', { ride: item }); }}
            >
                <View style={s.cardHeader}>
                    <Txt variant="bodyBold" color={R.white}>{date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</Txt>
                    <Txt variant="bodyBold" color={R.white}>${((item.total_fare_cents || 0) / 100).toFixed(2)}</Txt>
                </View>

                <View style={s.route}>
                    <View style={s.routeLineWrap}>
                        <View style={[s.marker, { backgroundColor: R.purple }]} />
                        <View style={s.line} />
                        <View style={[s.marker, { backgroundColor: R.gold }]} />
                    </View>
                    <View style={s.addressWrap}>
                        <Txt variant="small" color={R.muted} numberOfLines={1}>{item.pickup_address}</Txt>
                        <View style={{ height: 12 }} />
                        <Txt variant="small" color={R.muted} numberOfLines={1}>{item.dropoff_address}</Txt>
                    </View>
                </View>

                <View style={s.cardFooter}>
                    <View style={[s.statusPill, { backgroundColor: isCompleted ? 'rgba(16,185,129,0.1)' : isCancelled ? 'rgba(239,68,68,0.1)' : 'rgba(255,255,255,0.05)' }]}>
                        <Txt variant="caption" weight="heavy" color={isCompleted ? R.green : isCancelled ? R.red : R.muted}>
                            {item.status.toUpperCase()}
                        </Txt>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={R.muted} />
                </View>
            </TouchableOpacity>
        );
    };

    return (
        <View style={s.root}>
            <StatusBar style="light" />

            {/* Header: BlurView with "Your Trips" title + Back button */}
            <BlurView tint="dark" intensity={80} style={[s.header, { paddingTop: insets.top + 10 }]}>
                <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()}>
                    <Ionicons name="chevron-back" size={24} color="#FFF" />
                </TouchableOpacity>
                <Txt variant="headingM" weight="heavy" color="#FFF" style={s.title}>Your Trips</Txt>
            </BlurView>

            {loading ? (
                <View style={s.center}><ActivityIndicator color={R.purple} /></View>
            ) : (
                <FlatList
                    data={trips}
                    keyExtractor={item => item.id}
                    renderItem={renderTrip}
                    contentContainerStyle={[s.list, { paddingBottom: insets.bottom + 40 }]}
                    ListEmptyComponent={
                        <View style={s.empty}>
                            <Ionicons name="car-outline" size={64} color={R.muted} />
                            <Txt variant="bodyReg" color={R.muted} style={{ marginTop: 16 }}>No trips yet</Txt>
                        </View>
                    }
                />
            )}
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: R.bg },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 16, borderBottomWidth: 1, borderColor: R.border, zIndex: 10 },
    backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' },
    title: { marginLeft: 16 },

    list: { padding: 20 },
    card: { backgroundColor: R.surface, borderRadius: 20, padding: 20, marginBottom: 16, borderWidth: 1, borderColor: R.border },
    cardHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 },

    route: { flexDirection: 'row', marginBottom: 20 },
    routeLineWrap: { width: 20, alignItems: 'center', paddingVertical: 4 },
    marker: { width: 8, height: 8, borderRadius: 4 },
    line: { width: 1, flex: 1, backgroundColor: 'rgba(255,255,255,0.1)', marginVertical: 4 },
    addressWrap: { flex: 1, marginLeft: 12 },

    cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 16, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.05)' },
    statusPill: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12 },

    center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    empty: { marginTop: 100, alignItems: 'center' },
});
