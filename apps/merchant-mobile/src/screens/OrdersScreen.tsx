import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { initializeSupabaseClient } from '@gtaxi/core';

const { supabase } = initializeSupabaseClient('native');

const COLORS = {
  bg: '#0A0A0F',
  surface: 'rgba(255,255,255,0.06)',
  gold: '#F59E0B',
  goldDark: '#B45309',
  text: '#FFFFFF',
  textMuted: 'rgba(255,255,255,0.5)',
  glassBorder: 'rgba(255,255,255,0.08)',
  warning: '#F59E0B',
  accent: '#06B6D4',
  danger: '#EF4444',
  indigo: '#818CF8',
  success: '#10B981',
};

interface Order {
  id: string;
  status: string;
  created_at: string;
  total: number;
}

const STATUS_META: Record<string, { label: string; color: string }> = {
  pending: { label: 'Pending', color: COLORS.warning },
  confirmed: { label: 'Accepted', color: COLORS.accent },
  preparing: { label: 'Preparing', color: COLORS.gold },
  ready_for_pickup: { label: 'Ready for Pickup', color: COLORS.success },
  handed_off: { label: 'Handed Off', color: COLORS.textMuted },
  delivered: { label: 'Delivered', color: COLORS.textMuted },
  cancelled: { label: 'Cancelled', color: COLORS.danger },
};

const ACTION_BUTTONS: Record<string, { label: string; nextStatus: string; color: string }[]> = {
  pending: [
    { label: 'Accept Order', nextStatus: 'confirmed', color: COLORS.gold },
    { label: 'Reject', nextStatus: 'cancelled', color: COLORS.danger },
  ],
  confirmed: [
    { label: 'Start Prep', nextStatus: 'preparing', color: COLORS.gold },
  ],
  preparing: [
    { label: 'Ready for Pickup', nextStatus: 'ready_for_pickup', color: COLORS.success },
  ],
};

export function OrdersScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [actingOrders, setActingOrders] = useState<Set<string>>(new Set());

  const loadOrders = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const { data } = await supabase
        .from('merchant_orders')
        .select('id, status, created_at, total')
        .eq('merchant_id', session.user.id)
        .order('created_at', { ascending: false });

      if (data) setOrders(data);
    } catch (err) {
      console.warn('Failed to load orders:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  const handleAction = async (orderId: string, newStatus: string) => {
    setActingOrders(prev => new Set(prev).add(orderId));

    try {
      const { error } = await supabase.functions.invoke('merchant_update_order_status', {
        body: { order_id: orderId, new_status: newStatus },
      });

      if (error) {
        Alert.alert('Action Failed', error.message || 'Could not update order status.');
        return;
      }

      await loadOrders();
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Something went wrong.');
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
    const meta = STATUS_META[item.status] || { label: item.status, color: COLORS.textMuted };
    const actions = ACTION_BUTTONS[item.status] || [];
    const isActing = actingOrders.has(item.id);

    return (
      <BlurView intensity={60} tint="dark" style={s.cardBlur}>
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
                    <ActivityIndicator size="small" color={action.nextStatus === 'cancelled' ? COLORS.danger : '#0A0A0F'} />
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
      </BlurView>
    );
  };

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <LinearGradient colors={['#0A0A0F', '#1C1510']} style={StyleSheet.absoluteFillObject} />
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={s.title}>Orders</Text>
        <TouchableOpacity onPress={loadOrders}>
          <Ionicons name="refresh" size={22} color={COLORS.gold} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={COLORS.gold} style={{ marginTop: 40 }} />
      ) : orders.length === 0 ? (
        <View style={s.emptyState}>
          <Ionicons name="receipt-outline" size={64} color={COLORS.textMuted} />
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
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  title: { fontSize: 18, fontWeight: '700', color: COLORS.text, fontFamily: 'SpaceGrotesk' },
  list: { padding: 16 },
  cardBlur: { borderRadius: 16, marginBottom: 12, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.glassBorder },
  orderCard: { padding: 16 },
  orderHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  orderId: { fontSize: 14, fontWeight: '600', color: COLORS.text, flex: 1, fontFamily: 'Manrope' },
  orderStatus: { fontSize: 12, fontWeight: '600', textTransform: 'capitalize', fontFamily: 'Manrope' },
  orderTotal: { fontSize: 20, fontWeight: '800', color: COLORS.gold, fontFamily: 'SpaceGrotesk' },
  orderDate: { fontSize: 12, color: COLORS.textMuted, marginTop: 4, fontFamily: 'Manrope' },
  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyText: { fontSize: 16, color: COLORS.textMuted, marginTop: 16, fontFamily: 'Manrope' },
  actionRow: { flexDirection: 'row', gap: 8, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' },
  actionBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center', justifyContent: 'center', minHeight: 40 },
  actionBtnOutline: { backgroundColor: 'transparent', borderWidth: 1, borderColor: COLORS.danger },
  actionBtnText: { fontSize: 13, fontWeight: '700', color: '#0A0A0F', fontFamily: 'SpaceGrotesk' },
  actionBtnTextOutline: { color: COLORS.danger },
});
