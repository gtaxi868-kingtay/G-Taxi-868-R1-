import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, Vibration, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { initializeSupabaseClient } from '@gtaxi/core';
import { useMerchant } from '../context/MerchantContext';
import { Card, Empty, GoldKey, PageHeader } from '../ui/kit';
import { Mood, type as T, useMood, useStyles } from '../ui/mood';

const { supabase } = initializeSupabaseClient('native');

type Item = { order_id: string; quantity: number; products: { name: string } | null };
type Order = { id: string; status: string; created_at: string; total_cents: number | null; delivery_method: string | null; payment_status: string | null };

const NEXT: Record<string, { label: string; next: string }> = {
    pending: { label: 'Accept order', next: 'confirmed' },
    confirmed: { label: 'Start preparing', next: 'preparing' },
    preparing: { label: 'Ready for pickup', next: 'ready_for_pickup' },
};

// The order board: what just came in, what is on the counter, what is waiting
// for a driver, and what is finished.
export const SECTIONS: { title: string; statuses: string[] }[] = [
    { title: 'New', statuses: ['pending'] },
    { title: 'Being prepared', statuses: ['confirmed', 'preparing'] },
    { title: 'Ready', statuses: ['ready_for_pickup', 'handed_off'] },
    { title: 'Finished', statuses: ['delivered', 'cancelled'] },
];

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const day = (iso: string) => new Date(iso).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
const isToday = (iso: string) => new Date(iso).toDateString() === new Date().toDateString();
const how = (o: Order) => (o.delivery_method === 'pickup' ? 'Pickup' : o.delivery_method ? 'Delivery' : 'Order');
const paid = (o: Order) => (o.payment_status === 'cash_on_delivery' ? 'Cash on delivery' : o.payment_status === 'captured' ? 'Paid' : null);

