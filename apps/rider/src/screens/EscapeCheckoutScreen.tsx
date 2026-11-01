import React, { useState, useEffect } from 'react';
import { View, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { supabase } from '@gtaxi/core';
import { useStripe } from '@stripe/stripe-react-native';
import type { AppStackParamList } from '../navigation/types';
import { toast } from '../components/Toast';
import { Button, Card, Divider, EmptyState, Loading, Screen, Section, SPACE, Txt, useTheme } from '../ui/kit';

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
      toast(err?.message ?? 'Could not load this escape.', 'error');
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
          toast(presentErr.message || 'Payment did not go through.', 'error');
        }
        return;
      }

      navigation.replace('ActivePass');
    } catch (err: any) {
      toast(err?.message ?? 'Booking did not go through. Please try again.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const fmt = (cents: number) => `TT$${((cents || 0) / 100).toFixed(2)}`;
  const fmtDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('en-TT', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  };

  const m = useTheme();

  if (loading) return <Screen title="Checkout" onBack={() => navigation.goBack()}><Loading /></Screen>;
  if (!breakdown) {
    return (
      <Screen title="Checkout" onBack={() => navigation.goBack()}>
        <EmptyState icon="airplane-outline" title="This escape is not available" body="It may be full or no longer on sale." />
      </Screen>
    );
  }

  const seatsLeft = breakdown.tipping_point_seats - breakdown.allocated_seats;
  const poolPct = Math.min(100, Math.round((breakdown.allocated_seats / Math.max(1, breakdown.tipping_point_seats)) * 100));
  const line = (icon: any, label: string, value: string) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6 }}>
      <Ionicons name={icon} size={16} color={m.faint} />
      <Txt variant="body" tone="dim" style={{ flex: 1, marginLeft: SPACE.sm }}>{label}</Txt>
      <Txt variant="bodyStrong">{value}</Txt>
    </View>
  );

  return (
    <Screen
      title="Checkout"
      onBack={() => navigation.goBack()}
      footer={<Button title={`Lock my escape · ${fmt(breakdown.total_price_cents)}`} loading={submitting} onPress={handleCommit} />}
      hero={
        <View>
          <Txt variant="label" tone="accent">{breakdown.package_name}</Txt>
          <Txt variant="hero" style={{ marginTop: SPACE.xs }}>{breakdown.destination_name}</Txt>
          {breakdown.departure_time ? <Txt variant="body" tone="dim" style={{ marginTop: SPACE.xs }}>Leaves {fmtDate(breakdown.departure_time)} · {breakdown.nights} nights</Txt> : null}
        </View>
      }
    >
      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Txt variant="bodyStrong">Seats filled</Txt>
          <Txt variant="bodyStrong" tone="dim">{breakdown.allocated_seats} of {breakdown.tipping_point_seats}</Txt>
        </View>
        <View style={{ height: 8, borderRadius: 4, backgroundColor: m.field, marginTop: SPACE.sm, overflow: 'hidden' }}>
          <View style={{ height: 8, width: `${poolPct}%` as any, backgroundColor: '#8B7CFF' }} />
        </View>
        <Txt variant="caption" tone="dim" style={{ marginTop: SPACE.sm }}>
          {seatsLeft > 0 ? `${seatsLeft} more seat${seatsLeft !== 1 ? 's' : ''} needed to confirm the flight` : 'Enough seats are filled. This flight is on.'}
        </Txt>
      </Card>

      <Section title="What's included">
        <Card>
          {line('car-outline', 'Ride to Piarco', fmt(breakdown.driver_origin_cost_cents))}
          {line('airplane-outline', `Flight to ${(breakdown.destination_name || 'destination').split(' ')[0]} and back`, fmt(breakdown.flight_cost_per_person_cents))}
          {line('car-outline', `Ride to your stay in ${breakdown.destination_name}`, fmt(breakdown.driver_destination_cost_cents))}
          {line('home-outline', `${breakdown.nights} nights' stay`, fmt(breakdown.lodging_cost_per_person_cents))}
          <Divider style={{ marginVertical: SPACE.sm }} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
            <Txt variant="body" tone="dim">Per person{guestCount > 1 ? ` × ${breakdown.guests}` : ''}</Txt>
            <Txt variant="bodyStrong">{fmt(breakdown.price_per_person_cents)}</Txt>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
            <Txt variant="headline">Total</Txt>
            <Txt variant="headline">{fmt(breakdown.total_price_cents)}</Txt>
          </View>
        </Card>
      </Section>

      <Card style={{ marginTop: SPACE.md, flexDirection: 'row', alignItems: 'flex-start' }}>
        <Ionicons name="lock-closed-outline" size={18} color={m.accent} style={{ marginTop: 2 }} />
        <Txt variant="caption" tone="dim" style={{ flex: 1, marginLeft: SPACE.sm }}>
          Your payment is held, not taken, until the flight reaches {breakdown.tipping_point_seats} seats. If it does not fill, the hold is released and you are not charged.
        </Txt>
      </Card>
    </Screen>
  );
}
