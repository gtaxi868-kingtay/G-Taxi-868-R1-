import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Alert, RefreshControl } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { initializeSupabaseClient } from '@gtaxi/core';
import { SURFACE, VOICES } from '@gtaxi/design-system';
import { glassSurface, ghostBorder } from '@gtaxi/design-system/utils/style-rules';
import { useAuth } from '../context/AuthContext';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { AppStackParamList } from '../navigation/types';

const { supabase } = initializeSupabaseClient('native');

interface AppointmentRow {
    id: string;
    scheduled_at: string;
    status: 'pending' | 'confirmed' | 'completed' | 'cancelled';
    merchant_consent_status: 'pending' | 'granted' | 'denied';
    ride_requested: boolean;
    service_name: string;
    rider_name: string;
}

const STATUS_META: Record<string, { label: string; color: string; icon: string }> = {
    pending:     { label: 'Awaiting Approval', color: '#F59E0B', icon: 'time-outline' },
    confirmed:   { label: 'Confirmed',         color: '#10B981', icon: 'checkmark-circle-outline' },
    completed:   { label: 'Completed',         color: '#6B7280', icon: 'checkmark-done-outline' },
    cancelled:   { label: 'Cancelled',         color: '#EF4444', icon: 'close-circle-outline' },
};

function fmtTime(iso: string) {
    const d = new Date(iso);
    return d.toLocaleDateString('en-TT', {
        weekday: 'short', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });
}

export function AppointmentsScreen({ navigation }: { navigation: NativeStackNavigationProp<AppStackParamList> }) {
    const insets = useSafeAreaInsets();
    const { user } = useAuth();
    const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [filter, setFilter] = useState<'all' | 'pending' | 'confirmed' | 'completed'>('all');

    const loadMerchantId = useCallback(async (): Promise<string | null> => {
        if (!user) return null;
        const { data: merchant } = await supabase
            .from('merchants').select('id').eq('created_by', user.id).maybeSingle();
        if (merchant?.id) return merchant.id;
        const { data: staff } = await supabase
            .from('merchant_staff').select('merchant_id').eq('user_id', user.id).maybeSingle();
        return staff?.merchant_id || null;
    }, [user]);

    const loadAppointments = useCallback(async () => {
        if (!user) return;
        const merchantId = await loadMerchantId();
        if (!merchantId) { setLoading(false); return; }

        const { data, error } = await supabase
            .from('merchant_appointments')
            .select(`
                id, scheduled_at, status, merchant_consent_status, ride_requested,
                service:service_id(name),
                rider:rider_id(full_name)
            `)
            .eq('merchant_id', merchantId)
            .order('scheduled_at', { ascending: false });

        if (error) {
            console.warn('[Appointments] Failed to load:', error.message);
            return;
        }

        const rows: AppointmentRow[] = (data || []).map((a: any) => ({
            id: a.id,
            scheduled_at: a.scheduled_at,
            status: a.status,
            merchant_consent_status: a.merchant_consent_status,
            ride_requested: a.ride_requested,
            service_name: a.service?.name || 'Unknown Service',
            rider_name: a.rider?.full_name || 'Unknown Rider',
        }));
        setAppointments(rows);
        setLoading(false);
    }, [user, loadMerchantId]);

    useEffect(() => { loadAppointments(); }, [loadAppointments]);

    const onRefresh = async () => {
        setRefreshing(true);
        await loadAppointments();
        setRefreshing(false);
    };

    const updateStatus = async (appointmentId: string, status: string, consentStatus: string) => {
        setActionLoading(appointmentId);
        const { error } = await supabase
            .from('merchant_appointments')
            .update({ status, merchant_consent_status: consentStatus })
            .eq('id', appointmentId);
        if (error) {
            Alert.alert('Error', error.message);
        } else {
            await loadAppointments();
        }
        setActionLoading(null);
    };

    const visible = filter === 'all'
        ? appointments
        : appointments.filter(a => a.status === filter);

    const counts = {
        all: appointments.length,
        pending: appointments.filter(a => a.status === 'pending').length,
        confirmed: appointments.filter(a => a.status === 'confirmed').length,
        completed: appointments.filter(a => a.status === 'completed').length,
    };

    return (
        <View style={[s.container, { paddingTop: insets.top }]}>
            <LinearGradient colors={[SURFACE.base, '#1C1510']} style={StyleSheet.absoluteFillObject} />

            <View style={s.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
                    <Ionicons name="chevron-back" size={22} color="#FFFFFF" />
                </TouchableOpacity>
                <Text style={s.title}>Appointments</Text>
                <View style={{ width: 44 }} />
            </View>

            <View style={s.filterRow}>
                {(['all', 'pending', 'confirmed', 'completed'] as const).map(f => (
                    <TouchableOpacity
                        key={f}
                        onPress={() => setFilter(f)}
                        style={[s.filterChip, filter === f && s.filterChipActive]}
                    >
                        <Text style={[s.filterText, filter === f && s.filterTextActive]}>
                            {f === 'all' ? 'All' : STATUS_META[f].label} ({counts[f]})
                        </Text>
                    </TouchableOpacity>
                ))}
            </View>

            {loading ? (
                <View style={s.center}>
                    <ActivityIndicator size="large" color={VOICES.merchant.accent} />
                </View>
            ) : visible.length === 0 ? (
                <View style={s.center}>
                    <Ionicons name="calendar-outline" size={64} color="rgba(255,255,255,0.3)" />
                    <Text style={s.emptyText}>No appointments found</Text>
                </View>
            ) : (
                <ScrollView
                    contentContainerStyle={s.scrollContent}
                    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={VOICES.merchant.accent} />}
                >
                    {visible.map(a => {
                        const meta = STATUS_META[a.status];
                        return (
                            <View key={a.id} style={[s.card, glassSurface(0.15)]}>
                                <View style={s.cardHeader}>
                                    <View style={[s.statusDot, { backgroundColor: meta?.color || '#6B7280' }]} />
                                    <Text style={[s.statusText, { color: meta?.color || '#6B7280' }]}>
                                        {meta?.label || a.status}
                                    </Text>
                                </View>

                                <View style={s.cardBody}>
                                    <View style={s.infoRow}>
                                        <Ionicons name="person-outline" size={16} color="rgba(255,255,255,0.5)" />
                                        <Text style={s.infoText}>{a.rider_name}</Text>
                                    </View>
                                    <View style={s.infoRow}>
                                        <Ionicons name="cut-outline" size={16} color="rgba(255,255,255,0.5)" />
                                        <Text style={s.infoText}>{a.service_name}</Text>
                                    </View>
                                    <View style={s.infoRow}>
                                        <Ionicons name="calendar-outline" size={16} color="rgba(255,255,255,0.5)" />
                                        <Text style={s.infoText}>{fmtTime(a.scheduled_at)}</Text>
                                    </View>
                                    {a.ride_requested && (
                                        <View style={s.infoRow}>
                                            <Ionicons name="car-outline" size={16} color={VOICES.merchant.accent} />
                                            <Text style={[s.infoText, { color: VOICES.merchant.accent }]}>Ride requested</Text>
                                        </View>
                                    )}
                                </View>

                                {a.merchant_consent_status === 'pending' && a.status === 'pending' && (
                                    <View style={s.actionRow}>
                                        <TouchableOpacity
                                            style={[s.actionBtn, s.rejectBtn]}
                                            onPress={() => updateStatus(a.id, 'cancelled', 'denied')}
                                            disabled={actionLoading === a.id}
                                        >
                                            {actionLoading === a.id ? (
                                                <ActivityIndicator size="small" color="#EF4444" />
                                            ) : (
                                                <Text style={s.rejectBtnText}>Decline</Text>
                                            )}
                                        </TouchableOpacity>
                                        <TouchableOpacity
                                            style={[s.actionBtn, s.approveBtn]}
                                            onPress={() => updateStatus(a.id, 'confirmed', 'granted')}
                                            disabled={actionLoading === a.id}
                                        >
                                            {actionLoading === a.id ? (
                                                <ActivityIndicator size="small" color="#000" />
                                            ) : (
                                                <Text style={s.approveBtnText}>Approve</Text>
                                            )}
                                        </TouchableOpacity>
                                    </View>
                                )}

                                {a.status === 'confirmed' && (
                                    <TouchableOpacity
                                        style={[s.actionBtn, s.completeBtn]}
                                        onPress={() => updateStatus(a.id, 'completed', 'granted')}
                                        disabled={actionLoading === a.id}
                                    >
                                        {actionLoading === a.id ? (
                                            <ActivityIndicator size="small" color="#000" />
                                        ) : (
                                            <Text style={s.approveBtnText}>Mark Completed</Text>
                                        )}
                                    </TouchableOpacity>
                                )}
                            </View>
                        );
                    })}
                </ScrollView>
            )}
        </View>
    );
}

