import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, RefreshControl, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CrystalFace, RaisedIcon } from '@gtaxi/design-system-native/src/crystal';
import { initializeSupabaseClient } from '@gtaxi/core';
import { SURFACE, VOICES } from '@gtaxi/design-system';
import { useMerchant } from '../context/MerchantContext';
import { BusinessTypePicker } from '../components/BusinessTypePicker';
import { CRYSTAL } from '../ui/kit';

const { supabase } = initializeSupabaseClient('native');
const V = VOICES.merchant;

type ShelfItem = { id: string; name: string; price_cents: number; image_url: string | null; is_available: boolean };
type Today = { waiting: number; salesCents: number; earningsCents: number; items: number | null; ordersWeek: number; busiestHour: number | null };

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? 'am' : 'pm'}`;

// The home page is the business's own storefront: the face customers see, the
// switch that opens it, and only what needs doing today.
export function HomeScreen({ navigation }: { navigation: { navigate: (route: string) => void } }) {
    const insets = useSafeAreaInsets();
    const { merchant, type, isOwner, loading, failed, reload, setOpen } = useMerchant();
    const [today, setToday] = useState<Today | null>(null);
    const [shelf, setShelf] = useState<ShelfItem[]>([]);
    const [refreshing, setRefreshing] = useState(false);

    const loadToday = useCallback(async () => {
        if (!merchant) return;
        const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
        const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
        const [week, commissions, products, appointments, shelfRows] = await Promise.all([
            supabase.from('merchant_orders').select('status, total_cents, created_at').eq('merchant_id', merchant.id).gte('created_at', weekAgo),
            supabase.from('vendor_commissions').select('commission_cents').eq('merchant_id', merchant.id).eq('status', 'pending'),
            supabase.from('products').select('id', { count: 'exact', head: true }).eq('merchant_id', merchant.id),
            type?.work.route === 'Appointments'
                ? supabase.from('merchant_appointments').select('id', { count: 'exact', head: true }).eq('merchant_id', merchant.id).gte('scheduled_at', dayStart.toISOString())
                : Promise.resolve({ count: null }),
            supabase.from('products').select('id, name, price_cents, image_url, is_available').eq('merchant_id', merchant.id).order('sort_order', { ascending: true }).limit(8),
        ]);
        setShelf((shelfRows.data ?? []) as ShelfItem[]);
        const rows = (week.data ?? []) as { status: string; total_cents: number | null; created_at: string }[];
        const hours: Record<number, number> = {};
        rows.forEach((o) => { const h = new Date(o.created_at).getHours(); hours[h] = (hours[h] || 0) + 1; });
        const busiest = Object.entries(hours).sort((a, b) => b[1] - a[1])[0];
        setToday({
            waiting: appointments.count ?? rows.filter((o) => o.status === 'pending' || o.status === 'confirmed').length,
            salesCents: rows.filter((o) => o.status === 'delivered' && new Date(o.created_at) >= dayStart).reduce((n, o) => n + (o.total_cents ?? 0), 0),
            earningsCents: ((commissions.data ?? []) as { commission_cents: number | null }[]).reduce((n, c) => n + (c.commission_cents ?? 0), 0),
            items: products.count ?? null,
            ordersWeek: rows.length,
            busiestHour: busiest ? Number(busiest[0]) : null,
        });
    }, [merchant?.id, type?.work.route]);

    useEffect(() => { loadToday(); }, [loadToday]);

    const refresh = async () => {
        setRefreshing(true);
        await reload();
        await loadToday();
        setRefreshing(false);
    };

    const toggleOpen = async (open: boolean) => {
        const ok = await setOpen(open);
        if (!ok) Alert.alert('Could not update', 'Check your connection and try again.');
    };

    if (loading) {
        return <View style={s.center}><ActivityIndicator size="large" color={V.accent} /></View>;
    }
    if (!merchant) {
        return (
            <View style={s.center}>
                <Ionicons name="storefront-outline" size={44} color={V.textMuted} />
                <Text style={s.emptyTitle}>{failed ? 'Could not load your business' : 'No business on this account yet'}</Text>
                <TouchableOpacity style={s.retry} onPress={refresh} accessibilityRole="button">
                    <Text style={s.retryText}>Try again</Text>
                </TouchableOpacity>
            </View>
        );
    }

    const live = merchant.activation_status === 'active' && merchant.is_active !== false;
    const open = merchant.is_open === true;
    const heroIcon = type?.icon ?? 'storefront-outline';

    return (
        <ScrollView style={s.root} contentContainerStyle={{ paddingBottom: 28 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={V.accent} />}>
            <View style={[s.hero, { paddingTop: insets.top + 18 }]}>
                {merchant.cover_image_url ? (
                    <Image source={{ uri: merchant.cover_image_url }} style={StyleSheet.absoluteFillObject} accessibilityIgnoresInvertColors />
                ) : (
                    <View style={StyleSheet.absoluteFillObject}><CrystalFace color={V.accentDark} radius={0} /></View>
                )}
                <LinearGradient colors={['rgba(7,12,11,0.1)', 'rgba(7,12,11,0.92)']} style={StyleSheet.absoluteFillObject} />
                <View style={s.badge}><RaisedIcon name={heroIcon} size={24} /></View>
                <Text style={s.name} numberOfLines={2}>{merchant.name}</Text>
                <Text style={s.sub} numberOfLines={1}>{[type?.label, merchant.address].filter(Boolean).join(' · ') || 'Your storefront'}</Text>
            </View>

            <View style={s.body}>
                {!live && (
                    <View style={s.notice}>
                        <Ionicons name="time-outline" size={18} color={V.copperBright} />
                        <Text style={s.noticeText}>G 868 is reviewing your business. Customers will see it once you are approved.</Text>
                    </View>
                )}

                <View style={s.openRow}>
                    <View style={[s.dot, { backgroundColor: open ? V.accent : V.textMuted }]} />
                    <View style={{ flex: 1 }}>
                        <Text style={s.openTitle}>{open ? 'Open now' : 'Closed'}</Text>
                        <Text style={s.openSub}>{open ? 'Customers can reach you' : 'Customers see you as closed'}</Text>
                    </View>
                    <Switch value={open} onValueChange={toggleOpen} trackColor={{ true: V.accentDark, false: 'rgba(233,245,243,0.18)' }} thumbColor={open ? V.accent : '#E9F5F3'} accessibilityLabel="Open or close your storefront" />
                </View>

                {!type ? (
                    isOwner ? <BusinessTypePicker /> : <Text style={s.openSub}>Ask the owner to choose your business type.</Text>
                ) : (
                    <>
                        <TouchableOpacity style={s.primary} onPress={() => navigation.navigate('Work')} accessibilityRole="button" accessibilityLabel={`Open ${type.work.label}`}>
                            <CrystalFace color={CRYSTAL} radius={22} />
                            <RaisedIcon name={type.work.icon} size={26} />
                            <View style={{ flex: 1, marginLeft: 14 }}>
                                <Text style={s.primaryTitle}>{today && today.waiting > 0 ? `${today.waiting} ${type.work.label.toLowerCase()}` : type.work.empty}</Text>
                                <Text style={s.primarySub}>Open {type.work.label}</Text>
                            </View>
                            <RaisedIcon name="chevron-forward" size={20} />
                        </TouchableOpacity>

                        <View style={s.stats}>
                            <View style={s.stat}>
                                <Text style={s.statValue}>{money(today?.salesCents ?? 0)}</Text>
                                <Text style={s.statLabel}>Sales today</Text>
                            </View>
                            <View style={s.stat}>
                                <Text style={s.statValue}>{money(today?.earningsCents ?? 0)}</Text>
                                <Text style={s.statLabel}>Pending earnings</Text>
                            </View>
                        </View>

                        {type.catalog && shelf.length > 0 && (
                            <View>
                                <View style={s.shelfHead}>
                                    <Text style={s.shelfTitle}>Your {type.catalog.label.toLowerCase()}</Text>
                                    <TouchableOpacity onPress={() => navigation.navigate('Catalog')} accessibilityRole="button" accessibilityLabel={`See all ${type.catalog.label}`}>
                                        <Text style={s.shelfAll}>See all</Text>
                                    </TouchableOpacity>
                                </View>
                                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.shelf}>
                                    {shelf.map((p) => (
                                        <TouchableOpacity key={p.id} style={[s.shelfCard, !p.is_available && { opacity: 0.5 }]} onPress={() => navigation.navigate('Catalog')} accessibilityRole="button" accessibilityLabel={p.name}>
                                            {p.image_url ? <Image source={{ uri: p.image_url }} style={s.shelfPhoto} accessibilityIgnoresInvertColors /> : (
                                                <View style={[s.shelfPhoto, s.shelfBlank]}><Ionicons name="image-outline" size={22} color={V.textMuted} /></View>
                                            )}
                                            <Text style={s.shelfName} numberOfLines={1}>{p.name}</Text>
                                            <Text style={s.shelfPrice}>{money(p.price_cents)}</Text>
                                        </TouchableOpacity>
                                    ))}
                                </ScrollView>
                            </View>
                        )}

                        {type.catalog && today?.items === 0 && (
                            <TouchableOpacity style={s.task} onPress={() => navigation.navigate('Catalog')} accessibilityRole="button">
                                <Ionicons name="add-circle-outline" size={22} color={V.copperBright} />
                                <View style={{ flex: 1, marginLeft: 12 }}>
                                    <Text style={s.taskTitle}>{type.catalog.addLabel}</Text>
                                    <Text style={s.taskSub}>Your {type.catalog.label.toLowerCase()} is empty, so customers have nothing to choose yet.</Text>
                                </View>
                            </TouchableOpacity>
                        )}

                        {today && today.ordersWeek > 0 && (
                            <View style={s.insight}>
                                <Ionicons name="sparkles" size={16} color={V.accent} />
                                <Text style={s.insightText}>
                                    {today.ordersWeek} order{today.ordersWeek === 1 ? '' : 's'} this week
                                    {today.busiestHour !== null ? `. Busiest around ${hourLabel(today.busiestHour)}.` : '.'}
                                </Text>
                            </View>
                        )}
                    </>
                )}
            </View>
        </ScrollView>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: SURFACE.base },
    center: { flex: 1, backgroundColor: SURFACE.base, alignItems: 'center', justifyContent: 'center', padding: 32 },
    emptyTitle: { marginTop: 14, fontSize: 17, fontWeight: '700', color: V.text, textAlign: 'center' },
    retry: { marginTop: 16, paddingHorizontal: 22, paddingVertical: 12, borderRadius: 16, backgroundColor: 'rgba(45,212,191,0.14)' },
    retryText: { color: V.accent, fontWeight: '700' },
    hero: { minHeight: 240, paddingHorizontal: 22, paddingBottom: 22, justifyContent: 'flex-end', overflow: 'hidden' },
    badge: { width: 48, height: 48, borderRadius: 16, marginBottom: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(7,12,11,0.45)', borderWidth: 1, borderColor: 'rgba(233,245,243,0.2)' },
    name: { fontFamily: V.serifSemi, fontSize: 34, lineHeight: 39, color: '#FFFFFF' },
    sub: { marginTop: 4, fontSize: 14, color: 'rgba(233,245,243,0.8)' },
    body: { paddingHorizontal: 18, paddingTop: 16, gap: 12 },
    notice: { flexDirection: 'row', gap: 10, padding: 14, borderRadius: 18, backgroundColor: 'rgba(192,133,82,0.14)' },
    noticeText: { flex: 1, fontSize: 13, lineHeight: 19, color: V.text },
    openRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 20, backgroundColor: V.surface, borderWidth: 1, borderColor: 'rgba(233,245,243,0.08)' },
    dot: { width: 10, height: 10, borderRadius: 5 },
    openTitle: { fontSize: 16, fontWeight: '700', color: V.text },
    openSub: { marginTop: 2, fontSize: 13, color: V.textMuted },
    primary: { flexDirection: 'row', alignItems: 'center', minHeight: 84, padding: 18, borderRadius: 22, overflow: 'hidden' },
    primaryTitle: { fontSize: 18, fontWeight: '800', color: '#FFFFFF' },
    primarySub: { marginTop: 2, fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.85)' },
    stats: { flexDirection: 'row', gap: 12 },
    stat: { flex: 1, padding: 16, borderRadius: 20, backgroundColor: V.surface, borderWidth: 1, borderColor: 'rgba(233,245,243,0.08)' },
    statValue: { fontSize: 22, fontWeight: '800', color: V.text },
    statLabel: { marginTop: 3, fontSize: 12, color: V.textMuted },
    shelfHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 4, marginBottom: 8 },
    shelfTitle: { fontSize: 17, fontWeight: '700', color: V.text },
    shelfAll: { fontSize: 14, fontWeight: '600', color: V.accent },
    shelf: { gap: 10, paddingRight: 18 },
    shelfCard: { width: 128 },
    shelfPhoto: { width: 128, height: 128, borderRadius: 16 },
    shelfBlank: { alignItems: 'center', justifyContent: 'center', backgroundColor: V.surface },
    shelfName: { marginTop: 6, fontSize: 13.5, fontWeight: '600', color: V.text },
    shelfPrice: { marginTop: 1, fontSize: 13.5, fontWeight: '800', color: V.text },
    task: { flexDirection: 'row', alignItems: 'center', padding: 16, borderRadius: 20, backgroundColor: 'rgba(192,133,82,0.12)' },
    taskTitle: { fontSize: 15, fontWeight: '700', color: V.text },
    taskSub: { marginTop: 2, fontSize: 13, lineHeight: 18, color: V.textMuted },
    insight: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 6 },
    insightText: { flex: 1, fontSize: 13, color: V.textMuted },
});