export function OrdersScreen(_props: { navigation?: unknown }) {
    const m = useMood();
    const s = useStyles(makeStyles);
    const { merchant } = useMerchant();
    const [orders, setOrders] = useState<Order[]>([]);
    const [items, setItems] = useState<Record<string, Item[]>>({});
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [acting, setActing] = useState<string | null>(null);
    const load = useCallback(async () => {
        if (!merchant) { setLoading(false); return; }
        const { data, error } = await supabase
            .from('merchant_orders')
            .select('id, status, created_at, total_cents, delivery_method, payment_status')
            .eq('merchant_id', merchant.id)
            .order('created_at', { ascending: false })
            .limit(60);
        if (error) {
            Alert.alert('Connection issue', 'Could not load your orders. Pull down to try again.');
        } else {
            const rows = (data ?? []) as Order[];
            setOrders(rows);
            if (rows.length) {
                const { data: lines } = await supabase
                    .from('order_items')
                    .select('order_id, quantity, products(name)')
                    .in('order_id', rows.map((o) => o.id));
                const grouped: Record<string, Item[]> = {};
                ((lines ?? []) as unknown as Item[]).forEach((l) => { (grouped[l.order_id] ??= []).push(l); });
                setItems(grouped);
            }
        }
        setLoading(false);
    }, [merchant?.id]);

    useEffect(() => { load(); }, [load]);

    // Live board: a new order, or a change from a driver or customer, lands here
    // straight away. This used to listen to a physical tag, and no shop has one.
    useEffect(() => {
        if (!merchant) return;
        const channel = supabase
            .channel(`merchant_orders_${merchant.id}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `merchant_id=eq.${merchant.id}` }, (change: { eventType: string }) => {
                if (change.eventType === 'INSERT') Vibration.vibrate([0, 300, 150, 300]);
                load();
            })
            .subscribe();
        return () => { supabase.removeChannel(channel); };
    }, [merchant?.id, load]);

    const update = async (id: string, next: string) => {
        setActing(id);
        const { data, error } = await supabase.functions.invoke('merchant', {
            body: { action: 'update_order_status', order_id: id, new_status: next },
        });
        setActing(null);
        if (error || data?.success === false) {
            Alert.alert('Could not update', data?.error || 'Check your connection and try again.');
            return;
        }
        await load();
    };

    const reject = (id: string) => Alert.alert('Reject this order?', 'The customer will be told.', [
        { text: 'Keep it', style: 'cancel' },
        { text: 'Reject', style: 'destructive', onPress: () => update(id, 'cancelled') },
    ]);

    const refresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

    const sections = useMemo(() => SECTIONS
        .map((sec) => ({ ...sec, rows: orders.filter((o) => sec.statuses.includes(o.status)).slice(0, sec.title === 'Finished' ? 10 : 30) }))
        .filter((sec) => sec.rows.length > 0), [orders]);

    const waiting = orders.filter((o) => o.status === 'pending').length;

    return (
        <View style={s.root}>
            <PageHeader title="Orders" sub={waiting ? `${waiting} new, waiting on you` : 'Your order board'} />
            {loading ? (
                <ActivityIndicator size="large" color={m.gold} style={{ marginTop: 40 }} />
            ) : (
                <ScrollView contentContainerStyle={s.list} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={m.gold} />}>
                    {sections.length === 0 && <Empty icon="receipt-outline" title="No orders yet" body="New orders appear here the moment they come in." />}
                    {sections.map((sec) => (
                        <View key={sec.title}>
                            <Text style={s.section}>{sec.title} · {sec.rows.length}</Text>
                            {sec.rows.map((o) => {
                                const step = NEXT[o.status];
                                const lines = items[o.id] ?? [];
                                return (
                                    <Card key={o.id} style={s.card} highlight={o.status === 'pending'}>
                                        <View style={s.top}>
                                            <Text style={s.when}>{isToday(o.created_at) ? time(o.created_at) : `${day(o.created_at)}, ${time(o.created_at)}`}</Text>
                                            <Text style={s.total}>TT${((o.total_cents ?? 0) / 100).toFixed(2)}</Text>
                                        </View>
                                        <Text style={s.meta}>{[how(o), paid(o)].filter(Boolean).join(' · ')}</Text>
                                        {lines.map((l, i) => (
                                            <Text key={i} style={s.line} numberOfLines={1}>{l.quantity} × {l.products?.name ?? 'Item'}</Text>
                                        ))}
                                        {o.status === 'cancelled' && <Text style={s.cancelled}>Cancelled</Text>}
                                        {step && (
                                            <View style={s.actions}>
                                                <View style={{ flex: 1 }}>
                                                    <GoldKey label={step.label} busy={acting === o.id} onPress={() => update(o.id, step.next)} />
                                                </View>
                                                {o.status === 'pending' && (
                                                    <TouchableOpacity style={s.reject} onPress={() => reject(o.id)} accessibilityRole="button" accessibilityLabel="Reject order">
                                                        <Ionicons name="close" size={24} color={m.danger} />
                                                    </TouchableOpacity>
                                                )}
                                            </View>
                                        )}
                                    </Card>
                                );
                            })}
                        </View>
                    ))}
                </ScrollView>
            )}
        </View>
    );
}

const makeStyles = (m: Mood) => StyleSheet.create({
    root: { flex: 1, backgroundColor: m.page },
    list: { paddingHorizontal: 18, paddingBottom: 28 },
    section: { ...T.strong, marginTop: 12, marginBottom: 8, color: m.dim },
    card: { marginBottom: 12 },
    top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
    when: { ...T.heading, color: m.ink },
    total: { fontFamily: 'Nunito_900Black', fontSize: 21, lineHeight: 27, color: m.ink },
    meta: { ...T.small, marginBottom: 8, color: m.dim },
    line: { ...T.body, fontSize: 15, lineHeight: 22, color: m.ink },
    cancelled: { ...T.small, marginTop: 4, color: m.danger },
    actions: { flexDirection: 'row', gap: 10, marginTop: 12 },
    reject: { width: 56, height: 52, borderRadius: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: m.line, backgroundColor: m.card },
});
