import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Share, Animated, SafeAreaView, ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { useEscapeTrip, ItineraryLeg } from '../context/EscapeContext';

// Status-driven concierge screen. The entire journey lives here.
// One screen, seven phases — no manual navigation required.
// The status machine in the DB drives what the rider sees.
//
// Phase map:
//   ACTIVE_HOLD      → "Securing your seats" (hold countdown)
//   CAPTURED         → "Building your escape" (flight pool progress ring)
//   CONFIRMED        → "Escape locked" (dark executive boarding pass + 4-leg timeline)
//   EN_ROUTE_DEPART  → "Driver en route" (Trinidad driver coming)
//   ON_ISLAND        → "You're here" (villa info + add-ons)
//   EN_ROUTE_RETURN  → "Heading home" (return driver info)
//   COMPLETED        → "Trip complete"

type Nav = NativeStackNavigationProp<RootStackParamList, 'ActivePass'>;

const PHASE_LABELS: Record<string, string> = {
  ACTIVE_HOLD:      'Securing your seats',
  CAPTURED:         'Building your escape',
  CONFIRMED:        'Escape locked',
  EN_ROUTE_DEPART:  'Driver en route',
  ON_ISLAND:        "You're here",
  EN_ROUTE_RETURN:  'Heading home',
  COMPLETED:        'Trip complete',
};

const LEG_ICONS: Record<string, string> = {
  GROUND_TRANSIT: '🚗',
  AVIATION:       '✈️',
  LODGING:        '🏡',
};

const LEG_STATUS_COLOR: Record<string, string> = {
  scheduled:        '#333',
  driver_en_route:  '#C8A96E',
  in_transit:       '#3B82F6',
  completed:        '#22C55E',
  delayed:          '#F59E0B',
  cancelled:        '#EF4444',
};

