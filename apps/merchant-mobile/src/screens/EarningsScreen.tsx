import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity, Alert, Share,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import { initializeSupabaseClient } from '@gtaxi/core';
import { SURFACE, VOICES } from '@gtaxi/design-system';
import { glassSurface } from '@gtaxi/design-system/utils/style-rules';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

const { supabase } = initializeSupabaseClient('native');

type MerchantStackParamList = {
  Dashboard: undefined;
  Orders: undefined;
  Dispatch: undefined;
  Earnings: undefined;
};

interface StaffEarning {
  staff_id: string | null;
  staff_name: string;
  total_cents: number;
  pending_cents: number;
  paid_cents: number;
  ride_count: number;
}

interface Commission {
  id: string;
  commission_cents: number;
  commission_rate: number;
  status: string;
  created_at: string;
  ride_id: string;
  staff_member_id: string | null;
}

export function EarningsScreen({ navigation }: { navigation: NativeStackNavigationProp<MerchantStackParamList> }) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [merchantId, setMerchantId] = useState<string | null>(null);
  const [totalCents, setTotalCents] = useState(0);
  const [pendingCents, setPendingCents] = useState(0);
  const [staffEarnings, setStaffEarnings] = useState<StaffEarning[]>([]);
  const [recentCommissions, setRecentCommissions] = useState<Commission[]>([]);
  const [walletBalance, setWalletBalance] = useState(0);
  const [activeTab, setActiveTab] = useState<'overview' | 'staff' | 'history'>('overview');

  // Driver network (vouching). Present only when this owner also holds an
  // active pod_commanders row — the 2% on vouched drivers' fares lands in
  // commander_revshare_ledger, written by settlement (record_ride_kickbacks).
  const [network, setNetwork] = useState<{
    code: string | null;
    totalCents: number;
    pendingCents: number;
    rideCount: number;
  } | null>(null);

  useEffect(() => {
    loadEarnings();
  }, [user]);

  const loadNetwork = async (userId: string) => {
    const { data: commander } = await supabase
      .from('pod_commanders')
      .select('id, onboarding_code, status')
      .eq('user_id', userId)
      .eq('status', 'active')
      .maybeSingle();
    if (!commander) { setNetwork(null); return; }

    const { data: rows } = await supabase
      .from('commander_revshare_ledger')
      .select('revshare_cents, status')
      .eq('commander_id', commander.id);
    const list = rows || [];
    setNetwork({
      code: commander.onboarding_code,
      totalCents: list.reduce((sum: number, r: any) => sum + (r.revshare_cents || 0), 0),
      pendingCents: list
        .filter((r: any) => r.status === 'pending')
        .reduce((sum: number, r: any) => sum + (r.revshare_cents || 0), 0),
      rideCount: list.length,
    });
  };

  const shareCode = async () => {
    if (!network?.code) return;
    try {
      await Share.share({
        message: `Drive with G and I'll vouch for you. Download the G driver app, choose "Join with a G-Lead code" and enter: ${network.code.toUpperCase()}`,
      });
    } catch { /* user dismissed */ }
  };

  const loadEarnings = async () => {
    if (!user) return;
    setLoading(true);
    try {
      loadNetwork(user.id).catch((e) => console.warn('Failed to load driver network:', e));

      // Fetch spendable wallet balance
      const { data: wallet } = await supabase
        .from('wallets')
        .select('balance_cents')
        .eq('user_id', user.id)
        .maybeSingle();
      setWalletBalance(wallet?.balance_cents ?? 0);

      // Resolve merchant (owner or staff)
      const { data: merchant } = await supabase
        .from('merchants')
        .select('id')
        .eq('created_by', user.id)
        .maybeSingle();

      const { data: staffRecord } = await supabase
        .from('merchant_staff')
        .select('merchant_id')
        .eq('user_id', user.id)
        .maybeSingle();

      const mId = merchant?.id || staffRecord?.merchant_id || null;
      if (!mId) { setLoading(false); return; }
      setMerchantId(mId);

      // Total commissions
      const { data: commissions, error } = await supabase
        .from('vendor_commissions')
        .select('*, merchant_staff(id, name)')
        .eq('merchant_id', mId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const all = commissions || [];
      setRecentCommissions(all.slice(0, 30));

      const total = all.reduce((s: number, c: any) => s + (c.commission_cents || 0), 0);
      const pending = all
        .filter((c: any) => c.status === 'pending')
        .reduce((s: number, c: any) => s + (c.commission_cents || 0), 0);

      setTotalCents(total);
      setPendingCents(pending);

      // Per-staff breakdown
      const staffMap: Record<string, StaffEarning> = {};
      const shopEntry: StaffEarning = {
        staff_id: null,
        staff_name: 'Shop (unassigned)',
        total_cents: 0,
        pending_cents: 0,
        paid_cents: 0,
        ride_count: 0,
      };

      for (const c of all) {
        const key = c.staff_member_id || '__shop__';
        if (key === '__shop__') {
          shopEntry.total_cents += c.commission_cents || 0;
          if (c.status === 'pending') shopEntry.pending_cents += c.commission_cents || 0;
          if (c.status === 'paid') shopEntry.paid_cents += c.commission_cents || 0;
          shopEntry.ride_count++;
        } else {
          if (!staffMap[key]) {
            staffMap[key] = {
              staff_id: c.staff_member_id,
              staff_name: c.merchant_staff?.name || 'Staff member',
              total_cents: 0,
              pending_cents: 0,
              paid_cents: 0,
              ride_count: 0,
            };
          }
          staffMap[key].total_cents += c.commission_cents || 0;
          if (c.status === 'pending') staffMap[key].pending_cents += c.commission_cents || 0;
          if (c.status === 'paid') staffMap[key].paid_cents += c.commission_cents || 0;
          staffMap[key].ride_count++;
        }
      }

      const staffList = Object.values(staffMap);
      if (shopEntry.ride_count > 0) staffList.push(shopEntry);
      staffList.sort((a, b) => b.total_cents - a.total_cents);
      setStaffEarnings(staffList);
  } catch (err) {
    console.warn('Failed to load earnings:', err);
    Alert.alert('Connection Issue', 'Could not load your earnings data.');
  } finally {
      setLoading(false);
    }
  };

  const ttd = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  const formatDate = (iso: string) => new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
  const statusColor = (s: string) => s === 'paid' ? '#4ADE80' : s === 'pending' ? VOICES.merchant.accent : '#94A3B8';

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <LinearGradient colors={[SURFACE.base, '#1C1510']} style={StyleSheet.absoluteFillObject} />

      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn} accessibilityLabel="Go back" accessibilityRole="button">
          <Ionicons name="chevron-back" size={22} color="#E9F5F3" />
        </TouchableOpacity>
        <Text style={s.title}>Earnings</Text>
        <TouchableOpacity onPress={loadEarnings} style={s.backBtn} accessibilityLabel="Refresh earnings" accessibilityRole="button">
          <Ionicons name="refresh-outline" size={20} color={VOICES.merchant.accent} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator color={VOICES.merchant.accent} style={{ marginTop: 40 }} size="large" />
      ) : (
        <>
          {/* Wallet balance hero */}
          <View style={[s.walletHero, glassSurface(0.18)]}>
            <View style={s.walletHeroLeft}>
              <Text style={s.walletHeroLabel}>Spendable Balance</Text>
              <Text style={s.walletHeroValue}>{ttd(walletBalance)}</Text>
              <Text style={s.walletHeroCurrency}>TTD</Text>
            </View>
            <View style={s.walletHeroIcon}>
              <Ionicons name="wallet-outline" size={32} color={VOICES.merchant.accent} />
            </View>
          </View>

          <View style={s.summaryRow}>
            <View style={[s.summaryCard, glassSurface(0.15)]}>
              <Text style={s.summaryLabel}>Total Earned</Text>
              <Text style={s.summaryValue}>{ttd(totalCents)}</Text>
              <Text style={s.summaryCurrency}>TTD</Text>
            </View>
            <View style={[s.summaryCard, glassSurface(0.15)]}>
              <Text style={s.summaryLabel}>Pending</Text>
              <Text style={[s.summaryValue, { color: VOICES.merchant.accent }]}>{ttd(pendingCents)}</Text>
              <Text style={s.summaryCurrency}>TTD</Text>
            </View>
          </View>

          <View style={s.tabs}>
            {(['overview', 'staff', 'history'] as const).map((tab) => (
              <TouchableOpacity
                key={tab}
                style={[s.tab, activeTab === tab && s.tabActive]}
                accessibilityLabel={`${tab.charAt(0).toUpperCase() + tab.slice(1)} tab`}
                accessibilityRole="tab"
                onPress={() => setActiveTab(tab)}
              >
                <Text style={[s.tabText, activeTab === tab && s.tabTextActive]}>
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <ScrollView contentContainerStyle={s.scrollContent}>
            {activeTab === 'overview' && (
              <View>
                {network && (
                  <View style={[s.networkCard, glassSurface(0.18)]}>
                    <View style={s.networkHeader}>
                      <Ionicons name="people-outline" size={20} color={VOICES.merchant.accent} />
                      <Text style={s.networkTitle}>Your driver network</Text>
                    </View>
                    <Text style={s.networkSub}>
                      You earn 2% of every fare completed by drivers who joined with your code, for as long as you both stay active.
                    </Text>
                    <View style={s.networkStats}>
                      <View style={s.networkStat}>
                        <Text style={s.networkStatValue}>{ttd(network.totalCents)}</Text>
                        <Text style={s.networkStatLabel}>Earned</Text>
                      </View>
                      <View style={s.networkStat}>
                        <Text style={s.networkStatValue}>{ttd(network.pendingCents)}</Text>
                        <Text style={s.networkStatLabel}>Pending</Text>
                      </View>
                      <View style={s.networkStat}>
                        <Text style={s.networkStatValue}>{network.rideCount}</Text>
                        <Text style={s.networkStatLabel}>Rides</Text>
                      </View>
                    </View>
                    {network.code ? (
                      <TouchableOpacity style={s.codeRow} onPress={shareCode} accessibilityRole="button" accessibilityLabel="Share your driver code">
                        <View style={{ flex: 1 }}>
                          <Text style={s.codeLabel}>Your driver code</Text>
                          <Text style={s.codeValue}>{network.code.toUpperCase()}</Text>
                        </View>
                        <View style={s.shareBtn}>
                          <Ionicons name="share-social-outline" size={18} color="#000" />
                          <Text style={s.shareBtnText}>Share</Text>
                        </View>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                )}
                <View style={[s.infoCard, glassSurface(0.12)]}>
                  <Ionicons name="information-circle-outline" size={20} color={VOICES.merchant.accent} style={{ marginRight: 10 }} />
                  <Text style={s.infoText}>A share of the platform fee on every ride that starts with a tap at your counter.</Text>
                </View>
                <View style={[s.infoCard, glassSurface(0.12)]}>
                  <Ionicons name="time-outline" size={20} color={VOICES.merchant.textMuted} style={{ marginRight: 10 }} />
                  <Text style={s.infoText}>Pending commissions are paid out on the 1st and 15th of each month.</Text>
                </View>
                <View style={[s.summaryBreakdown, glassSurface(0.15)]}>
                  <Text style={s.breakdownTitle}>Breakdown</Text>
                  <View style={s.breakdownRow}>
                    <Text style={s.breakdownLabel}>Total commissions</Text>
                    <Text style={s.breakdownValue}>{ttd(totalCents)}</Text>
                  </View>
                  <View style={s.breakdownRow}>
                    <Text style={s.breakdownLabel}>Paid out</Text>
                    <Text style={[s.breakdownValue, { color: '#4ADE80' }]}>{ttd(totalCents - pendingCents)}</Text>
                  </View>
                  <View style={[s.breakdownRow, s.breakdownRowLast]}>
                    <Text style={s.breakdownLabel}>Pending payout</Text>
                    <Text style={[s.breakdownValue, { color: VOICES.merchant.accent }]}>{ttd(pendingCents)}</Text>
                  </View>
                </View>
              </View>
            )}

            {activeTab === 'staff' && (
              staffEarnings.length === 0 ? (
                <Text style={s.emptyText}>No commissions recorded yet.</Text>
              ) : (
                staffEarnings.map((se, i) => (
                  <View key={se.staff_id || 'shop'} style={[s.staffCard, glassSurface(0.12)]}>
                    <View style={s.staffAvatar}>
                      <Text style={s.staffAvatarText}>{se.staff_name.charAt(0).toUpperCase()}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.staffName}>{se.staff_name}</Text>
                      <Text style={s.staffRides}>{se.ride_count} ride{se.ride_count !== 1 ? 's' : ''}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={s.staffTotal}>{ttd(se.total_cents)}</Text>
                      <Text style={s.staffPending}>{ttd(se.pending_cents)} pending</Text>
                    </View>
                  </View>
                ))
              )
            )}

            {activeTab === 'history' && (
              recentCommissions.length === 0 ? (
                <Text style={s.emptyText}>No commission history yet.</Text>
              ) : (
                recentCommissions.map((c) => (
                  <View key={c.id} style={[s.historyRow, glassSurface(0.10)]}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.historyRideId} numberOfLines={1}>Ride {c.ride_id.slice(0, 8)}…</Text>
                      <Text style={s.historyDate}>{formatDate(c.created_at)}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 4 }}>
                      <Text style={s.historyAmount}>{ttd(c.commission_cents)}</Text>
                      <View style={[s.statusBadge, { backgroundColor: statusColor(c.status) + '22' }]}>
                        <Text style={[s.statusText, { color: statusColor(c.status) }]}>{c.status}</Text>
                      </View>
                    </View>
                  </View>
                ))
              )
            )}
          </ScrollView>
        </>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: SURFACE.base },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14 },
  backBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.06)', justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 23, color: '#E9F5F3', fontFamily: VOICES.merchant.serifSemi },
  walletHero: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: 20, marginBottom: 12, borderRadius: 24, padding: 24 },
  walletHeroLeft: { flex: 1 },
  walletHeroLabel: { fontSize: 12, color: VOICES.merchant.textMuted, fontFamily: 'Manrope', textTransform: 'uppercase', letterSpacing: 1 },
  walletHeroValue: { fontSize: 44, color: VOICES.merchant.copper, fontFamily: VOICES.merchant.serifSemi, fontVariant: ['tabular-nums'], marginTop: 4 },
  walletHeroCurrency: { fontSize: 12, color: VOICES.merchant.accent, fontFamily: 'Manrope', marginTop: 2 },
  walletHeroIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: VOICES.merchant.accent + '18', justifyContent: 'center', alignItems: 'center' },
  summaryRow: { flexDirection: 'row', gap: 12, marginHorizontal: 20, marginBottom: 16 },
  summaryCard: { flex: 1, borderRadius: 20, padding: 20 },
  summaryLabel: { fontSize: 12, color: VOICES.merchant.textMuted, fontFamily: 'Manrope', textTransform: 'uppercase', letterSpacing: 0.5 },
  summaryValue: { fontSize: 28, fontWeight: '800', color: '#E9F5F3', fontFamily: 'SpaceGrotesk', marginTop: 4 },
  summaryCurrency: { fontSize: 11, color: VOICES.merchant.textMuted, fontFamily: 'Manrope' },
  tabs: { flexDirection: 'row', marginHorizontal: 20, marginBottom: 16, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 12, padding: 4 },
  tab: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 10 },
  tabActive: { backgroundColor: VOICES.merchant.accent + '22' },
  tabText: { fontSize: 13, color: VOICES.merchant.textMuted, fontFamily: 'Manrope', fontWeight: '600' },
  tabTextActive: { color: VOICES.merchant.accent },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 60 },
  networkCard: { borderRadius: 20, padding: 20, marginBottom: 14, borderWidth: 1, borderColor: VOICES.merchant.accent + '33' },
  networkHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  networkTitle: { fontSize: 16, fontWeight: '700', color: '#E9F5F3', fontFamily: 'SpaceGrotesk' },
  networkSub: { fontSize: 13, color: VOICES.merchant.textMuted, fontFamily: 'Manrope', lineHeight: 18, marginBottom: 14 },
  networkStats: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  networkStat: { flex: 1, borderRadius: 12, paddingVertical: 12, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.05)' },
  networkStatValue: { fontSize: 17, fontWeight: '800', color: '#E9F5F3', fontFamily: 'SpaceGrotesk', fontVariant: ['tabular-nums'] },
  networkStatLabel: { fontSize: 11, color: VOICES.merchant.textMuted, fontFamily: 'Manrope', marginTop: 2 },
  codeRow: { flexDirection: 'row', alignItems: 'center', borderRadius: 14, padding: 14, backgroundColor: 'rgba(255,255,255,0.05)' },
  codeLabel: { fontSize: 11, color: VOICES.merchant.textMuted, fontFamily: 'Manrope', textTransform: 'uppercase', letterSpacing: 0.5 },
  codeValue: { fontSize: 20, fontWeight: '800', color: '#E9F5F3', fontFamily: 'SpaceGrotesk', letterSpacing: 2, marginTop: 2 },
  shareBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: VOICES.merchant.accent, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9 },
  shareBtnText: { fontSize: 13, fontWeight: '700', color: '#000', fontFamily: 'Manrope' },
  infoCard: { flexDirection: 'row', borderRadius: 14, padding: 14, marginBottom: 10, alignItems: 'center' },
  infoText: { flex: 1, fontSize: 13, color: VOICES.merchant.textMuted, fontFamily: 'Manrope', lineHeight: 18 },
  summaryBreakdown: { borderRadius: 20, padding: 20, marginTop: 8 },
  breakdownTitle: { fontSize: 15, fontWeight: '700', color: '#E9F5F3', fontFamily: 'SpaceGrotesk', marginBottom: 14 },
  breakdownRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
  breakdownRowLast: { borderBottomWidth: 0 },
  breakdownLabel: { fontSize: 14, color: VOICES.merchant.textMuted, fontFamily: 'Manrope' },
  breakdownValue: { fontSize: 14, fontWeight: '700', color: '#E9F5F3', fontFamily: 'SpaceGrotesk' },
  emptyText: { textAlign: 'center', color: VOICES.merchant.textMuted, fontFamily: 'Manrope', marginTop: 40 },
  staffCard: { flexDirection: 'row', borderRadius: 16, padding: 16, marginBottom: 10, alignItems: 'center', gap: 12 },
  staffAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: VOICES.merchant.accent + '26', justifyContent: 'center', alignItems: 'center' },
  staffAvatarText: { fontSize: 18, fontWeight: '700', color: VOICES.merchant.accent, fontFamily: 'SpaceGrotesk' },
  staffName: { fontSize: 15, fontWeight: '600', color: '#E9F5F3', fontFamily: 'SpaceGrotesk' },
  staffRides: { fontSize: 12, color: VOICES.merchant.textMuted, fontFamily: 'Manrope', marginTop: 2 },
  staffTotal: { fontSize: 16, fontWeight: '700', color: '#E9F5F3', fontFamily: 'SpaceGrotesk' },
  staffPending: { fontSize: 11, color: VOICES.merchant.accent, fontFamily: 'Manrope', marginTop: 2 },
  historyRow: { flexDirection: 'row', borderRadius: 14, padding: 14, marginBottom: 8 },
  historyRideId: { fontSize: 13, color: '#E9F5F3', fontFamily: 'SpaceGrotesk', fontWeight: '600' },
  historyDate: { fontSize: 11, color: VOICES.merchant.textMuted, fontFamily: 'Manrope', marginTop: 2 },
  historyAmount: { fontSize: 15, fontWeight: '700', color: '#E9F5F3', fontFamily: 'SpaceGrotesk' },
  statusBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  statusText: { fontSize: 11, fontWeight: '700', fontFamily: 'Manrope', textTransform: 'capitalize' },
});
