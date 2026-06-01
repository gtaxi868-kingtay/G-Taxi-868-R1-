import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, useWindowDimensions, ScrollView } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import { initializeSupabaseClient } from '@gtaxi/core';
import { SURFACE, VOICES } from '@gtaxi/design-system';
import { elevationGlow, glassSurface, ghostBorder } from '@gtaxi/design-system/utils/style-rules';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

const { supabase } = initializeSupabaseClient('native');

type MerchantStackParamList = {
  Dashboard: undefined;
  Orders: undefined;
};

export function DashboardScreen({ navigation }: { navigation: NativeStackNavigationProp<MerchantStackParamList> }) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { user, signOut } = useAuth();
  const [merchantName, setMerchantName] = useState('');
  const [orderCount, setOrderCount] = useState(0);

  useEffect(() => {
    loadMerchantProfile();
    loadOrderCount();
  }, []);

  const loadMerchantProfile = async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from('merchants')
      .select('name')
      .eq('created_by', user.id)
      .maybeSingle();
    if (error) { console.warn('Failed to load merchant profile:', error.message); return; }
    if (data) setMerchantName(data.name);
  };

  const loadOrderCount = async () => {
    if (!user) return;
    const { count, error } = await supabase
      .from('merchant_orders')
      .select('id', { count: 'exact', head: true })
      .eq('merchant_id', user.id)
      .in('status', ['pending', 'confirmed']);
    if (error) { console.warn('Failed to load order count:', error.message); return; }
    setOrderCount(count ?? 0);
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
        <TouchableOpacity style={s.logoutBtn} onPress={signOut}>
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
            <Text style={s.statNumber}>0</Text>
            <Text style={s.statLabel}>Today's Sales</Text>
          </View>
        </View>

        <Text style={s.sectionTitle}>Quick Actions</Text>
        <View style={s.tileGrid}>
          <TouchableOpacity style={[s.tile, glassSurface(0.15), { width: tileWidth }]} onPress={() => navigation.navigate('Orders')}>
            <View style={[s.tileIcon, { backgroundColor: VOICES.merchant.accent + '26' }]}>
              <Ionicons name="receipt" size={28} color={VOICES.merchant.accent} />
            </View>
            <Text style={s.tileLabel}>Orders</Text>
            <Text style={s.tileDesc}>Manage incoming orders</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[s.tile, glassSurface(0.15), { width: tileWidth }]} onPress={() => {}}>
            <View style={[s.tileIcon, { backgroundColor: VOICES.merchant.accent + '26' }]}>
              <Ionicons name="cube" size={28} color={VOICES.merchant.accent} />
            </View>
            <Text style={s.tileLabel}>Products</Text>
            <Text style={s.tileDesc}>Manage inventory</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[s.tile, glassSurface(0.15), { width: tileWidth }]} onPress={() => {}}>
            <View style={[s.tileIcon, { backgroundColor: 'rgba(129,140,248,0.15)' }]}>
              <Ionicons name="trending-up" size={28} color="#818CF8" />
            </View>
            <Text style={s.tileLabel}>Analytics</Text>
            <Text style={s.tileDesc}>View sales data</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[s.tile, glassSurface(0.15), { width: tileWidth }]} onPress={() => {}}>
            <View style={[s.tileIcon, { backgroundColor: 'rgba(239,68,68,0.15)' }]}>
              <Ionicons name="settings" size={28} color="#EF4444" />
            </View>
            <Text style={s.tileLabel}>Settings</Text>
            <Text style={s.tileDesc}>Account & preferences</Text>
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
  merchantName: { fontSize: 22, fontWeight: '800', color: '#FFFFFF', fontFamily: 'SpaceGrotesk' },
  logoutBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.06)', justifyContent: 'center', alignItems: 'center', ...ghostBorder(0.15) },
  scrollContent: { padding: 24, paddingBottom: 48 },
  statsRow: { flexDirection: 'row', gap: 12, marginBottom: 32 },
  statCard: { flex: 1, borderRadius: 20, padding: 20 },
  statNumber: { fontSize: 32, fontWeight: '800', color: VOICES.merchant.accent, fontFamily: 'SpaceGrotesk' },
  statLabel: { fontSize: 13, color: VOICES.merchant.textMuted, marginTop: 4, fontFamily: 'Manrope' },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: '#FFFFFF', marginBottom: 16, fontFamily: 'SpaceGrotesk' },
  tileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tile: { borderRadius: 20, padding: 20 },
  tileIcon: { width: 48, height: 48, borderRadius: 14, justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  tileLabel: { fontSize: 16, fontWeight: '700', color: '#FFFFFF', marginBottom: 4, fontFamily: 'SpaceGrotesk' },
  tileDesc: { fontSize: 12, color: VOICES.merchant.textMuted, lineHeight: 16, fontFamily: 'Manrope' },
});
