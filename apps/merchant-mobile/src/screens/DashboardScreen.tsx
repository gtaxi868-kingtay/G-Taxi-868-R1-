import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, useWindowDimensions, ScrollView, Alert } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import { initializeSupabaseClient } from '@gtaxi/core';
import { SURFACE, VOICES } from '@gtaxi/design-system';
import { elevationGlow, glassSurface, ghostBorder } from '@gtaxi/design-system/utils/style-rules';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { AppStackParamList } from '../navigation/types';

const { supabase } = initializeSupabaseClient('native');

export function DashboardScreen({ navigation }: { navigation: NativeStackNavigationProp<AppStackParamList> }) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { user, signOut } = useAuth();
  const [merchantName, setMerchantName] = useState('');
  const [orderCount, setOrderCount] = useState(0);
  const [pendingEarningsCents, setPendingEarningsCents] = useState(0);
  const [insight, setInsight] = useState<{ orders7d: number; busiestHour: number | null } | null>(null);

  useEffect(() => {
    loadMerchantProfile();
    loadOrderCount();
    loadPendingEarnings();
    loadInsights();
  }, []);

  // Additive: G's SQL-computed weekly insight card (no LLM, hides on error).
  const loadInsights = async () => {
    if (!user) return;
    try {
      const weekIso = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
      const { data, error } = await supabase
        .from('merchant_orders')
        .select('created_at')
        .eq('merchant_user_id', user.id)
        .gte('created_at', weekIso);
      if (error || !data) return;
      const hours: Record<number, number> = {};
      data.forEach((o: any) => {
        const h = new Date(o.created_at).getHours();
        hours[h] = (hours[h] || 0) + 1;
      });
      const busiest = Object.entries(hours).sort((a, b) => b[1] - a[1])[0];
      setInsight({ orders7d: data.length, busiestHour: busiest ? Number(busiest[0]) : null });
    } catch {
      /* card just won't render */
    }
  };

  const fmtHour = (h: number) => {
    const am = h < 12;
    const hr = h % 12 === 0 ? 12 : h % 12;
    return `${hr}${am ? 'am' : 'pm'}`;
  };

  const loadMerchantProfile = async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from('merchants')
      .select('name')
      .eq('created_by', user.id)
      .maybeSingle();
    if (error) { console.warn('Failed to load merchant profile:', error.message); Alert.alert('Connection Issue', 'Could not load your merchant profile.'); return; }
    if (data) setMerchantName(data.name);
  };

  const loadOrderCount = async () => {
    if (!user) return;
    const { count, error } = await supabase
      .from('merchant_orders')
      .select('id', { count: 'exact', head: true })
      .eq('merchant_user_id', user.id)
      .in('status', ['pending', 'confirmed']);
    if (error) { console.warn('Failed to load order count:', error.message); Alert.alert('Connection Issue', 'Could not load your order statistics.'); return; }
    setOrderCount(count ?? 0);
  };

  const loadPendingEarnings = async () => {
    if (!user) return;
    const { data: merchant } = await supabase.from('merchants').select('id').eq('created_by', user.id).maybeSingle();
    const { data: staffRecord } = await supabase.from('merchant_staff').select('merchant_id').eq('user_id', user.id).maybeSingle();
    const mId = merchant?.id || staffRecord?.merchant_id;
    if (!mId) return;
    const { data } = await supabase
      .from('vendor_commissions')
      .select('commission_cents')
      .eq('merchant_id', mId)
      .eq('status', 'pending');
    if (data) {
      const total = data.reduce((s: number, c: any) => s + (c.commission_cents || 0), 0);
      setPendingEarningsCents(total);
    }
  };

  const tileWidth = (width - 72) / 2;

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <LinearGradient colors={[SURFACE.base, '#1C1510']} style={StyleSheet.absoluteFillObject} />

      <View style={s.header}>
        <View>
          <Text style={s.greeting}>Welcome back,</Text>
          <Text style={s.merchantName}>{merchantName || 'Merchant'}</Text>
        </View>
        <TouchableOpacity style={s.logoutBtn} onPress={signOut} accessibilityLabel="Sign out" accessibilityRole="button">
          <Ionicons name="log-out-outline" size={22} color="#EF4444" />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={s.scrollContent}>
        <View style={s.statsRow}>
          <View style={[s.statCard, glassSurface(0.15)]}>
            <Text style={s.statNumber}>{orderCount}</Text>
            <Text style={s.statLabel}>Active Orders</Text>
          </View>
          <View style={[s.statCard, glassSurface(0.15)]}>
            <Text style={s.statNumber}>${(pendingEarningsCents / 100).toFixed(2)}</Text>
            <Text style={s.statLabel}>Pending Earnings</Text>
          </View>
        </View>

        {insight && insight.orders7d > 0 && (
          <View style={[s.insightCard, glassSurface(0.15)]}>
            <View style={s.insightHeader}>
              <Ionicons name="sparkles" size={16} color={VOICES.merchant.accent} />
              <Text style={s.insightTitle}>G INSIGHTS · THIS WEEK</Text>
            </View>
            <Text style={s.insightBody}>
              {insight.orders7d} order{insight.orders7d === 1 ? '' : 's'} in the last 7 days
              {insight.busiestHour !== null
                ? `. Busiest around ${fmtHour(insight.busiestHour)} — staff up then.`
                : '.'}
            </Text>
          </View>
        )}

        <Text style={s.sectionTitle}>Quick Actions</Text>
        <View style={s.tileGrid}>
          <TouchableOpacity style={[s.tile, glassSurface(0.15), { width: tileWidth }]} onPress={() => navigation.navigate('Orders')} accessibilityLabel="Manage incoming orders" accessibilityRole="button">
            <View style={[s.tileIcon, { backgroundColor: VOICES.merchant.accent + '26' }]}>
              <Ionicons name="receipt" size={28} color={VOICES.merchant.accent} />
            </View>
            <Text style={s.tileLabel}>Orders</Text>
            <Text style={s.tileDesc}>Manage incoming orders</Text>
          </TouchableOpacity>

          {/* Tap to Pay was registered in the navigator but no tile opened it —
              a merchant had no way to reach card acceptance at all. */}
          <TouchableOpacity style={[s.tile, glassSurface(0.15), { width: tileWidth }]} onPress={() => navigation.navigate('NfcAcceptPayment')} accessibilityLabel="Accept a card payment by tap" accessibilityRole="button">
            <View style={[s.tileIcon, { backgroundColor: VOICES.merchant.accent + '26' }]}>
              <Ionicons name="wifi" size={28} color={VOICES.merchant.accent} />
            </View>
            <Text style={s.tileLabel}>Tap to Pay</Text>
            <Text style={s.tileDesc}>Take a card payment</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[s.tile, glassSurface(0.15), { width: tileWidth }]} onPress={() => navigation.navigate('Dispatch')} accessibilityLabel="Dispatch a car for a client" accessibilityRole="button">
            <View style={[s.tileIcon, { backgroundColor: '#4ADE8026' }]}>
              <Ionicons name="car-sport" size={28} color="#4ADE80" />
            </View>
            <Text style={s.tileLabel}>Dispatch</Text>
            <Text style={s.tileDesc}>Send car for a client</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[s.tile, glassSurface(0.15), { width: tileWidth }]} onPress={() => navigation.navigate('Earnings')} accessibilityLabel="View commissions and payouts" accessibilityRole="button">
            <View style={[s.tileIcon, { backgroundColor: 'rgba(129,140,248,0.15)' }]}>
              <Ionicons name="trending-up" size={28} color="#818CF8" />
            </View>
            <Text style={s.tileLabel}>Earnings</Text>
            <Text style={s.tileDesc}>Commissions & payouts</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[s.tile, glassSurface(0.15), { width: tileWidth }]} onPress={() => navigation.navigate('ProductCatalog')} accessibilityLabel="Add and manage products" accessibilityRole="button">
            <View style={[s.tileIcon, { backgroundColor: 'rgba(16,185,129,0.15)' }]}>
              <Ionicons name="storefront" size={28} color="#10B981" />
            </View>
            <Text style={s.tileLabel}>Catalog</Text>
            <Text style={s.tileDesc}>Add & manage products</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[s.tile, glassSurface(0.15), { width: tileWidth }]} onPress={() => navigation.navigate('Appointments')} accessibilityLabel="View and manage appointments" accessibilityRole="button">
            <View style={[s.tileIcon, { backgroundColor: '#F59E0B26' }]}>
              <Ionicons name="calendar" size={28} color="#F59E0B" />
            </View>
            <Text style={s.tileLabel}>Appointments</Text>
            <Text style={s.tileDesc}>View & manage bookings</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[s.tile, glassSurface(0.15), { width: tileWidth }]} onPress={() => navigation.navigate('Staff')} accessibilityLabel="Manage your team" accessibilityRole="button">
            <View style={[s.tileIcon, { backgroundColor: VOICES.merchant.accent + '26' }]}>
              <Ionicons name="people" size={28} color={VOICES.merchant.accent} />
            </View>
            <Text style={s.tileLabel}>Staff</Text>
            <Text style={s.tileDesc}>Manage your team</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[s.tile, glassSurface(0.15), { width: tileWidth }]} onPress={() => navigation.navigate('PropertyManagement', {})} accessibilityLabel="Manage property iCal sync and availability" accessibilityRole="button">
            <View style={[s.tileIcon, { backgroundColor: 'rgba(59,130,246,0.15)' }]}>
              <Ionicons name="home" size={28} color="#3B82F6" />
            </View>
            <Text style={s.tileLabel}>Property</Text>
            <Text style={s.tileDesc}>iCal sync & availability</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[s.tile, glassSurface(0.15), { width: tileWidth }]} onPress={() => navigation.navigate('EquityProgress', {})} accessibilityLabel="View equity ownership milestones" accessibilityRole="button">
            <View style={[s.tileIcon, { backgroundColor: 'rgba(245,158,11,0.15)' }]}>
              <Ionicons name="trending-up" size={28} color="#F59E0B" />
            </View>
            <Text style={s.tileLabel}>Equity</Text>
            <Text style={s.tileDesc}>Ownership milestones</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[s.tile, glassSurface(0.15), { width: tileWidth }]}
            accessibilityLabel="Sign out of your account"
            accessibilityRole="button"
            onPress={() => {
              Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Sign Out', style: 'destructive', onPress: signOut },
              ]);
            }}
          >
            <View style={[s.tileIcon, { backgroundColor: 'rgba(239,68,68,0.15)' }]}>
              <Ionicons name="log-out-outline" size={28} color="#EF4444" />
            </View>
            <Text style={s.tileLabel}>Sign Out</Text>
            <Text style={s.tileDesc}>End your session</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[s.tile, glassSurface(0.15), { width: tileWidth }]}
            accessibilityLabel="Delete your account permanently"
            accessibilityRole="button"
            onPress={() => {
              Alert.alert(
                'Delete Account',
                'This permanently deletes your business account and all associated data. This cannot be undone.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Delete Permanently',
                    style: 'destructive',
                    onPress: async () => {
                      try {
                        const { error } = await supabase.functions.invoke('delete_account');
                        if (error) throw error;
                        await signOut();
                      } catch (err: any) {
                        Alert.alert('Error', err?.message || 'Could not delete account. Contact support.');
                      }
                    },
                  },
                ]
              );
            }}
          >
            <View style={[s.tileIcon, { backgroundColor: 'rgba(239,68,68,0.15)' }]}>
              <Ionicons name="trash-outline" size={28} color="#EF4444" />
            </View>
            <Text style={s.tileLabel}>Delete Account</Text>
            <Text style={s.tileDesc}>Permanently erase data</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: SURFACE.base },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 24, paddingVertical: 16 },
  greeting: { fontSize: 14, color: VOICES.merchant.textMuted, fontFamily: 'Manrope' },
  merchantName: { fontSize: 26, color: '#E9F5F3', fontFamily: VOICES.merchant.serifSemi },
  logoutBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.06)', justifyContent: 'center', alignItems: 'center', ...ghostBorder(0.15) },
  scrollContent: { padding: 24, paddingBottom: 48 },
  statsRow: { flexDirection: 'row', gap: 12, marginBottom: 32 },
  statCard: { flex: 1, borderRadius: 20, padding: 20 },
  statNumber: { fontSize: 32, fontWeight: '800', color: VOICES.merchant.accent, fontFamily: 'SpaceGrotesk' },
  statLabel: { fontSize: 13, color: VOICES.merchant.textMuted, marginTop: 4, fontFamily: 'Manrope' },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: '#E9F5F3', marginBottom: 16, fontFamily: 'SpaceGrotesk' },
  insightCard: { borderRadius: 20, padding: 20, marginBottom: 32 },
  insightHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  insightTitle: { fontSize: 11, fontWeight: '800', letterSpacing: 1.2, color: VOICES.merchant.accent, fontFamily: 'SpaceGrotesk' },
  insightBody: { fontSize: 15, color: '#E9F5F3', lineHeight: 22, fontFamily: 'Manrope' },
  tileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tile: { borderRadius: 20, padding: 20 },
  tileIcon: { width: 48, height: 48, borderRadius: 14, justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  tileLabel: { fontSize: 16, fontWeight: '700', color: '#E9F5F3', marginBottom: 4, fontFamily: 'SpaceGrotesk' },
  tileDesc: { fontSize: 12, color: VOICES.merchant.textMuted, lineHeight: 16, fontFamily: 'Manrope' },
});
