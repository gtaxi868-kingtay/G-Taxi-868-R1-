import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  ActivityIndicator, Alert, SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { supabase } from '@gtaxi/core';
import { useStripe } from '@stripe/stripe-react-native';
import type { RootStackParamList } from '../navigation/types';

// Itemized checkout for a G-Escape package.
// Shows the exact price breakdown (ground transfers + flight + villa) and
// presents the Stripe payment sheet for a manual-capture pre-authorization.
// The card is HELD but not charged until the flight block reaches its
// tipping point. If the block is cancelled, the hold is automatically voided.

type Nav = NativeStackNavigationProp<RootStackParamList, 'EscapeCheckout'>;
type RouteT = RouteProp<RootStackParamList, 'EscapeCheckout'>;

interface PriceBreakdown {
  package_name: string;
  destination_name: string;
  nights: number;
  departure_time: string;
  tipping_point_seats: number;
  allocated_seats: number;
  cancel_deadline: string | null;
  // Per-person public costs
  flight_cost_per_person_cents: number;
  lodging_cost_per_person_cents: number;
  driver_origin_cost_cents: number;
  driver_destination_cost_cents: number;
  price_per_person_cents: number;
  // Calculated for this booking
  total_price_cents: number;
  guests: number;
}

export default function EscapeCheckoutScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<RouteT>();
  const { packageId, guestCount } = route.params;
  const { initPaymentSheet, presentPaymentSheet } = useStripe();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [breakdown, setBreakdown] = useState<PriceBreakdown | null>(null);

  useEffect(() => { loadBreakdown(); }, []);

  const loadBreakdown = async () => {
    try {
      const { data, error } = await supabase
        .from('escape_packages')
        .select(`
          package_name,
          price_per_person_cents,
          flight_cost_per_person_cents,
          lodging_cost_per_person_cents,
          driver_origin_cost_cents,
          driver_destination_cost_cents,
          flight_blocks ( destination_name, departure_time, tipping_point_seats, allocated_seats, cancel_deadline ),
          lodging_nodes ( nights )
        `)
        .eq('id', packageId)
        .single();

      if (error || !data) throw error ?? new Error('Package not found');

      const fb = Array.isArray(data.flight_blocks) ? data.flight_blocks[0] : data.flight_blocks;
      const ln = Array.isArray(data.lodging_nodes) ? data.lodging_nodes[0] : data.lodging_nodes;

      setBreakdown({
        package_name: data.package_name,
        destination_name: fb?.destination_name ?? '',
        nights: ln?.nights ?? 2,
        departure_time: fb?.departure_time ?? '',
        tipping_point_seats: fb?.tipping_point_seats ?? 20,
        allocated_seats: fb?.allocated_seats ?? 0,
        cancel_deadline: fb?.cancel_deadline ?? null,
        flight_cost_per_person_cents: data.flight_cost_per_person_cents,
        lodging_cost_per_person_cents: data.lodging_cost_per_person_cents,
        driver_origin_cost_cents: data.driver_origin_cost_cents,
        driver_destination_cost_cents: data.driver_destination_cost_cents,
        price_per_person_cents: data.price_per_person_cents,
        total_price_cents: data.price_per_person_cents * guestCount,
        guests: guestCount,
      });
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Failed to load package pricing');
      navigation.goBack();
    } finally {
      setLoading(false);
    }
  };

  const handleCommit = async () => {
    setSubmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const { data, error } = await supabase.functions.invoke('book_escape', {
        body: {
          escape_package_id: packageId,
          guest_count: guestCount,
          payment_method: 'stripe',
        },
      });

      if (error) throw error;
      if (!data?.client_secret) throw new Error(data?.error ?? 'Booking failed');

      // Init Stripe Payment Sheet with manual-capture pre-auth
      const { error: initErr } = await initPaymentSheet({
        paymentIntentClientSecret: data.client_secret,
        merchantDisplayName: 'G Escape',
        style: 'alwaysDark',
      });
      if (initErr) throw new Error(initErr.message);

      const { error: presentErr } = await presentPaymentSheet();
      if (presentErr) {
        // User cancelled or card declined — hold is still active for 10 min
        if (presentErr.code !== 'Canceled') {
          Alert.alert('Payment failed', presentErr.message);
        }
        return;
      }

      // Payment method attached — navigate to live trip tracker
      navigation.replace('ActivePass');
    } catch (err: any) {
      Alert.alert('Booking error', err.message ?? 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  };

  const fmt = (cents: number) => `TTD ${(cents / 100).toFixed(2)}`;
  const fmtDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('en-TT', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#C8A96E" />
      </View>
    );
  }

  if (!breakdown) return null;

  const seatsLeft = breakdown.tipping_point_seats - breakdown.allocated_seats;
  const poolPct = Math.min(100, Math.round((breakdown.allocated_seats / breakdown.tipping_point_seats) * 100));

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <Text style={styles.destination}>{breakdown.destination_name}</Text>
        <Text style={styles.packageName}>{breakdown.package_name}</Text>
        <Text style={styles.dateLabel}>Departs {fmtDate(breakdown.departure_time)} · {breakdown.nights}N</Text>

        {/* Pool progress */}
        <View style={styles.poolCard}>
          <View style={styles.poolHeader}>
            <Text style={styles.poolLabel}>Flight pool</Text>
            <Text style={styles.poolCount}>{breakdown.allocated_seats} / {breakdown.tipping_point_seats} seats</Text>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${poolPct}%` as any }]} />
          </View>
          <Text style={styles.poolSub}>
            {seatsLeft > 0
              ? `${seatsLeft} more seat${seatsLeft !== 1 ? 's' : ''} needed to lock this flight`
              : 'Tipping point reached — flight is confirmed!'}
          </Text>
        </View>

        {/* Itemized breakdown */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>WHAT YOU GET</Text>

          <Row label="Transfer to Piarco (Trinidad)" value={fmt(breakdown.driver_origin_cost_cents)} />
          <Row label={`Flight POS ⇄ ${breakdown.destination_name.split(' ')[0]}`} value={fmt(breakdown.flight_cost_per_person_cents)} />
          <Row label={`${breakdown.destination_name} villa transfer`} value={fmt(breakdown.driver_destination_cost_cents)} />
          <Row label={`${breakdown.nights}-night villa stay`} value={fmt(breakdown.lodging_cost_per_person_cents)} />

          <View style={styles.divider} />

          <View style={styles.row}>
            <Text style={styles.perPersonLabel}>Per person</Text>
            <Text style={styles.perPersonValue}>{fmt(breakdown.price_per_person_cents)}</Text>
          </View>

          {guestCount > 1 && (
            <View style={styles.row}>
              <Text style={styles.guestMult}>× {guestCount} guests</Text>
            </View>
          )}

          <View style={[styles.row, styles.totalRow]}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalValue}>{fmt(breakdown.total_price_cents)}</Text>
          </View>
        </View>

        {/* Pre-auth notice */}
        <View style={styles.noticeCard}>
          <Ionicons name="lock-closed-outline" size={20} color="#C8A96E" style={styles.noticeIcon} />
          <Text style={styles.noticeText}>
            Your card is reserved but {'​'}not charged. Payment only completes once this flight
            reaches {breakdown.tipping_point_seats} seats. If the pool doesn't fill, your hold is automatically voided — no charge, ever.
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.cta, submitting && styles.ctaDisabled]}
          onPress={handleCommit}
          disabled={submitting}
          activeOpacity={0.85}
        >
          {submitting
            ? <ActivityIndicator color="#000" />
            : <Text style={styles.ctaText}>Lock My Escape · {fmt(breakdown.total_price_cents)}</Text>}
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const Row: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <View style={styles.row}>
    <Text style={styles.rowLabel}>{label}</Text>
    <Text style={styles.rowValue}>{value}</Text>
  </View>
);

const styles = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: '#0C0C0F' },
  container:     { flex: 1, paddingHorizontal: 20 },
  centered:      { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0C0C0F' },
  destination:   { fontSize: 28, fontWeight: '700', color: '#FFFFFF', marginTop: 28, letterSpacing: -0.5 },
  packageName:   { fontSize: 16, color: '#C8A96E', fontWeight: '600', marginTop: 4 },
  dateLabel:     { fontSize: 13, color: '#666', marginTop: 4, marginBottom: 20 },
  poolCard:      { backgroundColor: '#141418', borderRadius: 12, padding: 16, marginBottom: 16,
                   borderWidth: 1, borderColor: '#222' },
  poolHeader:    { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  poolLabel:     { color: '#888', fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  poolCount:     { color: '#FFF', fontSize: 12, fontWeight: '600' },
  progressTrack: { height: 4, backgroundColor: '#222', borderRadius: 2, overflow: 'hidden' },
  progressFill:  { height: 4, backgroundColor: '#C8A96E', borderRadius: 2 },
  poolSub:       { color: '#555', fontSize: 11, marginTop: 8 },
  card:          { backgroundColor: '#141418', borderRadius: 12, padding: 18, marginBottom: 16,
                   borderWidth: 1, borderColor: '#222' },
  sectionTitle:  { color: '#C8A96E', fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 14 },
  row:           { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 7 },
  rowLabel:      { color: '#888', fontSize: 14, flex: 1 },
  rowValue:      { color: '#EEE', fontSize: 14, fontWeight: '500' },
  divider:       { height: 1, backgroundColor: '#222', marginVertical: 10 },
  perPersonLabel:{ color: '#666', fontSize: 13 },
  perPersonValue:{ color: '#CCC', fontSize: 13, fontWeight: '600' },
  guestMult:     { color: '#444', fontSize: 12, flex: 1, textAlign: 'right' },
  totalRow:      { marginTop: 4 },
  totalLabel:    { color: '#FFF', fontSize: 18, fontWeight: '700' },
  totalValue:    { color: '#4ADE80', fontSize: 20, fontWeight: '700' },
  noticeCard:    { flexDirection: 'row', backgroundColor: '#111520', borderRadius: 10, padding: 14,
                   marginBottom: 24, borderWidth: 1, borderColor: '#1E2640' },
  noticeIcon:    { fontSize: 18, marginRight: 10, marginTop: 1 },
  noticeText:    { color: '#6B82B4', fontSize: 12, lineHeight: 18, flex: 1 },
  cta:           { backgroundColor: '#C8A96E', borderRadius: 12, paddingVertical: 18, alignItems: 'center' },
  ctaDisabled:   { opacity: 0.5 },
  ctaText:       { color: '#000', fontWeight: '700', fontSize: 16 },
});
