import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, useWindowDimensions, ScrollView, Alert } from 'react-native';
import { CrystalFace, RaisedIcon } from '@gtaxi/design-system-native/src/crystal';
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
            <View style={s.tileIcon}>
              <CrystalFace color={VOICES.merchant.accent} radius={14} />
              <RaisedIcon name="receipt" size={26} />
            </View>
            <Text style={s.tileLabel}>Orders</Text>
            <Text style={s.tileDesc}>Manage incoming orders</Text>
          </TouchableOpacity>

          {/* Tap to Pay: the rider pays the shop from their G-Coin wallet
              (keychain tap, QR or code) via merchant_nfc_charge. It is not a
              card payment, so the tile must not say "card". */}
          <TouchableOpacity style={[s.tile, glassSurface(0.15), { width: tileWidth }]} onPress={() => navigation.navigate('NfcAcceptPayment')} accessibilityLabel="Take a G-Coin wallet payment from a rider" accessibilityRole="button">
            <View style={s.tileIcon}>
              <CrystalFace color={VOICES.merchant.accent} radius={14} />
              <RaisedIcon name="wifi" size={26} />
            </View>
            <Text style={s.tileLabel}>Tap to Pay</Text>
            <Text style={s.tileDesc}>Rider pays from G-Coin wallet</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[s.tile, glassSurface(0.15), { width: tileWidth }]} onPress={() => navigation.navigate('Dispatch')} accessibilityLabel="Dispatch a car for a client" accessibilityRole="button">
            <View style={s.tileIcon}>
              <CrystalFace color={VOICES.merchant.accent} radius={14} />
              <RaisedIcon name="car-sport" size={26} />
            </View>
            <Text style={s.tileLabel}>Dispatch</Text>
            <Text style={s.tileDesc}>Send car for a client</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[s.tile, glassSurface(0.15), { width: tileWidth }]} onPress={() => navigation.navigate('Earnings')} accessibilityLabel="View commissions and payouts" accessibilityRole="button">
            <View style={s.tileIcon}>
              <CrystalFace color={VOICES.merchant.copper} radius={14} />
              <RaisedIcon name="trending-up" size={26} />
            </View>
            <Text style={s.tileLabel}>Earnings</Text>
            <Text style={s.tileDesc}>Commissions & payouts</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[s.tile, glassSurface(0.15), { width: tileWidth }]} onPress={() => navigation.navigate('ProductCatalog')} accessibilityLabel="Add and manage products" accessibilityRole="button">
            <View style={s.tileIcon}>
              <CrystalFace color={VOICES.merchant.accent} radius={14} />
              <RaisedIcon name="storefront" size={26} />
            </View>
            <Text style={s.tileLabel}>Catalog</Text>
            <Text style={s.tileDesc}>Add & manage products</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[s.tile, glassSurface(0.15), { width: tileWidth }]} onPress={() => navigation.navigate('Appointments')} accessibilityLabel="View and manage appointments" accessibilityRole="button">
            <View style={s.tileIcon}>
              <CrystalFace color={VOICES.merchant.copper} radius={14} />
              <RaisedIcon name="calendar" size={26} />
            </View>
            <Text style={s.tileLabel}>Appointments</Text>
            <Text style={s.tileDesc}>View & manage bookings</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[s.tile, glassSurface(0.15), { width: tileWidth }]} onPress={() => navigation.navigate('Brand')} accessibilityLabel="Your brand and map pin" accessibilityRole="button">
            <View style={[s.tileIcon, { backgroundColor: VOICES.merchant.accent + '26' }]}>
              <Ionicons name="sparkles" size={28} color={VOICES.merchant.accent} />
            </View>
            <Text style={s.tileLabel}>Your brand</Text>
            <Text style={s.tileDesc}>Approve your look</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[s.tile, glassSurface(0.15), { width: tileWidth }]} onPress={() => navigation.navigate('Staff')} accessibilityLabel="Manage your team" accessibilityRole="button">
            <View style={s.tileIcon}>
              <CrystalFace color={VOICES.merchant.accent} radius={14} />
              <RaisedIcon name="people" size={26} />
            </View>
            <Text style={s.tileLabel}>Staff</Text>
            <Text style={s.tileDesc}>Manage your team</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[s.tile, glassSurface(0.15), { width: tileWidth }]} onPress={() => navigation.navigate('PropertyManagement', {})} accessibilityLabel="Rooms and nightly rates" accessibilityRole="button">
            <View style={s.tileIcon}>
              <CrystalFace color={VOICES.merchant.accent} radius={14} />
              <RaisedIcon name="home" size={26} />
            </View>
            <Text style={s.tileLabel}>Rooms</Text>
            <Text style={s.tileDesc}>Nightly rates</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[s.tile, glassSurface(0.15), { width: tileWidth }]} onPress={() => navigation.navigate('EquityProgress', {})} accessibilityLabel="View equity ownership milestones" accessibilityRole="button">
            <View style={s.tileIcon}>
              <CrystalFace color={VOICES.merchant.copper} radius={14} />
              <RaisedIcon name="trending-up" size={26} />
            </View>
            <Text style={s.tileLabel}>Equity</Text>
            <Text style={s.tileDesc}>Ownership milestones</Text>
          </TouchableOpacity>

        </View>

        {/* Hick's/Von Restorff: Sign Out and Delete Account used to be two
            more tiles in the same 11-item grid as Orders/Catalog/Staff --
            same size, same glass-tile treatment, same visual weight as
            routine daily actions. Sign Out was also a pure duplicate of the
            header's own sign-out button just above. Removed the duplicate
            entirely; pulled the one truly irreversible action in this app
            out of the grid into its own clearly de-emphasized zone below,
            so it reads as categorically different from "add a product" --
            not visually promoted alongside it. Same confirmation Alert and
            delete_account call, untouched. */}
        <Text style={[s.sectionTitle, s.dangerSectionTitle]}>Danger zone</Text>
        <TouchableOpacity
          style={s.dangerRow}
          accessibilityLabel="Delete your account permanently"
          accessibilityRole="button"
          onPress={() => {
            Alert.alert(
              'Delete Account',
              'Your account and business data will be deleted in 30 days. Sign in again before then and you can cancel it from Settings.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Schedule deletion',
                  style: 'destructive',
                  onPress: async () => {
                    // Same 30-day request flow as every other app
                    // (request_account_deletion); the old delete_account
                    // call hard-deleted immediately.
                    const { data, error } = await supabase.rpc('request_account_deletion')
                      .then((r: any) => r, (e: any) => ({ data: null, error: e }));
                    if (error || !data?.success) {
                      Alert.alert('Could not submit', 'Please try again, or email privacy@gtaxi.tt.');
                      return;
                    }
                    const when = data.scheduled_at ? new Date(data.scheduled_at).toLocaleDateString() : 'in 30 days';
                    Alert.alert('Deletion scheduled', `Your account will be deleted on ${when}.`);
                    await signOut();
                  },
                },
              ]
            );
          }}
        >
          <Ionicons name="trash-outline" size={18} color="#EF4444" />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={s.dangerLabel}>Delete Account</Text>
            <Text style={s.dangerDesc}>Erase your business data after a 30-day grace period.</Text>
          </View>
        </TouchableOpacity>
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
  dangerSectionTitle: { marginTop: 32, fontSize: 13, color: 'rgba(239,68,68,0.7)', textTransform: 'uppercase', letterSpacing: 1 },
  dangerRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 4, borderTopWidth: 1, borderTopColor: 'rgba(239,68,68,0.15)' },
  dangerLabel: { fontSize: 14, fontWeight: '600', color: '#EF4444', fontFamily: 'Manrope' },
  dangerDesc: { fontSize: 12, color: 'rgba(239,68,68,0.55)', marginTop: 2, fontFamily: 'Manrope' },
  insightCard: { borderRadius: 20, padding: 20, marginBottom: 32 },
  insightHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  insightTitle: { fontSize: 11, fontWeight: '800', letterSpacing: 1.2, color: VOICES.merchant.accent, fontFamily: 'SpaceGrotesk' },
  insightBody: { fontSize: 15, color: '#E9F5F3', lineHeight: 22, fontFamily: 'Manrope' },
  tileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tile: { borderRadius: 20, padding: 20 },
  tileIcon: { overflow: 'hidden', width: 48, height: 48, borderRadius: 14, justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  tileLabel: { fontSize: 16, fontWeight: '700', color: '#E9F5F3', marginBottom: 4, fontFamily: 'SpaceGrotesk' },
  tileDesc: { fontSize: 12, color: VOICES.merchant.textMuted, lineHeight: 16, fontFamily: 'Manrope' },
});
