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
import { tokens } from '../design-system/tokens';

const { width } = Dimensions.get('window');

// --- Rider Design Tokens (Deprecated local, using tokens) ---
const R = {
    bg: tokens.colors.background.base,
    surface: tokens.colors.background.surface,
    border: tokens.colors.glass.stroke,
    purple: tokens.colors.primary.purple,
    purpleLight: tokens.colors.primary.cyan,
    gold: '#F59E0B',
    green: tokens.colors.status.success,
    red: tokens.colors.status.error,
    white: tokens.colors.text.primary,
    muted: tokens.colors.text.secondary,
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
                    <Txt variant="headingM" weight="heavy" color={tokens.colors.primary.cyan}>${((item.total_fare_cents || 0) / 100).toFixed(2)}</Txt>
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

            <View style={[s.header, { paddingTop: insets.top + 10 }]}>
                <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()}>
                    <Ionicons name="chevron-back" size={24} color="#FFF" />
                </TouchableOpacity>
                <Txt variant="headingM" weight="heavy" color="#FFF" style={s.title}>Engagement History</Txt>
            </View>

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
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, marginBottom: 20 },
    backBtn: { width: 44, height: 44, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' },
    title: { marginLeft: 16 },

    list: { paddingHorizontal: 20 },
    card: { backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 32, padding: 24, marginBottom: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)', overflow: 'hidden' },
    cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },

    route: { flexDirection: 'row', marginBottom: 24 },
    routeLineWrap: { width: 24, alignItems: 'center', paddingVertical: 4 },
    marker: { width: 10, height: 10, borderRadius: 5 },
    line: { width: 2, flex: 1, backgroundColor: 'rgba(255,255,255,0.05)', marginVertical: 6 },
    addressWrap: { flex: 1, marginLeft: 16 },

    cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 20, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.05)' },
    statusPill: { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 16 },

    center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    empty: { marginTop: 100, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.02)', padding: 40, borderRadius: 40 },
});
