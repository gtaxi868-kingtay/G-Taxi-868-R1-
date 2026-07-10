import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { initializeSupabaseClient } from '@gtaxi/core';
import { SURFACE, VOICES } from '@gtaxi/design-system';
import { ghostBorder, elevationGlow, glassSurface } from '@gtaxi/design-system/utils/style-rules';
import { useTaskListener } from '../hooks/useTaskListener';

const { supabase } = initializeSupabaseClient('native');

const ERROR = '#FF4D4D';

interface Order {
  id: string;
  status: string;
  created_at: string;
  total: number;
}

type OrdersScreenNavigationProp = NativeStackNavigationProp<Record<string, undefined>>;

const STATUS_META: Record<string, { label: string; color: string }> = {
  pending: { label: 'Pending', color: VOICES.merchant.accent },
  confirmed: { label: 'Accepted', color: VOICES.merchant.accent },
  preparing: { label: 'Preparing', color: VOICES.merchant.accent },
  ready_for_pickup: { label: 'Ready for Pickup', color: '#10B981' },
  handed_off: { label: 'Handed Off', color: 'rgba(255,255,255,0.6)' },
  delivered: { label: 'Delivered', color: 'rgba(255,255,255,0.6)' },
  cancelled: { label: 'Cancelled', color: ERROR },
};

const ACTION_BUTTONS: Record<string, { label: string; nextStatus: string; color: string }[]> = {
  pending: [
    { label: 'Accept Order', nextStatus: 'confirmed', color: VOICES.merchant.accent },
    { label: 'Reject', nextStatus: 'cancelled', color: ERROR },
  ],
  confirmed: [
    { label: 'Start Prep', nextStatus: 'preparing', color: VOICES.merchant.accent },
  ],
  preparing: [
    { label: 'Ready for Pickup', nextStatus: 'ready_for_pickup', color: '#10B981' },
  ],
};

