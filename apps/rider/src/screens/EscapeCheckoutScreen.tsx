import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  ActivityIndicator, Alert, SafeAreaView, Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { supabase } from '@gtaxi/core';
import { useStripe } from '@stripe/stripe-react-native';
import type { AppStackParamList } from '../navigation/types';

const BRAND = '#1DE0E6';

type Nav = NativeStackNavigationProp<AppStackParamList, 'EscapeCheckout'>;
type RouteT = RouteProp<AppStackParamList, 'EscapeCheckout'>;

interface PriceBreakdown {
  package_name: string;
  destination_name: string;
  nights: number;
  departure_time: string;
  tipping_point_seats: number;
  allocated_seats: number;
  cancel_deadline: string | null;
  flight_cost_per_person_cents: number;
  lodging_cost_per_person_cents: number;
  driver_origin_cost_cents: number;
  driver_destination_cost_cents: number;
  price_per_person_cents: number;
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

      const { data, error } = await supabase.functions.invoke('travel', {
        body: {
          action: 'book_escape',
          escape_package_id: packageId,
          guest_count: guestCount,
          payment_method: 'wipay',
          return_url: 'gtaxi://escape',
        },
      });

      if (error) throw error;
      if (data?.redirect_url) {
        await Linking.openURL(data.redirect_url);
        navigation.replace('ActivePass');
        return;
      }

      if (!data?.client_secret) throw new Error(data?.error ?? 'Booking failed');

      const { error: initErr } = await initPaymentSheet({
        paymentIntentClientSecret: data.client_secret,
        merchantDisplayName: 'G Escape',
        style: 'alwaysDark',
      });
      if (initErr) throw new Error(initErr.message);

      const { error: presentErr } = await presentPaymentSheet();
      if (presentErr) {
        if (presentErr.code !== 'Canceled') {
          Alert.alert('Payment failed', presentErr.message);
        }
        return;
      }

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
        <ActivityIndicator size="large" color={BRAND} />
      </View>
    );
  }

  if (!breakdown) return null;

  const seatsLeft = breakdown.tipping_point_seats - breakdown.allocated_seats;
  const poolPct = Math.min(100, Math.round((breakdown.allocated_seats / breakdown.tipping_point_seats) * 100));

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color="#F2F5F8" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Checkout</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
        <Text style={styles.destination}>{breakdown.destination_name}</Text>
        <Text style={styles.packageName}>{breakdown.package_name}</Text>
        <Text style={styles.dateLabel}>Departs {fmtDate(breakdown.departure_time)} · {breakdown.nights}N</Text>

        <View style={styles.card}>
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

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>WHAT YOU GET</Text>

          <Row icon="car-outline" label="Transfer to Piarco (Trinidad)" value={fmt(breakdown.driver_origin_cost_cents)} />
          <Row icon="airplane-outline" label={`Flight POS ⇄ ${breakdown.destination_name.split(' ')[0]}`} value={fmt(breakdown.flight_cost_per_person_cents)} />
          <Row icon="car-outline" label={`${breakdown.destination_name} villa transfer`} value={fmt(breakdown.driver_destination_cost_cents)} />
          <Row icon="home-outline" label={`${breakdown.nights}-night villa stay`} value={fmt(breakdown.lodging_cost_per_person_cents)} />

          <View style={styles.divider} />

          <View style={styles.row}>
            <Text style={styles.perPersonLabel}>Per person</Text>
            <Text style={styles.perPersonValue}>{fmt(breakdown.price_per_person_cents)}</Text>
          </View>

          {guestCount > 1 && (
            <View style={styles.row}>
              <Text style={styles.guestMult}>× {breakdown.guests} guests</Text>
            </View>
          )}

          <View style={[styles.row, styles.totalRow]}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalValue}>{fmt(breakdown.total_price_cents)}</Text>
          </View>
        </View>

        <View style={styles.noticeCard}>
          <Ionicons name="lock-closed-outline" size={18} color={BRAND} />
          <Text style={styles.noticeText}>
            Your card is reserved but not charged. Payment only completes once this flight
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
            ? <ActivityIndicator color="#0B0E12" />
            : <Text style={styles.ctaText}>Lock My Escape · {fmt(breakdown.total_price_cents)}</Text>}
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const Row: React.FC<{ icon: string; label: string; value: string }> = ({ icon, label, value }) => (
  <View style={styles.row}>
    <View style={styles.rowLeft}>
      <Ionicons name={icon as any} size={14} color={BRAND} />
      <Text style={styles.rowLabel}>{label}</Text>
    </View>
    <Text style={styles.rowValue}>{value}</Text>
  </View>
);

const styles = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: '#0B0E12' },
  container:     { flex: 1, paddingHorizontal: 20 },
  centered:      { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0B0E12' },
  header:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                   paddingHorizontal: 16, paddingVertical: 12 },
  backBtn:       { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.08)',
                   alignItems: 'center', justifyContent: 'center' },
  headerTitle:   { fontSize: 17, fontWeight: '700', color: '#F2F5F8' },
  destination:   { fontSize: 28, fontWeight: '800', color: '#F2F5F8', marginTop: 8, letterSpacing: -0.5 },
  packageName:   { fontSize: 15, color: BRAND, fontWeight: '600', marginTop: 4 },
  dateLabel:     { fontSize: 13, color: 'rgba(242,245,248,0.5)', marginTop: 4, marginBottom: 20 },

  card:          { backgroundColor: '#13171D', borderRadius: 16, padding: 18, marginBottom: 16,
                   borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  sectionTitle:  { color: BRAND, fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 14 },
  row:           { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 7 },
  rowLeft:       { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  rowLabel:      { color: 'rgba(242,245,248,0.6)', fontSize: 14, flex: 1 },
  rowValue:      { color: '#F2F5F8', fontSize: 14, fontWeight: '500' },
  divider:       { height: 1, backgroundColor: 'rgba(255,255,255,0.06)', marginVertical: 10 },
  perPersonLabel:{ color: 'rgba(242,245,248,0.42)', fontSize: 13 },
  perPersonValue:{ color: 'rgba(242,245,248,0.7)', fontSize: 13, fontWeight: '600' },
  guestMult:     { color: 'rgba(242,245,248,0.35)', fontSize: 12, flex: 1, textAlign: 'right' },
  totalRow:      { marginTop: 4 },
  totalLabel:    { color: '#F2F5F8', fontSize: 18, fontWeight: '800' },
  totalValue:    { color: '#10B981', fontSize: 20, fontWeight: '800' },

  poolHeader:    { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  poolLabel:     { color: 'rgba(242,245,248,0.42)', fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  poolCount:     { color: '#F2F5F8', fontSize: 12, fontWeight: '600' },
  progressTrack: { height: 4, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden' },
  progressFill:  { height: 4, backgroundColor: BRAND, borderRadius: 2 },
  poolSub:       { color: 'rgba(242,245,248,0.35)', fontSize: 11, marginTop: 8 },

  noticeCard:    { flexDirection: 'row', backgroundColor: 'rgba(29,224,230,0.05)', borderRadius: 14, padding: 14,
                   marginBottom: 24, borderWidth: 1, borderColor: 'rgba(29,224,230,0.12)', gap: 10 },
  noticeText:    { color: 'rgba(242,245,248,0.55)', fontSize: 12, lineHeight: 18, flex: 1 },

  cta:           { backgroundColor: BRAND, borderRadius: 16, paddingVertical: 18, alignItems: 'center' },
  ctaDisabled:   { opacity: 0.5 },
  ctaText:       { color: '#0B0E12', fontWeight: '800', fontSize: 16 },
});