const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: SURFACE.base },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14 },
    backBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.06)', justifyContent: 'center', alignItems: 'center' },
    title: { fontSize: 18, fontWeight: '700', color: '#FFFFFF', fontFamily: 'SpaceGrotesk' },
    filterRow: { flexDirection: 'row', paddingHorizontal: 16, gap: 8, marginBottom: 12 },
    filterChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
    filterChipActive: { backgroundColor: VOICES.merchant.accent + '26', borderColor: VOICES.merchant.accent },
    filterText: { fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.6)', fontFamily: 'Manrope' },
    filterTextActive: { color: VOICES.merchant.accent, fontWeight: '700' },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    emptyText: { fontSize: 16, color: 'rgba(255,255,255,0.4)', marginTop: 16, fontFamily: 'Manrope' },
    scrollContent: { padding: 16, paddingBottom: 48 },
    card: { borderRadius: 20, padding: 20, marginBottom: 16 },
    cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
    statusDot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
    statusText: { fontSize: 12, fontWeight: '700', fontFamily: 'SpaceGrotesk', textTransform: 'uppercase', letterSpacing: 0.5 },
    cardBody: { gap: 10 },
    infoRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    infoText: { fontSize: 15, color: '#FFFFFF', fontFamily: 'Manrope', flex: 1 },
    actionRow: { flexDirection: 'row', gap: 12, marginTop: 20 },
    actionBtn: { flex: 1, borderRadius: 14, paddingVertical: 14, alignItems: 'center', justifyContent: 'center' },
    approveBtn: { backgroundColor: VOICES.merchant.accent },
    approveBtnText: { fontSize: 15, fontWeight: '700', color: '#000', fontFamily: 'SpaceGrotesk' },
    rejectBtn: { backgroundColor: 'rgba(239,68,68,0.15)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)' },
    rejectBtnText: { fontSize: 15, fontWeight: '700', color: '#EF4444', fontFamily: 'SpaceGrotesk' },
    completeBtn: { backgroundColor: VOICES.merchant.accent, marginTop: 20 },
});