export function OrdersScreen({ navigation }: { navigation: OrdersScreenNavigationProp }) {
  const insets = useSafeAreaInsets();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [actingOrders, setActingOrders] = useState<Set<string>>(new Set());
  const [puckId, setPuckId] = useState<string | null>(null);

  useTaskListener(puckId, () => { loadOrders(); });

  const resolvePuckId = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const { data: merchant } = await supabase
      .from('merchants')
      .select('id')
      .eq('created_by', session.user.id)
      .maybeSingle();
    if (!merchant) return;

    const { data: nodes } = await supabase
      .from('kiosk_nodes')
      .select('tag_uid')
      .eq('merchant_id', merchant.id)
      .eq('is_active', true);
    if (nodes && nodes.length > 0) {
      setPuckId(nodes[0].tag_uid);
    }
  }, []);

  const loadOrders = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const { data, error } = await supabase
        .from('merchant_orders')
        .select('id, status, created_at, total')
        .eq('merchant_user_id', session.user.id)
        .order('created_at', { ascending: false });

      if (error) {
        console.warn('Failed to load orders:', error.message);
        Alert.alert('Connection Issue', 'Could not load your orders. Please try again.');
        return;
      }

      if (data) setOrders(data);
    } catch (err: any) {
      console.error('Failed to load orders:', err?.message || err);
      Alert.alert('Connection Issue', 'Could not load your orders. Please check your internet connection.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOrders();
    resolvePuckId();
  }, [loadOrders, resolvePuckId]);

  const handleAction = async (orderId: string, newStatus: string) => {
    setActingOrders(prev => new Set(prev).add(orderId));

    try {
      const { error } = await supabase.functions.invoke('merchant', {
        body: { action: 'update_order_status', order_id: orderId, new_status: newStatus },
      });

      if (error) {
        Alert.alert('Action Failed', error.message || 'Could not update order status.');
        return;
      }

      await loadOrders();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Something went wrong.';
      Alert.alert('Error', message);
    } finally {
      setActingOrders(prev => {
        const next = new Set(prev);
        next.delete(orderId);
        return next;
      });
    }
  };

  const confirmReject = (orderId: string) => {
    Alert.alert(
      'Reject Order',
      'Are you sure you want to reject this order?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reject', style: 'destructive', onPress: () => handleAction(orderId, 'cancelled') },
      ],
    );
  };

  const renderOrder = ({ item }: { item: Order }) => {
    const meta = STATUS_META[item.status] || { label: item.status, color: 'rgba(255,255,255,0.6)' };
    const actions = ACTION_BUTTONS[item.status] || [];
    const isActing = actingOrders.has(item.id);

    return (
      <View style={[s.cardBlur, glassSurface()]}>
        <View style={s.orderCard}>
          <View style={s.orderHeader}>
            <View style={[s.statusDot, { backgroundColor: meta.color }]} />
            <Text style={s.orderId}>#{item.id.slice(0, 8)}</Text>
            <Text style={[s.orderStatus, { color: meta.color }]}>{meta.label}</Text>
          </View>
          <Text style={s.orderTotal}>${(item.total || 0).toFixed(2)}</Text>
          <Text style={s.orderDate}>{new Date(item.created_at).toLocaleDateString()}</Text>

          {actions.length > 0 && (
            <View style={s.actionRow}>
              {actions.map(action => (
                <TouchableOpacity
                  key={action.nextStatus}
                  style={[
                    s.actionBtn,
                    { backgroundColor: action.color },
                    action.nextStatus === 'cancelled' && s.actionBtnOutline,
                  ]}
                  accessibilityLabel={`${action.label} order`}
                  accessibilityRole="button"
                  onPress={() => {
                    if (action.nextStatus === 'cancelled') {
                      confirmReject(item.id);
                    } else {
                      handleAction(item.id, action.nextStatus);
                    }
                  }}
                  disabled={isActing}
                >
                  {isActing ? (
                    <ActivityIndicator size="small" color={action.nextStatus === 'cancelled' ? ERROR : '#070C0B'} />
                  ) : (
                    <Text style={[s.actionBtnText, action.nextStatus === 'cancelled' && s.actionBtnTextOutline]}>
                      {action.label}
                    </Text>
                  )}
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      </View>
    );
  };

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <LinearGradient colors={['#070C0B', '#1C1510']} style={StyleSheet.absoluteFillObject} />
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} accessibilityLabel="Go back" accessibilityRole="button">
          <Ionicons name="arrow-back" size={24} color="#E9F5F3" />
        </TouchableOpacity>
        <Text style={s.title}>Orders</Text>
        <TouchableOpacity onPress={loadOrders} accessibilityLabel="Refresh orders" accessibilityRole="button">
          <Ionicons name="refresh" size={22} color={VOICES.merchant.accent} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={VOICES.merchant.accent} style={{ marginTop: 40 }} />
      ) : orders.length === 0 ? (
        <View style={s.emptyState}>
          <Ionicons name="receipt-outline" size={64} color="rgba(255,255,255,0.6)" />
          <Text style={s.emptyText}>No orders yet</Text>
        </View>
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(item) => item.id}
          renderItem={renderOrder}
          contentContainerStyle={s.list}
          refreshing={loading}
          onRefresh={loadOrders}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: SURFACE.base },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  title: { fontSize: 18, fontWeight: '700', color: '#E9F5F3', fontFamily: 'SpaceGrotesk' },
  list: { padding: 16 },
  cardBlur: { borderRadius: 16, marginBottom: 12, overflow: 'hidden', ...ghostBorder(0.15) },
  orderCard: { padding: 16 },
  orderHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  orderId: { fontSize: 14, fontWeight: '600', color: '#E9F5F3', flex: 1, fontFamily: 'Manrope' },
  orderStatus: { fontSize: 12, fontWeight: '600', textTransform: 'capitalize', fontFamily: 'Manrope' },
  orderTotal: { fontSize: 20, fontWeight: '800', color: VOICES.merchant.accent, fontFamily: 'SpaceGrotesk' },
  orderDate: { fontSize: 12, color: 'rgba(255,255,255,0.6)', marginTop: 4, fontFamily: 'Manrope' },
  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyText: { fontSize: 16, color: 'rgba(255,255,255,0.6)', marginTop: 16, fontFamily: 'Manrope' },
  actionRow: { flexDirection: 'row', gap: 8, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' },
  actionBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center', justifyContent: 'center', minHeight: 40 },
  actionBtnOutline: { backgroundColor: 'transparent', ...ghostBorder(), borderColor: ERROR },
  actionBtnText: { fontSize: 13, fontWeight: '700', color: '#070C0B', fontFamily: 'SpaceGrotesk' },
  actionBtnTextOutline: { color: ERROR },
});
