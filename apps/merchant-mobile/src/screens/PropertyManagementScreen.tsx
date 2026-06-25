import React, { useState, useEffect, useCallback } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity, ScrollView,
    TextInput, Alert, ActivityIndicator, RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { initializeSupabaseClient } from '@gtaxi/core';
import { useAuth } from '../context/AuthContext';
import { SURFACE, VOICES } from '@gtaxi/design-system';
import { glassSurface, ghostBorder } from '@gtaxi/design-system/utils/style-rules';

const { supabase } = initializeSupabaseClient('native');

function fmtDate(iso: string) {
    return new Date(iso).toLocaleDateString('en-TT', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function PropertyManagementScreen({ navigation }: any) {
    const insets = useSafeAreaInsets();
    const { user } = useAuth();

    const [property, setProperty] = useState<any>(null);
    const [availability, setAvailability] = useState<Record<string, Record<string, boolean>>>({});
    const [bookings, setBookings] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [refreshing, setRefreshing] = useState(false);

    const [icalEditing, setIcalEditing] = useState(false);
    const [icalInputs, setIcalInputs] = useState<Record<string, string>>({});
    const [savingIcal, setSavingIcal] = useState(false);

    const load = useCallback(async (silent = false) => {
        if (!silent) setLoading(true);
        if (!user) { setLoading(false); return; }

        const { data: merchant } = await supabase
            .from('merchants')
            .select('id')
            .eq('created_by', user.id)
            .maybeSingle();

        if (!merchant) { setLoading(false); return; }

        const { data: prop } = await supabase
            .from('travel_properties')
            .select('*')
            .eq('merchant_id', merchant.id)
            .maybeSingle();

        setProperty(prop);

        if (prop) {
            setIcalInputs(prop.ical_urls || {});

            const today = new Date().toISOString().slice(0, 10);
            const end = new Date(Date.now() + 30 * 86400 * 1000).toISOString().slice(0, 10);

            const { data: avail } = await supabase
                .from('property_availability')
                .select('date, room_type, is_available')
                .eq('property_id', prop.id)
                .gte('date', today)
                .lte('date', end)
                .order('date');

            const grouped: Record<string, Record<string, boolean>> = {};
            for (const row of avail || []) {
                if (!grouped[row.room_type]) grouped[row.room_type] = {};
                grouped[row.room_type][row.date] = row.is_available;
            }
            setAvailability(grouped);

            const { data: bkgs } = await supabase
                .from('travel_bookings')
                .select('id, traveler_count, total_cents, confirmed_at, travel_packages!inner(title, departure_at, property_id)')
                .eq('travel_packages.property_id', prop.id)
                .eq('status', 'confirmed')
                .order('created_at', { ascending: false })
                .limit(20);
            setBookings(bkgs || []);
        }

        setLoading(false);
        setRefreshing(false);
    }, [user]);

    useEffect(() => { load(); }, [load]);

    const syncIcal = async () => {
        if (!property) return;
        setSyncing(true);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        const { data, error } = await supabase.functions.invoke('travel', {
            body: { action: 'sync_ical', property_id: property.id },
        });
        setSyncing(false);
        if (error || data?.error) {
            Alert.alert('Sync Failed', error?.message || data?.error);
        } else {
            Alert.alert('Synced', `iCal sync complete. ${data.synced || 0} room type(s) updated.`);
            await load(true);
        }
    };

    const saveIcalUrls = async () => {
        if (!property) return;
        setSavingIcal(true);
        const { error } = await supabase
            .from('travel_properties')
            .update({ ical_urls: icalInputs, sync_status: 'pending' })
            .eq('id', property.id);
        setSavingIcal(false);
        if (error) {
            Alert.alert('Error', 'Could not save iCal URLs.');
        } else {
            setIcalEditing(false);
            setProperty((p: any) => ({ ...p, ical_urls: icalInputs }));
            Alert.alert('Saved', 'iCal URLs updated. Tap Sync to pull latest availability.');
        }
    };

    const register = async () => {
        if (!user) return;
        const { data: merchant } = await supabase.from('merchants').select('id').eq('created_by', user.id).maybeSingle();
        if (!merchant) {
            Alert.alert('No Merchant', 'You need a registered merchant account first.');
            return;
        }
        const name = await new Promise<string>(resolve => {
            Alert.prompt('Property Name', 'Enter the name of your property', [
                { text: 'Cancel', onPress: () => resolve(''), style: 'cancel' },
                { text: 'Next', onPress: v => resolve(v || '') },
            ]);
        });
        if (!name) return;
        const { error } = await supabase.from('travel_properties').insert({
            merchant_id: merchant.id,
            name,
            destination_code: 'TAB',
            destination_name: 'Tobago',
            is_active: true,
            sync_status: 'pending',
        });
        if (error) { Alert.alert('Error', error.message); return; }
        await load();
    };

    if (loading) {
        return (
            <View style={[styles.root, { paddingTop: insets.top, justifyContent: 'center', alignItems: 'center' }]}>
                <ActivityIndicator size="large" color={VOICES.merchant.accent} />
            </View>
        );
    }

    if (!property) {
        return (
            <View style={[styles.root, { paddingTop: insets.top }]}>
                <LinearGradient colors={[SURFACE.base, '#1C1510']} style={StyleSheet.absoluteFillObject} />
                <View style={styles.header}>
                    <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
                        <Ionicons name="chevron-back" size={22} color="#FFF" />
                    </TouchableOpacity>
                    <Text style={styles.headerTitle}>Property Management</Text>
                </View>
                <View style={styles.center}>
                    <Ionicons name="home-outline" size={48} color="rgba(255,255,255,0.15)" />
                    <Text style={styles.emptyTitle}>No property registered</Text>
                    <Text style={styles.emptySub}>Register your hotel or villa to join the Caribbean Escapes pipeline.</Text>
                    <TouchableOpacity style={styles.registerBtn} onPress={register}>
                        <Text style={styles.registerBtnText}>Register Property</Text>
                    </TouchableOpacity>
                </View>
            </View>
        );
    }

    const today = new Date().toISOString().slice(0, 10);
    const nextDates: string[] = [];
    for (let i = 0; i < 30; i++) {
        const d = new Date(Date.now() + i * 86400 * 1000);
        nextDates.push(d.toISOString().slice(0, 10));
    }

    const roomTypes = Object.keys(property.ical_urls || {});
    const allRoomTypes = roomTypes.length > 0 ? roomTypes : Object.keys(availability);

    return (
        <View style={[styles.root, { paddingTop: insets.top }]}>
            <LinearGradient colors={[SURFACE.base, '#1C1510']} style={StyleSheet.absoluteFillObject} />
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
                    <Ionicons name="chevron-back" size={22} color="#FFF" />
                </TouchableOpacity>
                <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={styles.headerTitle}>{property.name}</Text>
                    <Text style={styles.headerSub}>{property.destination_name} · {property.destination_code}</Text>
                </View>
                <View style={[styles.syncBadge, { backgroundColor: property.sync_status === 'synced' ? 'rgba(34,197,94,0.15)' : 'rgba(245,158,11,0.15)' }]}>
                    <Text style={{ color: property.sync_status === 'synced' ? '#22C55E' : '#F59E0B', fontSize: 11, fontWeight: '700' }}>
                        {property.sync_status}
                    </Text>
                </View>
            </View>

            <ScrollView
                contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(true); }} tintColor={VOICES.merchant.accent} />}
            >
                <View style={styles.section}>
                    <View style={styles.sectionRow}>
                        <Text style={styles.sectionTitle}>ICAL SYNC</Text>
                        <View style={{ flexDirection: 'row', gap: 8 }}>
                            <TouchableOpacity
                                onPress={() => setIcalEditing(e => !e)}
                                style={[styles.iconBtn, { backgroundColor: VOICES.merchant.accent + '18' }]}
                            >
                                <Ionicons name="pencil-outline" size={16} color={VOICES.merchant.accent} />
                            </TouchableOpacity>
                            <TouchableOpacity
                                onPress={syncIcal}
                                disabled={syncing}
                                style={[styles.syncBtn, syncing && { opacity: 0.5 }]}
                            >
                                {syncing
                                    ? <ActivityIndicator size="small" color="#FFF" />
                                    : <><Ionicons name="refresh" size={14} color="#FFF" /><Text style={styles.syncBtnText}>Sync Now</Text></>
                                }
                            </TouchableOpacity>
                        </View>
                    </View>

                    {property.last_sync_at && (
                        <Text style={styles.syncTime}>Last synced {fmtDate(property.last_sync_at)}</Text>
                    )}

                    {icalEditing && (
                        <View style={[styles.icalCard, glassSurface(0.15), ghostBorder(0.12)]}>
                            <Text style={styles.icalHint}>Paste your Airbnb or Vrbo iCal URL for each room type. Find it in your listing calendar settings.</Text>
                            {allRoomTypes.length === 0 && (
                                <TextInput
                                    style={styles.icalInput}
                                    placeholder="Room type (e.g. double)"
                                    placeholderTextColor="rgba(255,255,255,0.2)"
                                    onChangeText={v => setIcalInputs({ standard: v })}
                                />
                            )}
                            {allRoomTypes.map(rt => (
                                <View key={rt} style={{ marginBottom: 10 }}>
                                    <Text style={styles.roomLabel}>{rt}</Text>
                                    <TextInput
                                        style={styles.icalInput}
                                        value={icalInputs[rt] || ''}
                                        onChangeText={v => setIcalInputs(prev => ({ ...prev, [rt]: v }))}
                                        placeholder="https://www.airbnb.com/calendar/ical/..."
                                        placeholderTextColor="rgba(255,255,255,0.2)"
                                        autoCapitalize="none"
                                        keyboardType="url"
                                    />
                                </View>
                            ))}
                            <TouchableOpacity
                                onPress={saveIcalUrls}
                                disabled={savingIcal}
                                style={[styles.saveBtn, { backgroundColor: VOICES.merchant.accent }]}
                            >
                                {savingIcal
                                    ? <ActivityIndicator size="small" color="#000" />
                                    : <Text style={styles.saveBtnText}>Save iCal URLs</Text>
                                }
                            </TouchableOpacity>
                        </View>
                    )}
                </View>

                {allRoomTypes.length > 0 && (
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>30-DAY AVAILABILITY</Text>
                        {allRoomTypes.map(rt => (
                            <View key={rt} style={{ marginBottom: 16 }}>
                                <Text style={styles.roomLabel}>{rt}</Text>
                                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                                    <View style={{ flexDirection: 'row', gap: 4, paddingVertical: 8 }}>
                                        {nextDates.map(date => {
                                            const avail = availability[rt]?.[date];
                                            const isToday = date === today;
                                            return (
                                                <View key={date} style={[
                                                    styles.dayCell,
                                                    { backgroundColor: avail === true ? '#22C55E22' : avail === false ? '#EF444422' : 'rgba(255,255,255,0.04)' },
                                                    isToday && { borderColor: VOICES.merchant.accent, borderWidth: 1 },
                                                ]}>
                                                    <Text style={styles.dayNum}>{new Date(date).getDate()}</Text>
                                                    <Text style={styles.dayMon}>{new Date(date).toLocaleDateString('en', { month: 'short' }).slice(0, 3)}</Text>
                                                    {avail === true && <View style={styles.dotGreen} />}
                                                    {avail === false && <View style={styles.dotRed} />}
                                                </View>
                                            );
                                        })}
                                    </View>
                                </ScrollView>
                            </View>
                        ))}
                        <View style={styles.legend}>
                            <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: '#22C55E' }]} /><Text style={styles.legendText}>Available</Text></View>
                            <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: '#EF4444' }]} /><Text style={styles.legendText}>Booked</Text></View>
                            <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: 'rgba(255,255,255,0.2)' }]} /><Text style={styles.legendText}>Unknown</Text></View>
                        </View>
                    </View>
                )}

                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>TRAVEL PACKAGE BOOKINGS</Text>
                    {bookings.length === 0 ? (
                        <Text style={[styles.emptySub, { textAlign: 'center' }]}>No package bookings yet. Your rooms appear in packages once supply is synced.</Text>
                    ) : (
                        bookings.map(b => {
                            const pkg = (b as any).travel_packages;
                            return (
                                <View key={b.id} style={[styles.bookingRow, glassSurface(0.1)]}>
                                    <View style={{ flex: 1 }}>
                                        <Text style={styles.bookingTitle}>{pkg?.title || 'Package booking'}</Text>
                                        <Text style={styles.bookingMeta}>{b.traveler_count} guest{b.traveler_count > 1 ? 's' : ''} · {pkg?.departure_at ? fmtDate(pkg.departure_at) : ''}</Text>
                                    </View>
                                    <Text style={[styles.bookingAmt, { color: VOICES.merchant.accent }]}>TTD ${(b.total_cents / 100).toFixed(0)}</Text>
                                </View>
                            );
                        })
                    )}
                </View>
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: SURFACE.base },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 14, gap: 8 },
    backBtn: { width: 40, height: 40, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' },
    headerTitle: { color: '#FFF', fontWeight: '800', fontSize: 17, fontFamily: 'SpaceGrotesk' },
    headerSub: { color: VOICES.merchant.textMuted, fontSize: 12, fontFamily: 'Manrope' },
    syncBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 99 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 40 },
    emptyTitle: { color: '#FFF', fontWeight: '700', fontSize: 18, textAlign: 'center', fontFamily: 'SpaceGrotesk' },
    emptySub: { color: VOICES.merchant.textMuted, fontSize: 13, lineHeight: 19, textAlign: 'center', fontFamily: 'Manrope' },
    registerBtn: { backgroundColor: VOICES.merchant.accent, borderRadius: 18, paddingHorizontal: 24, paddingVertical: 13 },
    registerBtnText: { color: '#FFF', fontWeight: '700', fontFamily: 'SpaceGrotesk' },
    scroll: { paddingTop: 8, paddingHorizontal: 20, gap: 28 },
    section: { gap: 8 },
    sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    sectionTitle: { color: 'rgba(255,255,255,0.3)', fontWeight: '700', fontSize: 11, letterSpacing: 2, fontFamily: 'SpaceGrotesk' },
    syncTime: { color: 'rgba(255,255,255,0.3)', fontSize: 12, fontFamily: 'Manrope' },
    iconBtn: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
    syncBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: VOICES.merchant.accent, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8 },
    syncBtnText: { color: '#FFF', fontWeight: '700', fontSize: 12, fontFamily: 'SpaceGrotesk' },
    icalCard: { borderRadius: 18, padding: 16, gap: 4 },
    icalHint: { color: VOICES.merchant.textMuted, fontSize: 12, lineHeight: 18, marginBottom: 10, fontFamily: 'Manrope' },
    icalInput: { backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, color: '#FFF', fontSize: 13, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', fontFamily: 'Manrope' },
    roomLabel: { color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: '600', textTransform: 'capitalize', marginBottom: 4, fontFamily: 'Manrope' },
    saveBtn: { borderRadius: 14, paddingVertical: 12, alignItems: 'center', marginTop: 8 },
    saveBtnText: { color: '#000', fontWeight: '700', fontFamily: 'SpaceGrotesk' },
    dayCell: { width: 40, height: 52, borderRadius: 10, alignItems: 'center', justifyContent: 'center', gap: 2 },
    dayNum: { color: '#FFF', fontWeight: '700', fontSize: 13, fontFamily: 'SpaceGrotesk' },
    dayMon: { color: 'rgba(255,255,255,0.35)', fontSize: 9, fontFamily: 'Manrope' },
    dotGreen: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#22C55E' },
    dotRed: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#EF4444' },
    legend: { flexDirection: 'row', gap: 16, marginTop: 4 },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    legendDot: { width: 8, height: 8, borderRadius: 4 },
    legendText: { color: 'rgba(255,255,255,0.35)', fontSize: 11, fontFamily: 'Manrope' },
    bookingRow: { flexDirection: 'row', alignItems: 'center', borderRadius: 14, padding: 14 },
    bookingTitle: { color: '#FFF', fontWeight: '600', fontSize: 14, fontFamily: 'SpaceGrotesk' },
    bookingMeta: { color: VOICES.merchant.textMuted, fontSize: 12, marginTop: 2, fontFamily: 'Manrope' },
    bookingAmt: { fontWeight: '700', fontSize: 15, fontFamily: 'SpaceGrotesk' },
});
