import React, { useEffect, useState } from 'react';
import {
    View, StyleSheet, FlatList, TouchableOpacity,
    ActivityIndicator, Dimensions, RefreshControl, Alert
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../../shared/supabase';
import { useAuth } from '../context/AuthContext';
import { Txt, GlassCard } from '../design-system';
import { tokens } from '../design-system/tokens';

const { width, height } = Dimensions.get('window');

export function TripsScreen({ navigation }: any) {
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
                        <Txt variant="caption" weight="bold" color={tokens.colors.text.secondary}>
                            {date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </Txt>
                        <Txt variant="headingM" weight="heavy" color={tokens.colors.primary.cyan}>
                            ${((item.total_fare_cents || 0) / 100).toFixed(2)}
                        </Txt>
                    </View>

                    <View style={s.route}>
                        <View style={s.routeLineWrap}>
                            <View style={[s.marker, { backgroundColor: tokens.colors.primary.purple }]} />
                            <View style={s.line} />
                            <View style={[s.marker, { backgroundColor: '#F59E0B' }]} />
                        </View>
                        <View style={s.addressWrap}>
                            <Txt variant="small" color={tokens.colors.text.primary} numberOfLines={1}>{item.pickup_address}</Txt>
                            <View style={{ height: 12 }} />
                            <Txt variant="small" color={tokens.colors.text.secondary} numberOfLines={1}>{item.dropoff_address}</Txt>
                        </View>
                    </View>

                    <View style={s.cardFooter}>
                        <View style={[s.statusPill, { backgroundColor: isCompleted ? 'rgba(16,185,129,0.1)' : isCancelled ? 'rgba(239,68,68,0.1)' : 'rgba(255,255,255,0.05)' }]}>
                            <Txt variant="caption" weight="heavy" color={isCompleted ? tokens.colors.status.success : isCancelled ? tokens.colors.status.error : tokens.colors.text.tertiary}>
                                {item.status.toUpperCase()}
                            </Txt>
                        </View>
                        <Ionicons name="chevron-forward" size={16} color={tokens.colors.text.tertiary} />
                    </View>
                </GlassCard>
            </TouchableOpacity>
        );
    };

    return (
        <View style={s.root}>
            <StatusBar style="light" />
            
            <LinearGradient 
                colors={[tokens.colors.background.base, tokens.colors.background.ambient, tokens.colors.background.base]} 
                style={StyleSheet.absoluteFillObject} 
            />

            <View style={[s.header, { paddingTop: insets.top + 10 }]}>
                <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()}>
                    <BlurView intensity={20} tint="light" style={StyleSheet.absoluteFillObject} />
                    <Ionicons name="chevron-back" size={24} color="#FFF" />
                </TouchableOpacity>
                <Txt variant="headingM" weight="heavy" color="#FFF" style={s.title}>ENGAGEMENT LOG</Txt>
            </View>

            {loading ? (
                <View style={s.center}><ActivityIndicator color={tokens.colors.primary.purple} /></View>
            ) : (
                <FlatList
                    data={trips}
                    keyExtractor={item => item.id}
                    renderItem={renderTrip}
                    contentContainerStyle={[s.list, { paddingBottom: insets.bottom + 40 }]}
                    refreshControl={
                        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={tokens.colors.primary.purple} colors={[tokens.colors.primary.purple]} />
                    }
                    ListEmptyComponent={
                        <View style={s.empty}>
                            <Ionicons name="car-outline" size={64} color={tokens.colors.text.tertiary} />
                            <Txt variant="bodyReg" color={tokens.colors.text.tertiary} style={{ marginTop: 16 }}>No sorties logged.</Txt>
                        </View>
                    }
                />
            )}
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: '#160B32' },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, marginBottom: 20 },
    backBtn: { width: 44, height: 44, borderRadius: 16, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
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