export default function ActivePassScreen() {
  const navigation = useNavigation<Nav>();
  const { activeTrip, loading, refreshTrip } = useEscapeTrip();
  const [countdown, setCountdown] = useState('');
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Pulse animation for active phases
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

  // Hold countdown (10-min window for ACTIVE_HOLD)
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

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#C8A96E" />
      </View>
    );
  }

  if (!activeTrip) {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyTitle}>No active escape</Text>
        <Text style={styles.emptySub}>Book a G Escape package to see your trip here.</Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.backBtnText}>Browse Escapes</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const status = activeTrip.status;
  const pkg = activeTrip.escape_packages;
  const itin = activeTrip.master_escape_itineraries;
  const fb = pkg?.flight_blocks;
  const phaseLabel = PHASE_LABELS[status] ?? status;

  const fmt = (cents: number) => `TTD ${(cents / 100).toFixed(2)}`;
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

  const handleShare = async () => {
    await Share.share({
      message: `I just booked a G Escape to ${fb?.destination_name ?? 'the Caribbean'}! Join me and help lock this flight — ${seatsLeft} seat${seatsLeft !== 1 ? 's' : ''} to go. #GEscape`,
    });
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* Phase badge */}
        <View style={styles.phaseBadge}>
          <Animated.View style={[styles.phaseDot, { transform: [{ scale: pulseAnim }] }]} />
          <Text style={styles.phaseText}>{phaseLabel.toUpperCase()}</Text>
        </View>

        {/* Destination title */}
        <Text style={styles.destination}>{fb?.destination_name ?? pkg?.lodging_nodes?.destination_code}</Text>
        <Text style={styles.pkgName}>{pkg?.package_name}</Text>
        {fb?.departure_time && (
          <Text style={styles.departure}>{fmtDate(fb.departure_time)} at {fmtTime(fb.departure_time)}</Text>
        )}

        {/* ── PHASE: ACTIVE_HOLD ── */}
        {status === 'ACTIVE_HOLD' && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Seat hold active</Text>
            <Text style={styles.holdCountdown}>{countdown}</Text>
            <Text style={styles.cardSub}>Complete payment before the hold expires to secure your seats.</Text>
            <Text style={styles.cardSub2}>Total: {fmt(activeTrip.total_price_cents)} · {activeTrip.guest_count} guest{activeTrip.guest_count !== 1 ? 's' : ''}</Text>
          </View>
        )}

        {/* ── PHASE: CAPTURED (pooling) ── */}
        {status === 'CAPTURED' && fb && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Flight pooling</Text>
            <View style={styles.poolRow}>
              <Text style={styles.poolFraction}>{fb.allocated_seats} / {fb.tipping_point_seats}</Text>
              <Text style={styles.poolSub}>seats filled</Text>
            </View>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${poolPct}%` as any }]} />
            </View>
            <Text style={styles.poolNeed}>
              {seatsLeft > 0
                ? `${seatsLeft} more seat${seatsLeft !== 1 ? 's' : ''} to lock this flight`
                : '✓ Tipping point reached'}
            </Text>
            {seatsLeft > 0 && (
              <TouchableOpacity style={styles.shareBtn} onPress={handleShare}>
                <Text style={styles.shareBtnText}>Invite friends to help lock this flight →</Text>
              </TouchableOpacity>
            )}
            {fb.cancel_deadline && (
              <Text style={styles.deadlineNote}>
                Pool closes {fmtDate(fb.cancel_deadline)}
              </Text>
            )}
          </View>
        )}

        {/* ── PHASE: CONFIRMED — executive boarding pass ── */}
        {(status === 'CONFIRMED' || status === 'EN_ROUTE_DEPART' || status === 'ON_ISLAND' || status === 'EN_ROUTE_RETURN') && (
          <View style={styles.boardingPass}>
            <View style={styles.bpHeader}>
              <View>
                <Text style={styles.bpAirport}>POS</Text>
                <Text style={styles.bpCity}>Piarco</Text>
              </View>
              <Text style={styles.bpArrow}>✈</Text>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.bpAirport}>{fb?.destination_code ?? 'TAB'}</Text>
                <Text style={styles.bpCity}>{fb?.destination_name?.split(' ')[0] ?? 'Destination'}</Text>
              </View>
            </View>
            <View style={styles.bpDivider}>
              <View style={styles.bpNotch} />
              <View style={styles.bpLine} />
              <View style={[styles.bpNotch, { right: -8, left: undefined }]} />
            </View>
            <View style={styles.bpBody}>
              <View style={styles.bpField}>
                <Text style={styles.bpFieldLabel}>BOOKING REF</Text>
                <Text style={styles.bpFieldValue}>{activeTrip.booking_ref ?? '—'}</Text>
              </View>
              <View style={styles.bpField}>
                <Text style={styles.bpFieldLabel}>GUESTS</Text>
                <Text style={styles.bpFieldValue}>{activeTrip.guest_count}</Text>
              </View>
              {fb?.departure_time && (
                <View style={styles.bpField}>
                  <Text style={styles.bpFieldLabel}>DEPARTURE</Text>
                  <Text style={styles.bpFieldValue}>{fmtDate(fb.departure_time)}</Text>
                </View>
              )}
              {itin?.qr_code_token && (
                <View style={[styles.bpField, { flex: 1, alignItems: 'center', marginTop: 12 }]}>
                  <View style={styles.qrPlaceholder}>
                    <Text style={styles.qrToken}>{itin.qr_code_token}</Text>
                    <Text style={styles.qrSub}>Present at gate</Text>
                  </View>
                </View>
              )}
            </View>
          </View>
        )}

        {/* ── 4-leg journey timeline (shown once CONFIRMED) ── */}
        {itin?.itinerary_legs && itin.itinerary_legs.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Your journey</Text>
            {itin.itinerary_legs.map((leg, idx) => (
              <LegRow key={leg.id} leg={leg} isLast={idx === itin.itinerary_legs.length - 1} />
            ))}
          </View>
        )}

        {/* ── PHASE: ON_ISLAND extras ── */}
        {status === 'ON_ISLAND' && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>You're on island</Text>
            <Text style={styles.onIslandText}>
              {pkg?.lodging_nodes?.name} is ready for you.
              Your driver is confirmed and on the way to the arrivals terminal.
            </Text>
            <View style={styles.addOnRow}>
              <Text style={styles.addOnLabel}>Jet ski excursion</Text>
              <Text style={styles.addOnCta}>Add →</Text>
            </View>
            <View style={styles.addOnRow}>
              <Text style={styles.addOnLabel}>Private chef dinner</Text>
              <Text style={styles.addOnCta}>Add →</Text>
            </View>
          </View>
        )}

        {/* Booking reference footer */}
        <View style={styles.footer}>
          <Text style={styles.footerRef}>Ref {activeTrip.booking_ref ?? '—'}</Text>
          <Text style={styles.footerSub}>G Escape · {fmt(activeTrip.total_price_cents)}</Text>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
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
  };

  const label = leg.reference_code
    ? LEG_LABELS[leg.reference_code] ?? leg.reference_code
    : leg.service_type === 'AVIATION' ? 'Flight' : leg.service_type;

  return (
    <View style={styles.legRow}>
      <View style={styles.legLeft}>
        <View style={[styles.legDot, { backgroundColor: LEG_STATUS_COLOR[leg.status] ?? '#333' }]} />
        {!isLast && <View style={styles.legLine} />}
      </View>
      <View style={styles.legContent}>
        <Text style={styles.legIcon}>{LEG_ICONS[leg.service_type]}</Text>
        <View style={styles.legInfo}>
          <Text style={styles.legLabel}>{label}</Text>
          {leg.scheduled_start && (
            <Text style={styles.legTime}>{fmtTime(leg.scheduled_start)}</Text>
          )}
        </View>
        <View style={[styles.legStatusBadge, { backgroundColor: LEG_STATUS_COLOR[leg.status] + '22' }]}>
          <Text style={[styles.legStatusText, { color: LEG_STATUS_COLOR[leg.status] }]}>
            {leg.status.replace('_', ' ')}
          </Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  safe:            { flex: 1, backgroundColor: '#0C0C0F' },
  scroll:          { flex: 1, paddingHorizontal: 20 },
  centered:        { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0C0C0F', padding: 30 },
  emptyTitle:      { color: '#FFF', fontSize: 20, fontWeight: '600', marginBottom: 8 },
  emptySub:        { color: '#555', fontSize: 14, textAlign: 'center', lineHeight: 20 },
  backBtn:         { marginTop: 24, backgroundColor: '#C8A96E', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8 },
  backBtnText:     { color: '#000', fontWeight: '700' },

  phaseBadge:      { flexDirection: 'row', alignItems: 'center', marginTop: 24, marginBottom: 8, gap: 8 },
  phaseDot:        { width: 8, height: 8, borderRadius: 4, backgroundColor: '#C8A96E' },
  phaseText:       { color: '#C8A96E', fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  destination:     { fontSize: 30, fontWeight: '700', color: '#FFF', letterSpacing: -0.5 },
  pkgName:         { fontSize: 15, color: '#888', marginTop: 2 },
  departure:       { fontSize: 13, color: '#555', marginTop: 2, marginBottom: 20 },

  card:            { backgroundColor: '#141418', borderRadius: 14, padding: 18, marginBottom: 16,
                     borderWidth: 1, borderColor: '#1E1E26' },
  cardTitle:       { color: '#C8A96E', fontSize: 11, fontWeight: '700', letterSpacing: 1,
                     textTransform: 'uppercase', marginBottom: 14 },
  cardSub:         { color: '#666', fontSize: 13, marginTop: 8 },
  cardSub2:        { color: '#888', fontSize: 13, marginTop: 4, fontWeight: '600' },

  holdCountdown:   { color: '#FFF', fontSize: 48, fontWeight: '200', letterSpacing: -2, marginVertical: 8 },

  poolRow:         { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 12 },
  poolFraction:    { color: '#FFF', fontSize: 28, fontWeight: '700' },
  poolSub:         { color: '#555', fontSize: 14 },
  progressTrack:   { height: 4, backgroundColor: '#1E1E26', borderRadius: 2, overflow: 'hidden', marginBottom: 10 },
  progressFill:    { height: 4, backgroundColor: '#C8A96E', borderRadius: 2 },
  poolNeed:        { color: '#777', fontSize: 12 },
  shareBtn:        { marginTop: 14, backgroundColor: '#1A1A24', borderRadius: 8, paddingVertical: 12,
                     alignItems: 'center', borderWidth: 1, borderColor: '#2D2D40' },
  shareBtnText:    { color: '#C8A96E', fontWeight: '600', fontSize: 13 },
  deadlineNote:    { color: '#3A3A50', fontSize: 11, marginTop: 10, textAlign: 'center' },

  // Boarding pass
  boardingPass:    { backgroundColor: '#0F1018', borderRadius: 14, marginBottom: 16, overflow: 'hidden',
                     borderWidth: 1, borderColor: '#2A2A3A' },
  bpHeader:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
                     paddingHorizontal: 20, paddingVertical: 20 },
  bpAirport:       { color: '#FFF', fontSize: 26, fontWeight: '200', letterSpacing: 2 },
  bpCity:          { color: '#444', fontSize: 11 },
  bpArrow:         { color: '#C8A96E', fontSize: 22 },
  bpDivider:       { height: 1, backgroundColor: '#1E1E2E', marginHorizontal: 0, position: 'relative' },
  bpNotch:         { position: 'absolute', left: -8, top: -8, width: 16, height: 16,
                     borderRadius: 8, backgroundColor: '#0C0C0F' },
  bpLine:          { borderTopWidth: 1, borderTopColor: '#1E1E2E', borderStyle: 'dashed', flex: 1 },
  bpBody:          { padding: 20, flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  bpField:         { minWidth: 90 },
  bpFieldLabel:    { color: '#333', fontSize: 9, fontWeight: '700', letterSpacing: 1,
                     textTransform: 'uppercase', marginBottom: 4 },
  bpFieldValue:    { color: '#CCC', fontSize: 14, fontWeight: '600' },
  qrPlaceholder:   { backgroundColor: '#111', borderRadius: 10, padding: 16, alignItems: 'center',
                     borderWidth: 1, borderColor: '#222' },
  qrToken:         { color: '#C8A96E', fontSize: 18, fontWeight: '700', letterSpacing: 4, fontFamily: 'monospace' },
  qrSub:           { color: '#333', fontSize: 10, marginTop: 4 },

  // Leg timeline
  legRow:          { flexDirection: 'row', marginBottom: 4 },
  legLeft:         { width: 20, alignItems: 'center' },
  legDot:          { width: 10, height: 10, borderRadius: 5, marginTop: 4 },
  legLine:         { width: 2, flex: 1, backgroundColor: '#1E1E26', marginTop: 4, marginBottom: -4 },
  legContent:      { flex: 1, flexDirection: 'row', alignItems: 'flex-start', paddingBottom: 18,
                     paddingLeft: 10, gap: 8 },
  legIcon:         { fontSize: 16, marginTop: 2 },
  legInfo:         { flex: 1 },
  legLabel:        { color: '#CCC', fontSize: 13, fontWeight: '500' },
  legTime:         { color: '#555', fontSize: 11, marginTop: 2 },
  legStatusBadge:  { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  legStatusText:   { fontSize: 10, fontWeight: '600', textTransform: 'uppercase' },

  // On-island add-ons
  onIslandText:    { color: '#888', fontSize: 14, lineHeight: 20, marginBottom: 14 },
  addOnRow:        { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12,
                     borderTopWidth: 1, borderTopColor: '#1E1E26' },
  addOnLabel:      { color: '#CCC', fontSize: 14 },
  addOnCta:        { color: '#C8A96E', fontSize: 13, fontWeight: '600' },

  footer:          { alignItems: 'center', paddingVertical: 20 },
  footerRef:       { color: '#333', fontSize: 12, fontFamily: 'monospace', letterSpacing: 2 },
  footerSub:       { color: '#2A2A35', fontSize: 11, marginTop: 2 },
});
