import React, { useState, useEffect, useRef } from 'react';
import { View, Share, Animated, Linking, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { supabase, escapeWhatsAppLink } from '@gtaxi/core';
import type { AppStackParamList } from '../navigation/types';
import { useEscapeTrip, ItineraryLeg } from '../context/EscapeContext';
import { Ionicons } from '@expo/vector-icons';
import { Button, Card, Divider, EmptyState, Loading, Row, Screen, Section, SPACE, Txt, useTheme } from '../ui/kit';

const BRAND = '#8B7CFF';

type Nav = NativeStackNavigationProp<AppStackParamList, 'ActivePass'>;

const PHASE_LABELS: Record<string, string> = {
  ACTIVE_HOLD:      'Securing your seats',
  CAPTURED:         'Building your escape',
  CONFIRMED:        'Escape locked',
  EN_ROUTE_DEPART:  'Driver en route',
  ON_ISLAND:        "You're here",
  EN_ROUTE_RETURN:  'Heading home',
  COMPLETED:        'Trip complete',
};

const LEG_ICON_NAMES: Record<string, 'car-outline' | 'airplane-outline' | 'home-outline'> = {
  GROUND_TRANSIT: 'car-outline',
  AVIATION:       'airplane-outline',
  LODGING:        'home-outline',
};

const LEG_STATUS_COLOR: Record<string, string> = {
  scheduled:        '#B8B0C4',
  driver_en_route:  BRAND,
  in_transit:       '#3FD9E8',
  completed:        '#2FB57C',
  delayed:          '#F59E0B',
  cancelled:        '#EF4444',
};

export default function ActivePassScreen() {
  const navigation = useNavigation<Nav>();
  const { activeTrip, loading, refreshTrip } = useEscapeTrip();
  const [countdown, setCountdown] = useState('');
  const [participantId, setParticipantId] = useState<string | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.08, duration: 900, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 900, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, []);

  useEffect(() => {
    if (activeTrip?.status !== 'ACTIVE_HOLD' || !activeTrip.hold_expires_at) return;
    const tick = () => {
      const diff = new Date(activeTrip.hold_expires_at!).getTime() - Date.now();
      if (diff <= 0) { setCountdown('Expired'); refreshTrip(); return; }
      const m = Math.floor(diff / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setCountdown(`${m}:${s.toString().padStart(2, '0')}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [activeTrip?.status, activeTrip?.hold_expires_at]);

  useEffect(() => {
    if (!activeTrip || !['CONFIRMED', 'EN_ROUTE_DEPART', 'ON_ISLAND', 'EN_ROUTE_RETURN', 'COMPLETED'].includes(activeTrip.status)) {
      setParticipantId(null);
      return;
    }
    const fetchParticipant = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const pkgId = activeTrip.escape_packages?.id;
      if (!pkgId) return;
      const { data } = await supabase
        .from('escape_group_participants')
        .select('id')
        .eq('package_id', pkgId)
        .eq('rider_id', session.user.id)
        .in('status', ['intent_pending', 'confirmed'])
        .maybeSingle();
      if (data) setParticipantId(data.id);
    };
    fetchParticipant();
  }, [activeTrip?.status, activeTrip?.escape_packages?.id]);

  const m = useTheme();

  if (loading) return <Screen title="Your escape" onBack={() => navigation.goBack()}><Loading /></Screen>;

  if (!activeTrip) {
    return (
      <Screen title="Your escape" onBack={() => navigation.goBack()}>
        <EmptyState icon="airplane-outline" title="No trip booked yet" body="Book a G Escape package and your trip will show here."
          action={<Button title="Browse escapes" onPress={() => navigation.navigate('EscapeStorefront')} />} />
      </Screen>
    );
  }

  const status = activeTrip.status;
  const pkg = activeTrip.escape_packages;
  const itin = activeTrip.master_escape_itineraries;
  const fb = pkg?.flight_blocks;
  const phaseLabel = PHASE_LABELS[status] ?? status;

  const fmt = (cents: number) => `TT$${((cents || 0) / 100).toFixed(2)}`;
  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-TT', {
    weekday: 'short', day: 'numeric', month: 'short',
  });
  const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('en-TT', {
    hour: '2-digit', minute: '2-digit',
  });

  const poolPct = fb
    ? Math.min(100, Math.round((fb.allocated_seats / fb.tipping_point_seats) * 100))
    : 0;
  const seatsLeft = fb ? fb.tipping_point_seats - fb.allocated_seats : 0;

  const buildShareText = () => {
    const dest = fb?.destination_name ?? 'the Caribbean';
    const pkgId = pkg?.id ?? '';
    const departureStr = fb?.departure_time ? fmtDate(fb.departure_time) : '';
    if (seatsLeft > 0) {
      return `I just locked in my G Escape seat to ${dest} ✈️\n\nDeparts ${departureStr}. We need ${seatsLeft} more person${seatsLeft !== 1 ? 's' : ''} to confirm the flight for everyone.\n\nJoin the pool on G-Taxi:\ngtaxi://escape/${pkgId}\n\n#GEscape #Caribbean`;
    }
    return `Flight confirmed — I'm heading to ${dest} on G Escape! ✈️\n\nBooked right from G-Taxi, the Caribbean travel app built for T&T.\n\nDeparts ${departureStr}. Download G-Taxi to plan yours.\n\n#GEscape #Caribbean`;
  };

  const handleShare = async () => {
    await Share.share({
      message: buildShareText(),
      title: `G Escape to ${fb?.destination_name ?? 'the Caribbean'}`,
    });
  };

  const handleWhatsAppShare = () => {
    const text = buildShareText();
    Linking.openURL(`whatsapp://send?text=${encodeURIComponent(text)}`).catch(() => {
      Share.share({ message: text });
    });
  };

  const handleAddOn = (label: string) => {
    Alert.alert(
      label,
      'Your G-Taxi concierge will arrange this for you. Tap Book to send a request.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Book via WhatsApp',
          onPress: async () => {
            const dest = fb?.destination_name ?? 'your destination';
            // The G-Escape concierge number comes from system_config
            // (escape_whatsapp_number), not a hard-coded placeholder.
            const link = await escapeWhatsAppLink(
              `Hi, I'm on G Escape to ${dest} (ref: ${activeTrip?.booking_ref ?? ''}) and I'd like to book: ${label}`
            );
            Linking.openURL(link)
              .catch(() => Alert.alert('WhatsApp not found', 'Please contact your G-Taxi concierge directly.'));
          },
        },
      ]
    );
  };

  const live = ['CONFIRMED', 'EN_ROUTE_DEPART', 'ON_ISLAND', 'EN_ROUTE_RETURN'].includes(status);
  const field = (label: string, value: string) => (
    <View style={{ marginRight: SPACE.xl, marginBottom: SPACE.sm }}>
      <Txt variant="overline" tone="faint">{label}</Txt>
      <Txt variant="headline">{value}</Txt>
    </View>
  );

  return (
    <Screen
      title="Your escape"
      onBack={() => navigation.goBack()}
      hero={
        <View>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Animated.View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#8B7CFF', marginRight: SPACE.sm, transform: [{ scale: pulseAnim }] }} />
            <Txt variant="label" tone="accent">{phaseLabel}</Txt>
          </View>
          <Txt variant="hero" style={{ marginTop: SPACE.xs }}>{fb?.destination_name ?? pkg?.lodging_nodes?.destination_code ?? 'Your escape'}</Txt>
          <Txt variant="body" tone="dim">{[pkg?.package_name, fb?.departure_time ? `${fmtDate(fb.departure_time)} at ${fmtTime(fb.departure_time)}` : null].filter(Boolean).join(' · ')}</Txt>
        </View>
      }
    >
      {status === 'ACTIVE_HOLD' && (
        <Card>
          <Txt variant="bodyStrong">Your seats are on hold</Txt>
          <Txt variant="hero" tone="accent" style={{ marginTop: SPACE.xs }}>{countdown}</Txt>
          <Txt variant="caption" tone="dim">Finish paying before the timer ends to keep them.</Txt>
          <Txt variant="caption" tone="dim" style={{ marginTop: SPACE.xs }}>Total {fmt(activeTrip.total_price_cents)} · {activeTrip.guest_count} guest{activeTrip.guest_count !== 1 ? 's' : ''}</Txt>
        </Card>
      )}

      {status === 'CAPTURED' && fb && (
        <Card>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Txt variant="bodyStrong">Seats filled</Txt>
            <Txt variant="bodyStrong" tone="dim">{fb.allocated_seats} of {fb.tipping_point_seats}</Txt>
          </View>
          <View style={{ height: 8, borderRadius: 4, backgroundColor: m.field, marginTop: SPACE.sm, overflow: 'hidden' }}>
            <View style={{ height: 8, width: `${poolPct}%` as any, backgroundColor: '#8B7CFF' }} />
          </View>
          <Txt variant="caption" tone="dim" style={{ marginTop: SPACE.sm }}>
            {seatsLeft > 0 ? `${seatsLeft} more seat${seatsLeft !== 1 ? 's' : ''} needed to confirm the flight` : 'Enough seats are filled. This flight is on.'}
            {fb.cancel_deadline ? ` · Closes ${fmtDate(fb.cancel_deadline)}` : ''}
          </Txt>
          {seatsLeft > 0 && (
            <View style={{ flexDirection: 'row', gap: SPACE.md, marginTop: SPACE.lg }}>
              <Button title="WhatsApp" icon="logo-whatsapp" size="md" variant="secondary" style={{ flex: 1 }} onPress={handleWhatsAppShare} />
              <Button title="Share" icon="share-social-outline" size="md" style={{ flex: 1 }} onPress={handleShare} />
            </View>
          )}
        </Card>
      )}

      {live && (
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View>
              <Txt variant="hero">POS</Txt>
              <Txt variant="caption" tone="dim">Piarco</Txt>
            </View>
            <Ionicons name="airplane" size={22} color={m.accent} />
            <View style={{ alignItems: 'flex-end' }}>
              <Txt variant="hero">{fb?.destination_code ?? '—'}</Txt>
              <Txt variant="caption" tone="dim">{fb?.destination_name?.split(' ')[0] ?? 'Destination'}</Txt>
            </View>
          </View>
          <Divider />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {field('BOOKING REF', activeTrip.booking_ref ?? '—')}
            {field('GUESTS', String(activeTrip.guest_count))}
            {fb?.departure_time ? field('DEPARTS', fmtDate(fb.departure_time)) : null}
          </View>
          {itin?.qr_code_token && (
            <View style={{ alignItems: 'center', marginTop: SPACE.md, padding: SPACE.lg, borderRadius: 16, backgroundColor: m.field }}>
              <Txt variant="title" style={{ letterSpacing: 2 }}>{itin.qr_code_token}</Txt>
              <Txt variant="caption" tone="dim">Show this at the gate</Txt>
            </View>
          )}
        </Card>
      )}

      {status === 'CONFIRMED' && participantId && (
        <Card style={{ marginTop: SPACE.md, paddingVertical: SPACE.xs }}>
          <Row icon="document-text-outline" title="Add passport details" subtitle="Needed for airline check-in" last
            onPress={() => navigation.navigate('PassportSubmission', { participantId })} />
        </Card>
      )}

      {itin?.itinerary_legs && itin.itinerary_legs.length > 0 && (
        <Section title="Your journey">
          <Card>
            {itin.itinerary_legs.map((leg, idx) => (
              <LegRow key={leg.id} leg={leg} isLast={idx === itin.itinerary_legs.length - 1} />
            ))}
          </Card>
        </Section>
      )}

      {status === 'ON_ISLAND' && (
        <Section title="While you're there">
          <Card style={{ paddingVertical: SPACE.xs }}>
            {['Jet ski excursion', 'Private chef dinner', 'Island tour (half day)'].map((label, i, arr) => (
              <Row key={label} title={label} subtitle="Arranged by your G concierge" last={i === arr.length - 1} onPress={() => handleAddOn(label)} />
            ))}
          </Card>
        </Section>
      )}

      <Txt variant="caption" tone="faint" style={{ textAlign: 'center', marginTop: SPACE.xl }}>Ref {activeTrip.booking_ref ?? '—'} · {fmt(activeTrip.total_price_cents)}</Txt>
    </Screen>
  );
}

const LegRow: React.FC<{ leg: ItineraryLeg; isLast: boolean }> = ({ leg, isLast }) => {
  const fmtTime = (iso: string | null) => iso
    ? new Date(iso).toLocaleTimeString('en-TT', { hour: '2-digit', minute: '2-digit' })
    : '—';

  const LEG_LABELS: Record<string, string> = {
    TT_AIRPORT_TRANSFER: 'Home → Piarco Airport',
    DEST_VILLA_TRANSFER: 'Airport → Villa',
    VILLA_STAY:          'Villa stay',
    RETURN_AIRPORT_TRANSFER: 'Villa → Airport',
    RETURN_HOME_TRANSFER:    'Airport → Home',
  };

  const label = leg.reference_code
    ? LEG_LABELS[leg.reference_code] ?? leg.reference_code
    : leg.service_type === 'AVIATION' ? 'Flight' : leg.service_type;

  const m = useTheme();
  const color = LEG_STATUS_COLOR[leg.status] ?? m.faint;
  return (
    <View style={{ flexDirection: 'row' }}>
      <View style={{ alignItems: 'center', width: 24 }}>
        <View style={{ width: 12, height: 12, borderRadius: 6, marginTop: 4, backgroundColor: color }} />
        {!isLast && <View style={{ width: 2, flex: 1, minHeight: 24, backgroundColor: m.chipBorder }} />}
      </View>
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'flex-start', marginLeft: SPACE.sm, paddingBottom: isLast ? 0 : SPACE.lg }}>
        <Ionicons name={LEG_ICON_NAMES[leg.service_type] ?? 'ellipse-outline'} size={16} color={m.accent} style={{ marginTop: 2 }} />
        <View style={{ flex: 1, marginLeft: SPACE.sm }}>
          <Txt variant="bodyStrong">{label}</Txt>
          {leg.scheduled_start ? <Txt variant="caption" tone="dim">{fmtTime(leg.scheduled_start)}</Txt> : null}
        </View>
        <Txt variant="label" style={{ color }}>{leg.status.replace(/_/g, ' ')}</Txt>
      </View>
    </View>
  );
};
