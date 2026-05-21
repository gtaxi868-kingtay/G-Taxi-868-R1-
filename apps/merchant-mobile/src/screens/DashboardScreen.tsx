import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, useWindowDimensions, ScrollView } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import { initializeSupabaseClient } from '@gtaxi/core';

const { supabase } = initializeSupabaseClient('native');

const COLORS = {
  bg: '#0A0A0F',
  surface: 'rgba(255,255,255,0.06)',
  gold: '#F59E0B',
  goldDark: '#B45309',
  text: '#FFFFFF',
  textMuted: 'rgba(255,255,255,0.5)',
  border: 'rgba(245,158,11,0.2)',
  glassBorder: 'rgba(255,255,255,0.08)',
  warning: '#F59E0B',
  danger: '#EF4444',
  indigo: '#818CF8',
};

export function DashboardScreen({ navigation }: any) {
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
    const { data } = await supabase
      .from('merchants')
      .select('name')
      .eq('created_by', user.id)
      .maybeSingle();
    if (data) setMerchantName(data.name);
  };

  const loadOrderCount = async () => {
    if (!user) return;
    const { data } = await supabase
      .from('merchant_orders')
      .select('id', { count: 'exact', head: true })
      .eq('merchant_id', user.id)
      .in('status', ['pending', 'confirmed']);
    if (data) setOrderCount(data.length);
  };

  const tileWidth = (width - 72) / 2;

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <LinearGradient colors={['#0A0A0F', '#1C1510']} style={StyleSheet.absoluteFillObject} />

      <View style={s.header}>
        <View>
          <Text style={s.greeting}>Welcome back,</Text>
          <Text style={s.merchantName}>{merchantName || 'Merchant'}</Text>
        </View>
        <TouchableOpacity style={s.logoutBtn} onPress={signOut}>
          <Ionicons name="log-out-outline" size={22} color={COLORS.danger} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={s.scrollContent}>
        <View style={s.statsRow}>
          <BlurView intensity={60} tint="dark" style={s.statBlur}>
            <View style={s.statCard}>
              <Text style={s.statNumber}>{orderCount}</Text>
              <Text style={s.statLabel}>Active Orders</Text>
            </View>
          </BlurView>
          <BlurView intensity={60} tint="dark" style={s.statBlur}>
            <View style={s.statCard}>
              <Text style={s.statNumber}>0</Text>
              <Text style={s.statLabel}>Today's Sales</Text>
            </View>
          </BlurView>
        </View>

        <Text style={s.sectionTitle}>Quick Actions</Text>
        <View style={s.tileGrid}>
          <BlurView intensity={60} tint="dark" style={[s.tileBlur, { width: tileWidth }]}>
            <TouchableOpacity style={s.tile} onPress={() => navigation.navigate('Orders')}>
              <View style={[s.tileIcon, { backgroundColor: 'rgba(245,158,11,0.15)' }]}>
                <Ionicons name="receipt" size={28} color={COLORS.gold} />
              </View>
              <Text style={s.tileLabel}>Orders</Text>
              <Text style={s.tileDesc}>Manage incoming orders</Text>
            </TouchableOpacity>
          </BlurView>

          <BlurView intensity={60} tint="dark" style={[s.tileBlur, { width: tileWidth }]}>
            <TouchableOpacity style={s.tile} onPress={() => {}}>
              <View style={[s.tileIcon, { backgroundColor: 'rgba(245,158,11,0.15)' }]}>
                <Ionicons name="cube" size={28} color={COLORS.gold} />
              </View>
              <Text style={s.tileLabel}>Products</Text>
              <Text style={s.tileDesc}>Manage inventory</Text>
            </TouchableOpacity>
          </BlurView>

          <BlurView intensity={60} tint="dark" style={[s.tileBlur, { width: tileWidth }]}>
            <TouchableOpacity style={s.tile} onPress={() => {}}>
              <View style={[s.tileIcon, { backgroundColor: 'rgba(129,140,248,0.15)' }]}>
                <Ionicons name="trending-up" size={28} color={COLORS.indigo} />
              </View>
              <Text style={s.tileLabel}>Analytics</Text>
              <Text style={s.tileDesc}>View sales data</Text>
            </TouchableOpacity>
          </BlurView>

          <BlurView intensity={60} tint="dark" style={[s.tileBlur, { width: tileWidth }]}>
            <TouchableOpacity style={s.tile} onPress={() => {}}>
              <View style={[s.tileIcon, { backgroundColor: 'rgba(239,68,68,0.15)' }]}>
                <Ionicons name="settings" size={28} color={COLORS.danger} />
              </View>
              <Text style={s.tileLabel}>Settings</Text>
              <Text style={s.tileDesc}>Account & preferences</Text>
            </TouchableOpacity>
          </BlurView>
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 24, paddingVertical: 16 },
  greeting: { fontSize: 14, color: COLORS.textMuted, fontFamily: 'Manrope' },
  merchantName: { fontSize: 22, fontWeight: '800', color: COLORS.text, fontFamily: 'SpaceGrotesk' },
  logoutBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.06)', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: COLORS.glassBorder },
  scrollContent: { padding: 24, paddingBottom: 48 },
  statsRow: { flexDirection: 'row', gap: 12, marginBottom: 32 },
  statBlur: { flex: 1, borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.glassBorder },
  statCard: { padding: 20 },
  statNumber: { fontSize: 32, fontWeight: '800', color: COLORS.gold, fontFamily: 'SpaceGrotesk' },
  statLabel: { fontSize: 13, color: COLORS.textMuted, marginTop: 4, fontFamily: 'Manrope' },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: COLORS.text, marginBottom: 16, fontFamily: 'SpaceGrotesk' },
  tileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tileBlur: { borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.glassBorder },
  tile: { padding: 20 },
  tileIcon: { width: 48, height: 48, borderRadius: 14, justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  tileLabel: { fontSize: 16, fontWeight: '700', color: COLORS.text, marginBottom: 4, fontFamily: 'SpaceGrotesk' },
  tileDesc: { fontSize: 12, color: COLORS.textMuted, lineHeight: 16, fontFamily: 'Manrope' },
});
