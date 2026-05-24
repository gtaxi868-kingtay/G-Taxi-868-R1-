import React, { useEffect, useState } from 'react';
import {
    View, StyleSheet, FlatList, TouchableOpacity,
    ActivityIndicator, useWindowDimensions, RefreshControl, Alert
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@gtaxi/core';
import { useAuth } from '../context/AuthContext';
import { Txt } from '@/design-system/primitives';
import { SURFACE, VOICES, ANIMATION, GlassCard } from '@gtaxi/design-system';
import { ghostBorder, elevationGlow, glassSurface } from '@gtaxi/design-system/utils/style-rules';

const CYAN = '#06B6D4';

export function TripsScreen({ navigation }: any) {
    const { width, height } = useWindowDimensions();
    const { user } = useAuth();
    const insets = useSafeAreaInsets();

    const [trips, setTrips] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    useEffect(() => {
        if (user?.id) fetchTrips();
    }, [user?.id]);

    const fetchTrips = async () => {
        const { data, error } = await supabase
            .from('rides')
            .select('*')
            .eq('rider_id', user?.id)
            .order('created_at', { ascending: false });

        if (error) {
            Alert.alert("Notice", "We couldn't sync your recent trips. Swipe down to retry.");
        } else if (data) {
            setTrips(data);
        }
        setLoading(false);
        setRefreshing(false);
    };

    const onRefresh = () => {
        setRefreshing(true);
        fetchTrips();
    };

    const renderTrip = ({ item }: { item: any }) => {
        const date = new Date(item.created_at);
        const isCompleted = item.status === 'completed' || item.status === 'closed';
        const isCancelled = item.status === 'canceled' || item.status === 'cancelled';

        return (
            <TouchableOpacity
                onPress={() => { 
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); 
                    navigation.navigate('Receipt', { ride: item }); 
                }}
            >
                <GlassCard variant="rider" style={s.card}>
                    <View style={s.cardHeader}>
                        <Txt variant="caption" weight="bold" color="#AEA9B5">
                            {date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </Txt>
                        <Txt variant="headingM" weight="heavy" color={CYAN}>
                            ${((item.total_fare_cents || 0) / 100).toFixed(2)}
                        </Txt>
                    </View>

                    <View style={s.route}>
                        <View style={s.routeLineWrap}>
                            <View style={[s.marker, { backgroundColor: VOICES.rider.accent }]} />
                            <View style={s.line} />
                            <View style={[s.marker, { backgroundColor: '#F59E0B' }]} />
                        </View>
                        <View style={s.addressWrap}>
                            <Txt variant="small" color="#FFF" numberOfLines={1}>{item.pickup_address}</Txt>
                            <View style={{ height: 12 }} />
                            <Txt variant="small" color="#AEA9B5" numberOfLines={1}>{item.dropoff_address}</Txt>
                        </View>
                    </View>

                    <View style={s.cardFooter}>
                        <View style={[s.statusPill, { backgroundColor: isCompleted ? 'rgba(16,185,129,0.1)' : isCancelled ? 'rgba(239,68,68,0.1)' : 'rgba(255,255,255,0.05)' }]}>
                            <Txt variant="caption" weight="heavy" color={isCompleted ? '#32D74B' : isCancelled ? '#FF6E84' : 'rgba(174, 169, 181, 0.45)'}>
                                {item.status.toUpperCase()}
                            </Txt>
                        </View>
                        <Ionicons name="chevron-forward" size={16} color="rgba(174, 169, 181, 0.45)" />
                    </View>
                </GlassCard>
            </TouchableOpacity>
        );
    };

    return (
        <View style={s.root}>
            <StatusBar style="light" />
            
            <LinearGradient 
                colors={[SURFACE.base, '#1A1823', SURFACE.base]} 
                style={StyleSheet.absoluteFillObject} 
            />

            <View style={[s.header, { paddingTop: insets.top + 10 }]}>
                <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()}>
                    <View style={[StyleSheet.absoluteFillObject, glassSurface(20, 0.2)]} />
                    <Ionicons name="chevron-back" size={24} color="#FFF" />
                </TouchableOpacity>
                <Txt variant="headingM" weight="heavy" color="#FFF" style={s.title}>ENGAGEMENT LOG</Txt>
            </View>

            {loading ? (
                <View style={s.center}><ActivityIndicator color={VOICES.rider.accent} /></View>
            ) : (
                <FlatList<any>
                    data={trips}
                    keyExtractor={item => item.id}
                    renderItem={renderTrip}
                    contentContainerStyle={[s.list, { paddingBottom: insets.bottom + 40 }]}
                    refreshControl={
                        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={VOICES.rider.accent} colors={[VOICES.rider.accent]} />
                    }
                    ListEmptyComponent={
                        <View style={s.empty}>
                            <Ionicons name="car-outline" size={64} color="rgba(174, 169, 181, 0.45)" />
                            <Txt variant="bodyReg" color="rgba(174, 169, 181, 0.45)" style={{ marginTop: 16 }}>No sorties logged.</Txt>
                        </View>
                    }
                />
            )}
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: SURFACE.base },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, marginBottom: 20 },
    backBtn: { width: 44, height: 44, borderRadius: 16, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.05)', ...ghostBorder(0.15) },
    title: { marginLeft: 16, letterSpacing: 2 },

    list: { paddingHorizontal: 20 },
    card: { marginBottom: 16, padding: 20 },
    cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },

    route: { flexDirection: 'row', marginBottom: 20 },
    routeLineWrap: { width: 24, alignItems: 'center', paddingVertical: 4 },
    marker: { width: 8, height: 8, borderRadius: 4 },
    line: { width: 1, flex: 1, backgroundColor: 'rgba(255,255,255,0.1)', marginVertical: 4 },
    addressWrap: { flex: 1, marginLeft: 16 },

    cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 16, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.05)' },
    statusPill: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12 },

    center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    empty: { marginTop: 100, alignItems: 'center', padding: 40, borderRadius: 40 },
});
