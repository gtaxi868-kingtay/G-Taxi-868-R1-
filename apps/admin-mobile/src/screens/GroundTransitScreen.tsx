import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { initializeSupabaseClient } from '@gtaxi/core';
import { GlassContainer } from '../components/GlassContainer';
import { VOICES } from '@gtaxi/design-system';

const { supabase } = initializeSupabaseClient('native');
const ACCENT = VOICES.admin.accent;
const BG = VOICES.admin.bg;

// Read-only mirror of the "Ground Transit" tab in
// apps/admin/src/pages/EscapeManagement.tsx — the escrow_prepaid rides
// created by execute_escape_group_confirmation for each G-Escape leg.
// Goes through the admin edge function because `rides` has no admin RLS.
interface TransferRide {
  id: string;
  status: string;
  driver_id: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  total_fare_cents: number | null;
  scheduled_for: string | null;
  reservation: { booking_ref: string; leg: string } | null;
}

const LEG_LABELS: Record<string, string> = {
  trinidad_transfer_ride_id: 'T&T Pickup',
  destination_transfer_ride_id: 'Destination Arrival',
  trinidad_return_ride_id: 'T&T Return',
  destination_return_ride_id: 'Destination Departure',
};

const STATUS_COLOR: Record<string, string> = {
  scheduled: 'rgba(255,255,255,0.4)',
  searching: '#F59E0B',
  assigned: '#3B82F6',
  arrived: '#3B82F6',
  in_progress: ACCENT,
  completed: '#10B981',
  cancelled: '#EF4444',
};

export function GroundTransitScreen() {
  const insets = useSafeAreaInsets();
  const [rides, setRides] = useState<TransferRide[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.functions.invoke('admin', {
      body: { action: 'list_escape_transfer_rides' },
    });
    if (!error && data?.success) setRides(data.rides || []);
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
        <Text style={styles.loadingText}>Loading transfers...</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 16, paddingTop: insets.top + 20, paddingBottom: insets.bottom + 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={ACCENT} />}
    >
      <Text style={styles.headerText}>{rides.length} ground-transit rides</Text>
      <Text style={styles.headerSub}>G-Escape airport/hotel legs — escrow_prepaid</Text>

      {rides.length === 0 && (
        <GlassContainer style={styles.emptyCard}>
          <Text style={styles.emptyDesc}>No scheduled transfer rides yet.</Text>
        </GlassContainer>
      )}

      {rides.map((r) => (
        <GlassContainer key={r.id} style={styles.card}>
          <View style={styles.topRow}>
            <Text style={styles.leg}>{r.reservation ? LEG_LABELS[r.reservation.leg] || r.reservation.leg : 'Unmatched leg'}</Text>
            <Text style={[styles.status, { color: STATUS_COLOR[r.status] || '#fff' }]}>{r.status.toUpperCase()}</Text>
          </View>
          {r.reservation && <Text style={styles.bookingRef}>{r.reservation.booking_ref}</Text>}
          <Text style={styles.route}>{r.pickup_address || 'No pickup set'}</Text>
          <Text style={styles.routeArrow}>↓</Text>
          <Text style={styles.route}>{r.dropoff_address || 'No dropoff set'}</Text>
          <View style={styles.footer}>
            <Text style={styles.meta}>
              {r.scheduled_for ? new Date(r.scheduled_for).toLocaleString() : 'Not scheduled'}
            </Text>
            {r.total_fare_cents != null && (
              <Text style={styles.fare}>TTD ${(r.total_fare_cents / 100).toFixed(2)}</Text>
            )}
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
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  leg: { color: '#F1F5F9', fontSize: 13, fontWeight: '700' },
  status: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  bookingRef: { color: 'rgba(255,255,255,0.35)', fontSize: 10, fontFamily: 'monospace', marginTop: 2 },
  route: { color: 'rgba(255,255,255,0.7)', fontSize: 12, marginTop: 6 },
  routeArrow: { color: 'rgba(255,255,255,0.25)', fontSize: 11, marginTop: 2 },
  footer: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  meta: { color: 'rgba(255,255,255,0.35)', fontSize: 10 },
  fare: { color: ACCENT, fontSize: 12, fontWeight: '700' },
});
