import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, RefreshControl, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { initializeSupabaseClient } from '@gtaxi/core';
import { useMerchant } from '../context/MerchantContext';
import { BusinessTypePicker } from '../components/BusinessTypePicker';
import { GButton } from '../components/GButton';
import { Card, GoldKey } from '../ui/kit';
import { Mood, SERIF, type as T, useMood, useStyles } from '../ui/mood';

const { supabase } = initializeSupabaseClient('native');

type ShelfItem = { id: string; name: string; price_cents: number; image_url: string | null; is_available: boolean };
type Today = { waiting: number; salesCents: number; earningsCents: number; items: number | null; ordersWeek: number; busiestHour: number | null };

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? 'am' : 'pm'}`;

// The home page is the business's own storefront: the face customers see, the
// switch that opens it, and only what needs doing today.
export function HomeScreen({ navigation }: { navigation: { navigate: (route: string) => void } }) {
    const insets = useSafeAreaInsets();
    const m = useMood();
    const s = useStyles(makeStyles);
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
        return <View style={s.center}><ActivityIndicator size="large" color={m.gold} /></View>;
    }
    if (!merchant) {
        return (
            <View style={s.center}>
                <Ionicons name="storefront-outline" size={44} color={m.dim} />
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
        <View style={s.root}>
        <GButton />
        <ScrollView style={s.root} contentContainerStyle={{ paddingBottom: 28 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={m.gold} />}>
            <View style={[s.hero, { paddingTop: insets.top + 22 }]}>
                {merchant.cover_image_url ? (
                    <>
                        <Image source={{ uri: merchant.cover_image_url }} style={StyleSheet.absoluteFillObject} accessibilityIgnoresInvertColors />
                        <LinearGradient colors={['rgba(16,14,10,0.05)', 'rgba(16,14,10,0.82)']} style={StyleSheet.absoluteFillObject} />
                    </>
                ) : (
                    <>
                        <LinearGradient colors={m.pearl as [string, string, string]} style={StyleSheet.absoluteFillObject} />
                        <LinearGradient colors={m.sheen as [string, string, string]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0.8 }} style={StyleSheet.absoluteFillObject} />
                    </>
                )}
                <LinearGradient colors={m.goldFace as [string, string, string]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.badge}>
                    <Ionicons name={heroIcon} size={26} color={m.onGold} />
                </LinearGradient>
                <Text style={[s.name, { color: merchant.cover_image_url ? '#FFF8E8' : m.onPearl }]} numberOfLines={2}>{merchant.name}</Text>
                <Text style={[T.body, { color: merchant.cover_image_url ? 'rgba(255,248,232,0.85)' : m.onPearlDim }]} numberOfLines={1}>{[type?.label, merchant.address].filter(Boolean).join(' · ') || 'Your storefront'}</Text>
            </View>

            <View style={s.body}>
                {!live && (
                    <View style={s.notice}>
                        <Ionicons name="time-outline" size={18} color={m.gold} />
                        <Text style={s.noticeText}>G 868 is reviewing your business. Customers will see it once you are approved.</Text>
                    </View>
                )}

                <Card style={s.openRow}>
                    <View style={[s.dot, { backgroundColor: open ? m.gold : m.dim }]} />
                    <View style={{ flex: 1 }}>
                        <Text style={s.openTitle}>{open ? 'Open now' : 'Closed'}</Text>
                        <Text style={s.openSub}>{open ? 'Customers can reach you' : 'Customers see you as closed'}</Text>
                    </View>
                    <Switch value={open} onValueChange={toggleOpen} trackColor={{ true: m.goldLip, false: m.line }} thumbColor={open ? m.goldFace[1] : m.dim} accessibilityLabel="Open or close your storefront" />
                </Card>

                {!type ? (
                    isOwner ? <BusinessTypePicker /> : <Text style={s.openSub}>Ask the owner to choose your business type.</Text>
                ) : (
                    <>
                        <GoldKey
                            icon={type.work.icon}
                            label={today && today.waiting > 0 ? `${today.waiting} ${type.work.label.toLowerCase()}` : type.work.empty}
                            sub={`Open ${type.work.label}`}
                            trailing="chevron-forward"
                            onPress={() => navigation.navigate('Work')}
                        />

                        <View style={s.stats}>
                            <Card style={s.stat}>
                                <Text style={s.statValue}>{money(today?.salesCents ?? 0)}</Text>
                                <Text style={s.statLabel}>Sales today</Text>
                            </Card>
                            <Card style={s.stat}>
                                <Text style={s.statValue}>{money(today?.earningsCents ?? 0)}</Text>
                                <Text style={s.statLabel}>Pending earnings</Text>
                            </Card>
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
                                                <View style={[s.shelfPhoto, s.shelfBlank]}><Ionicons name="image-outline" size={22} color={m.dim} /></View>
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
                                <Ionicons name="add-circle-outline" size={22} color={m.gold} />
                                <View style={{ flex: 1, marginLeft: 12 }}>
                                    <Text style={s.taskTitle}>{type.catalog.addLabel}</Text>
                                    <Text style={s.taskSub}>Your {type.catalog.label.toLowerCase()} is empty, so customers have nothing to choose yet.</Text>
                                </View>
                            </TouchableOpacity>
                        )}

                        {today && today.ordersWeek > 0 && (
                            <View style={s.insight}>
                                <Ionicons name="sparkles" size={16} color={m.gold} />
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
        </View>
    );
}

const makeStyles = (m: Mood) => StyleSheet.create({
    root: { flex: 1, backgroundColor: m.page },
    center: { flex: 1, backgroundColor: m.page, alignItems: 'center', justifyContent: 'center', padding: 32 },
    emptyTitle: { ...T.heading, marginTop: 14, color: m.ink, textAlign: 'center' },
    retry: { marginTop: 16, paddingHorizontal: 22, paddingVertical: 12, borderRadius: 16, backgroundColor: m.goldWash },
    retryText: { ...T.strong, color: m.gold },
    hero: { minHeight: 230, paddingHorizontal: 22, paddingBottom: 22, justifyContent: 'flex-end', overflow: 'hidden', borderBottomLeftRadius: 30, borderBottomRightRadius: 30 },
    badge: { width: 52, height: 52, borderRadius: 18, marginBottom: 12, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 4, borderBottomColor: m.goldLip },
    name: { fontFamily: SERIF, fontSize: 38, lineHeight: 43 },
    body: { paddingHorizontal: 18, paddingTop: 16, gap: 12 },
    notice: { flexDirection: 'row', gap: 10, padding: 14, borderRadius: 18, backgroundColor: m.goldWash },
    noticeText: { ...T.body, flex: 1, color: m.ink },
    openRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    dot: { width: 12, height: 12, borderRadius: 6 },
    openTitle: { ...T.heading, color: m.ink },
    openSub: { ...T.small, color: m.dim },
    stats: { flexDirection: 'row', gap: 12 },
    stat: { flex: 1 },
    statValue: { fontFamily: 'Nunito_900Black', fontSize: 24, lineHeight: 30, color: m.ink },
    statLabel: { ...T.small, color: m.dim },
    shelfHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 4, marginBottom: 8 },
    shelfTitle: { ...T.heading, color: m.ink },
    shelfAll: { ...T.strong, color: m.gold },
    shelf: { gap: 10, paddingRight: 18 },
    shelfCard: { width: 128 },
    shelfPhoto: { width: 128, height: 128, borderRadius: 18 },
    shelfBlank: { alignItems: 'center', justifyContent: 'center', backgroundColor: m.goldWash },
    shelfName: { ...T.small, marginTop: 6, color: m.ink },
    shelfPrice: { ...T.strong, color: m.ink },
    task: { flexDirection: 'row', alignItems: 'center', padding: 16, borderRadius: 20, backgroundColor: m.goldWash },
    taskTitle: { ...T.strong, color: m.ink },
    taskSub: { ...T.small, marginTop: 2, color: m.dim },
    insight: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 6 },
    insightText: { ...T.small, flex: 1, color: m.dim },
});
