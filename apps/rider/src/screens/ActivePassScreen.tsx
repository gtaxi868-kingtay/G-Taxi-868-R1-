import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Share, Animated, SafeAreaView, ActivityIndicator, Linking, Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { supabase } from '@gtaxi/core';
import type { AppStackParamList } from '../navigation/types';
import { useEscapeTrip, ItineraryLeg } from '../context/EscapeContext';
import { Ionicons } from '@expo/vector-icons';

const BRAND = '#1DE0E6';

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
  scheduled:        'rgba(255,255,255,0.2)',
  driver_en_route:  BRAND,
  in_transit:       '#38BDF8',
  completed:        '#22C55E',
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

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={BRAND} />
      </View>
    );
  }

  if (!activeTrip) {
    return (
      <View style={styles.centered}>
        <Ionicons name="airplane-outline" size={48} color="rgba(255,255,255,0.15)" />
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
          onPress: () => {
            const dest = fb?.destination_name ?? 'your destination';
            Linking.openURL(
              `whatsapp://send?phone=18683000000&text=${encodeURIComponent(`Hi, I'm on G Escape to ${dest} (ref: ${activeTrip?.booking_ref ?? ''}) and I'd like to book: ${label}`)}`
            ).catch(() => Alert.alert('WhatsApp not found', 'Please contact your G-Taxi concierge directly.'));
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.phaseBadge}>
          <Animated.View style={[styles.phaseDot, { transform: [{ scale: pulseAnim }] }]} />
          <Text style={styles.phaseText}>{phaseLabel}</Text>
        </View>

        <Text style={styles.destination}>{fb?.destination_name ?? pkg?.lodging_nodes?.destination_code}</Text>
        <Text style={styles.pkgName}>{pkg?.package_name}</Text>
        {fb?.departure_time && (
          <Text style={styles.departure}>{fmtDate(fb.departure_time)} at {fmtTime(fb.departure_time)}</Text>
        )}

        {status === 'ACTIVE_HOLD' && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Seat hold active</Text>
            <Text style={styles.holdCountdown}>{countdown}</Text>
            <Text style={styles.cardSub}>Complete payment before the hold expires to secure your seats.</Text>
            <Text style={styles.cardSub2}>Total: {fmt(activeTrip.total_price_cents)} · {activeTrip.guest_count} guest{activeTrip.guest_count !== 1 ? 's' : ''}</Text>
          </View>
        )}

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
              <View style={{ gap: 8, marginTop: 14 }}>
                <TouchableOpacity style={styles.shareBtn} onPress={handleShare}>
                  <Text style={styles.shareBtnText}>Share link to lock this flight →</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.waBtn} onPress={handleWhatsAppShare}>
                  <Ionicons name="logo-whatsapp" size={14} color="#25D366" />
                  <Text style={styles.waBtnText}>Send on WhatsApp</Text>
                </TouchableOpacity>
              </View>
            )}
            {fb.cancel_deadline && (
              <Text style={styles.deadlineNote}>
                Pool closes {fmtDate(fb.cancel_deadline)}
              </Text>
            )}
          </View>
        )}

        {(status === 'CONFIRMED' || status === 'EN_ROUTE_DEPART' || status === 'ON_ISLAND' || status === 'EN_ROUTE_RETURN') && (
          <View style={styles.boardingPass}>
            <View style={styles.bpHeader}>
              <View>
                <Text style={styles.bpAirport}>POS</Text>
                <Text style={styles.bpCity}>Piarco</Text>
              </View>
              <Ionicons name="airplane-outline" size={22} color={BRAND} />
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

        {status === 'CONFIRMED' && participantId && (
          <TouchableOpacity
            style={styles.passportCta}
            onPress={() => navigation.navigate('PassportSubmission', { participantId })}
            activeOpacity={0.8}
          >
            <Ionicons name="document-text-outline" size={20} color={BRAND} />
            <View style={styles.passportCtaTextWrap}>
              <Text style={styles.passportCtaTitle}>Submit Passport Details</Text>
              <Text style={styles.passportCtaSub}>Required for airline check-in</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={BRAND} />
          </TouchableOpacity>
        )}

        {itin?.itinerary_legs && itin.itinerary_legs.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Your journey</Text>
            {itin.itinerary_legs.map((leg, idx) => (
              <LegRow key={leg.id} leg={leg} isLast={idx === itin.itinerary_legs.length - 1} />
            ))}
          </View>
        )}

        {status === 'ON_ISLAND' && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>You're on island</Text>
            <Text style={styles.onIslandText}>
              {pkg?.lodging_nodes?.name} is ready for you.
              Your driver is confirmed and on the way to the arrivals terminal.
            </Text>
            <TouchableOpacity style={styles.addOnRow} onPress={() => handleAddOn('Jet ski excursion')}>
              <Text style={styles.addOnLabel}>Jet ski excursion</Text>
              <Ionicons name="chevron-forward" size={14} color={BRAND} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.addOnRow} onPress={() => handleAddOn('Private chef dinner')}>
              <Text style={styles.addOnLabel}>Private chef dinner</Text>
              <Ionicons name="chevron-forward" size={14} color={BRAND} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.addOnRow} onPress={() => handleAddOn('Island tour (half day)')}>
              <Text style={styles.addOnLabel}>Island tour (half day)</Text>
              <Ionicons name="chevron-forward" size={14} color={BRAND} />
            </TouchableOpacity>
          </View>
        )}

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
        <View style={[styles.legDot, { backgroundColor: LEG_STATUS_COLOR[leg.status] ?? 'rgba(255,255,255,0.2)' }]} />
        {!isLast && <View style={styles.legLine} />}
      </View>
      <View style={styles.legContent}>
        <Ionicons name={LEG_ICON_NAMES[leg.service_type] ?? 'ellipse-outline'} size={16} color={BRAND} />
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
  safe:            { flex: 1, backgroundColor: '#0B0E12' },
  scroll:          { flex: 1, paddingHorizontal: 20 },
  centered:        { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0B0E12', padding: 30 },
  emptyTitle:      { color: '#F2F5F8', fontSize: 20, fontWeight: '700', marginBottom: 8 },
  emptySub:        { color: 'rgba(242,245,248,0.42)', fontSize: 14, textAlign: 'center', lineHeight: 20 },
  backBtn:         { marginTop: 24, backgroundColor: BRAND, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 14 },
  backBtnText:     { color: '#0B0E12', fontWeight: '700' },

  phaseBadge:      { flexDirection: 'row', alignItems: 'center', marginTop: 24, marginBottom: 8, gap: 8 },
  phaseDot:        { width: 8, height: 8, borderRadius: 4, backgroundColor: BRAND },
  phaseText:       { color: BRAND, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  destination:     { fontSize: 30, fontWeight: '800', color: '#F2F5F8', letterSpacing: -0.5 },
  pkgName:         { fontSize: 15, color: 'rgba(242,245,248,0.6)', marginTop: 2 },
  departure:       { fontSize: 13, color: 'rgba(242,245,248,0.42)', marginTop: 2, marginBottom: 20 },

  card:            { backgroundColor: '#13171D', borderRadius: 16, padding: 18, marginBottom: 16,
                     borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  cardTitle:       { color: BRAND, fontSize: 11, fontWeight: '700', letterSpacing: 0.5,
                     textTransform: 'uppercase', marginBottom: 14 },
  cardSub:         { color: 'rgba(242,245,248,0.5)', fontSize: 13, marginTop: 8 },
  cardSub2:        { color: 'rgba(242,245,248,0.6)', fontSize: 13, marginTop: 4, fontWeight: '600' },

  holdCountdown:   { color: '#F2F5F8', fontSize: 48, fontWeight: '200', letterSpacing: -2, marginVertical: 8 },

  poolRow:         { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 12 },
  poolFraction:    { color: '#F2F5F8', fontSize: 28, fontWeight: '700' },
  poolSub:         { color: 'rgba(242,245,248,0.42)', fontSize: 14 },
  progressTrack:   { height: 4, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden', marginBottom: 10 },
  progressFill:    { height: 4, backgroundColor: BRAND, borderRadius: 2 },
  poolNeed:        { color: 'rgba(242,245,248,0.5)', fontSize: 12 },
  shareBtn:        { backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 12, paddingVertical: 12,
                     alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  shareBtnText:    { color: BRAND, fontWeight: '600', fontSize: 13 },
  waBtn:           { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
                     backgroundColor: 'rgba(37,211,102,0.08)', borderRadius: 12, paddingVertical: 12,
                     borderWidth: 1, borderColor: 'rgba(37,211,102,0.2)' },
  waBtnText:       { color: '#25D366', fontWeight: '600', fontSize: 13 },
  deadlineNote:    { color: 'rgba(242,245,248,0.25)', fontSize: 11, marginTop: 10, textAlign: 'center' },

  passportCta:     { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(29,224,230,0.06)',
                     borderRadius: 14, padding: 16, marginBottom: 16, gap: 12,
                     borderWidth: 1, borderColor: 'rgba(29,224,230,0.15)' },
  passportCtaTextWrap: { flex: 1 },
  passportCtaTitle: { color: '#F2F5F8', fontSize: 14, fontWeight: '700' },
  passportCtaSub:  { color: 'rgba(242,245,248,0.42)', fontSize: 11, marginTop: 2 },

  boardingPass:    { backgroundColor: '#0F1115', borderRadius: 16, marginBottom: 16, overflow: 'hidden',
                     borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  bpHeader:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
                     paddingHorizontal: 20, paddingVertical: 20 },
  bpAirport:       { color: '#F2F5F8', fontSize: 26, fontWeight: '200', letterSpacing: 2 },
  bpCity:          { color: 'rgba(242,245,248,0.35)', fontSize: 11 },
  bpDivider:       { height: 1, marginHorizontal: 0, position: 'relative' },
  bpNotch:         { position: 'absolute', left: -8, top: -8, width: 16, height: 16,
                     borderRadius: 8, backgroundColor: '#0B0E12' },
  bpLine:          { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)', borderStyle: 'dashed', flex: 1 },
  bpBody:          { padding: 20, flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  bpField:         { minWidth: 90 },
  bpFieldLabel:    { color: 'rgba(242,245,248,0.3)', fontSize: 9, fontWeight: '700', letterSpacing: 1,
                     textTransform: 'uppercase', marginBottom: 4 },
  bpFieldValue:    { color: 'rgba(242,245,248,0.7)', fontSize: 14, fontWeight: '600' },
  qrPlaceholder:   { backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 12, padding: 16, alignItems: 'center',
                     borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  qrToken:         { color: BRAND, fontSize: 18, fontWeight: '700', letterSpacing: 4, fontFamily: 'monospace' },
  qrSub:           { color: 'rgba(242,245,248,0.25)', fontSize: 10, marginTop: 4 },

  legRow:          { flexDirection: 'row', marginBottom: 4 },
  legLeft:         { width: 20, alignItems: 'center' },
  legDot:          { width: 10, height: 10, borderRadius: 5, marginTop: 4 },
  legLine:         { width: 2, flex: 1, backgroundColor: 'rgba(255,255,255,0.06)', marginTop: 4, marginBottom: -4 },
  legContent:      { flex: 1, flexDirection: 'row', alignItems: 'flex-start', paddingBottom: 18,
                     paddingLeft: 10, gap: 8 },
  legInfo:         { flex: 1 },
  legLabel:        { color: 'rgba(242,245,248,0.7)', fontSize: 13, fontWeight: '500' },
  legTime:         { color: 'rgba(242,245,248,0.35)', fontSize: 11, marginTop: 2 },
  legStatusBadge:  { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  legStatusText:   { fontSize: 10, fontWeight: '600', textTransform: 'uppercase' },

  onIslandText:    { color: 'rgba(242,245,248,0.5)', fontSize: 14, lineHeight: 20, marginBottom: 14 },
  addOnRow:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12,
                     borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.04)' },
  addOnLabel:      { color: 'rgba(242,245,248,0.6)', fontSize: 14 },

  footer:          { alignItems: 'center', paddingVertical: 20 },
  footerRef:       { color: 'rgba(242,245,248,0.2)', fontSize: 12, fontFamily: 'monospace', letterSpacing: 2 },
  footerSub:       { color: 'rgba(242,245,248,0.15)', fontSize: 11, marginTop: 2 },
});
