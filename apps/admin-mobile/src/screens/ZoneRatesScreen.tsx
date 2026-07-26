import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { initializeSupabaseClient } from '@gtaxi/core';
import { GlassContainer } from '../components/GlassContainer';
import { VOICES } from '@gtaxi/design-system';

const { supabase } = initializeSupabaseClient('native');
const ACCENT = VOICES.admin.accent;
const BG = VOICES.admin.bg;

// Read-only mirror of the "Zone Rates" tab in
// apps/admin/src/pages/EscapeManagement.tsx — driver_zone_rates prices
// every G-Escape ground leg. Direct table read (has admin RLS).
// Editing stays on web for now — this is visibility, not the CRUD surface.
interface ZoneRate {
  id: string;
  zone_name: string;
  description: string | null;
  payout_cents: number;
  typical_distance_km: number | null;
  is_active: boolean;
}

export function ZoneRatesScreen() {
  const insets = useSafeAreaInsets();
  const [zones, setZones] = useState<ZoneRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('driver_zone_rates').select('*').order('zone_name');
    if (!error) setZones(data || []);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color={ACCENT} />
        <Text style={styles.loadingText}>Loading zones...</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 16, paddingTop: insets.top + 20, paddingBottom: insets.bottom + 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={ACCENT} />}
    >
      <Text style={styles.headerText}>{zones.length} driver zone rates</Text>
      <Text style={styles.headerSub}>Prices every G-Escape ground leg · edit on web</Text>

      {zones.length === 0 && (
        <GlassContainer style={styles.emptyCard}>
          <Text style={styles.emptyDesc}>No zone rates configured yet.</Text>
        </GlassContainer>
      )}

      {zones.map((z) => (
        <GlassContainer key={z.id} style={z.is_active ? styles.card : [styles.card, styles.cardInactive]}>
          <View style={styles.topRow}>
            <Text style={styles.zoneName}>{z.zone_name}</Text>
            <Text style={styles.payout}>TTD ${(z.payout_cents / 100).toFixed(2)}</Text>
          </View>
          {z.description && <Text style={styles.description}>{z.description}</Text>}
          <View style={styles.footer}>
            {z.typical_distance_km != null && (
              <Text style={styles.meta}>~{z.typical_distance_km} km</Text>
            )}
            {!z.is_active && <Text style={styles.inactiveTag}>INACTIVE</Text>}
          </View>
        </GlassContainer>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  center: { alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { color: 'rgba(255,255,255,0.4)', fontSize: 12 },
  headerText: { color: '#F1F5F9', fontSize: 17, fontWeight: '800' },
  headerSub: { color: 'rgba(255,255,255,0.4)', fontSize: 12, marginTop: 2, marginBottom: 16 },
  emptyCard: { alignItems: 'center', paddingVertical: 24 },
  emptyDesc: { color: 'rgba(255,255,255,0.4)', fontSize: 12 },
  card: { marginBottom: 12 },
  cardInactive: { opacity: 0.5 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  zoneName: { color: '#F1F5F9', fontSize: 14, fontWeight: '700' },
  payout: { color: ACCENT, fontSize: 14, fontWeight: '800' },
  description: { color: 'rgba(255,255,255,0.6)', fontSize: 12, marginTop: 6 },
  footer: { flexDirection: 'row', gap: 10, marginTop: 8 },
  meta: { color: 'rgba(255,255,255,0.35)', fontSize: 10 },
  inactiveTag: { color: '#EF4444', fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
});
