import React, { useState, useEffect, useCallback } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity, FlatList,
    ActivityIndicator, Alert, RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@gtaxi/core';
import { useAuth } from '../context/AuthContext';
import type { AppScreenProps } from '../navigation/types';

function fmtPrice(cents: number) {
    return `TTD $${(cents / 100).toLocaleString('en-TT', { minimumFractionDigits: 0 })}`;
}
function fmtDate(iso: string) {
    return new Date(iso).toLocaleDateString('en-TT', { day: 'numeric', month: 'short', year: 'numeric' });
}

const STATUS_COLORS: Record<string, string> = {
    confirmed: '#22C55E',
    pending: '#F59E0B',
    cancelled: '#EF4444',
    completed: '#6B7280',
};

export function TravelMyBookingsScreen({ navigation }: AppScreenProps<'TravelMyBookings'>) {
    const insets = useSafeAreaInsets();
    const { user } = useAuth();
    const [bookings, setBookings] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [cancelling, setCancelling] = useState<string | null>(null);

    const load = useCallback(async (silent = false) => {
        if (!silent) setLoading(true);
        if (!user) { setLoading(false); return; }
        const { data } = await supabase
            .from('travel_bookings')
            .select(`
                id, package_id, traveler_count, total_cents, status,
                payment_method, confirmed_at, created_at, special_requests,
                travel_packages(title, destination_name, destination_code, departure_at, cover_image_url)
            `)
            .eq('user_id', user.id)
            .order('created_at', { ascending: false });
        if (data) setBookings(data);
        setLoading(false);
        setRefreshing(false);
    }, [user]);

    useEffect(() => { load(); }, [load]);

    const handleCancel = (booking: any) => {
        const pkg = booking.travel_packages;
        if (!pkg) return;
        const departureMs = new Date(pkg.departure_at).getTime();
        const hoursUntil = (departureMs - Date.now()) / (1000 * 60 * 60);

        if (hoursUntil < 24) {
            Alert.alert('Cannot Cancel', 'Bookings within 24 hours of departure cannot be cancelled.');
            return;
        }

        Alert.alert(
            'Cancel Booking',
            `Cancel your trip to ${pkg.destination_name}? Your wallet will be refunded within 24 hours.`,
            [
                { text: 'Keep Booking', style: 'cancel' },
                {
                    text: 'Cancel Trip',
                    style: 'destructive',
                    onPress: async () => {
                        setCancelling(booking.id);
                        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                        const { error } = await supabase
                            .from('travel_bookings')
                            .update({ status: 'cancelled' })
                            .eq('id', booking.id);
                        if (error) {
                            Alert.alert('Error', 'Could not cancel. Please contact support.');
                        } else {
                            await load(true);
                        }
                        setCancelling(null);
                    },
                },
            ]
        );
    };

    const renderItem = ({ item }: { item: any }) => {
        const pkg = item.travel_packages;
        const statusColor = STATUS_COLORS[item.status] || '#6B7280';
        const isUpcoming = pkg && new Date(pkg.departure_at) > new Date() && item.status === 'confirmed';

        return (
            <View style={styles.card}>
                <View style={styles.cardHeader}>
                    <View style={{ flex: 1 }}>
                        <Text style={styles.cardTitle}>{pkg?.title || 'Caribbean Package'}</Text>
                        <Text style={styles.cardDest}>{pkg?.destination_name}</Text>
                    </View>
                    <View style={[styles.statusBadge, { backgroundColor: statusColor + '22', borderColor: statusColor + '44' }]}>
                        <Text style={[styles.statusText, { color: statusColor }]}>{item.status}</Text>
                    </View>
                </View>

                <View style={styles.cardDetails}>
                    <DetailRow icon="calendar-outline" value={pkg ? fmtDate(pkg.departure_at) : '—'} />
                    <DetailRow icon="people-outline" value={`${item.traveler_count} traveler${item.traveler_count > 1 ? 's' : ''}`} />
                    <DetailRow icon="wallet-outline" value={fmtPrice(item.total_cents)} />
                    <DetailRow icon="receipt-outline" value={item.id.slice(0, 8).toUpperCase()} />
                </View>

                {isUpcoming && (
                    <TouchableOpacity
                        style={styles.cancelBtn}
                        onPress={() => handleCancel(item)}
                        disabled={cancelling === item.id}
                    >
                        {cancelling === item.id
                            ? <ActivityIndicator size="small" color="#EF4444" />
                            : <Text style={styles.cancelBtnText}>Cancel Trip</Text>
                        }
                    </TouchableOpacity>
                )}
            </View>
        );
    };

    return (
        <View style={[styles.root, { paddingTop: insets.top }]}>
            <StatusBar style="light" />
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
                    <Ionicons name="chevron-back" size={24} color="#FFF" />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>My Bookings</Text>
            </View>

            {loading ? (
                <View style={styles.center}><ActivityIndicator size="large" color="#3B82F6" /></View>
            ) : bookings.length === 0 ? (
                <View style={styles.center}>
                    <Ionicons name="airplane-outline" size={48} color="rgba(255,255,255,0.2)" />
                    <Text style={styles.emptyTitle}>No bookings yet</Text>
                    <TouchableOpacity
                        style={styles.browseBtn}
                        onPress={() => navigation.replace('TravelStorefront')}
                    >
                        <Text style={styles.browseBtnText}>Browse Packages →</Text>
                    </TouchableOpacity>
                </View>
            ) : (
                <FlatList
                    data={bookings}
                    keyExtractor={i => i.id}
                    renderItem={renderItem}
                    contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 32 }]}
                    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(true); }} tintColor="#3B82F6" />}
                />
            )}
        </View>
    );
}

function DetailRow({ icon, value }: { icon: string; value: string }) {
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <Ionicons name={icon as any} size={14} color="rgba(255,255,255,0.35)" />
            <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13 }}>{value}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: '#0A0A0F' },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 16, gap: 12 },
    backBtn: { width: 44, height: 44, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' },
    headerTitle: { color: '#FFF', fontWeight: '800', fontSize: 20 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
    emptyTitle: { color: 'rgba(255,255,255,0.4)', fontSize: 16 },
    browseBtn: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 99, backgroundColor: 'rgba(59,130,246,0.15)', borderWidth: 1, borderColor: '#3B82F6' },
    browseBtnText: { color: '#3B82F6', fontWeight: '700' },
    list: { padding: 20, gap: 14 },
    card: { backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', overflow: 'hidden' },
    cardHeader: { flexDirection: 'row', alignItems: 'flex-start', padding: 18, paddingBottom: 12 },
    cardTitle: { color: '#FFF', fontWeight: '700', fontSize: 15 },
    cardDest: { color: 'rgba(255,255,255,0.4)', fontSize: 13, marginTop: 2 },
    statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 99, borderWidth: 1 },
    statusText: { fontWeight: '700', fontSize: 11, textTransform: 'capitalize' },
    cardDetails: { paddingHorizontal: 18, paddingBottom: 14 },
    cancelBtn: { borderTopWidth: 1, borderTopColor: 'rgba(239,68,68,0.15)', paddingVertical: 14, alignItems: 'center' },
    cancelBtnText: { color: '#EF4444', fontWeight: '600', fontSize: 14 },
});
