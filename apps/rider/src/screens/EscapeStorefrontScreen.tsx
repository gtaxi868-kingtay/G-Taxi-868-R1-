import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, FlatList, Pressable, RefreshControl, Image, Alert, Modal } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@gtaxi/core';
import type { AppStackParamList } from '../navigation/types';
import { useEscapeTrip } from '../context/EscapeContext';
import { usePlatformFlags } from '../hooks/usePlatformFlags';
import { toast } from '../components/Toast';
import { BRAND_GRADIENT, Button, Card, Chip, EmptyState, GUTTER, Header, IconButton, Loading, RADIUS, Row, Section, SPACE, Txt, useTheme } from '../ui/kit';

type Nav = NativeStackNavigationProp<AppStackParamList, 'EscapeStorefront'>;

interface EscapePackageCard {
  id: string;
  package_name: string;
  cover_image_url: string | null;
  tagline: string | null;
  price_per_person_cents: number;
  max_total_guests: number;
  allocated_guests: number;
  flight_blocks: {
    destination_name: string;
    destination_code: string;
    departure_time: string;
    return_time: string | null;
    tipping_point_seats: number;
    allocated_seats: number;
    cancel_deadline: string | null;
    status: string;
  } | null;
  lodging_nodes: {
    name: string;
    nights: number;
  } | null;
}

interface MyEscapeBooking {
  id: string;
  escape_package_id: string;
  status: string;
  guest_count: number;
  total_price_cents: number;
  booking_ref: string | null;
  escape_packages: {
    package_name: string;
    flight_blocks: { destination_name: string; departure_time: string } | null;
  } | null;
}

// package_reservations statuses (live CHECK constraint, verified 2026-10-09).
// "Live" = the rider still holds or is using these seats; the rest are history.
const LIVE_BOOKING_STATUSES = new Set([
  'PENDING_HOLD', 'ACTIVE_HOLD', 'CAPTURED', 'CONFIRMED',
  'EN_ROUTE_DEPART', 'ON_ISLAND', 'EN_ROUTE_RETURN',
]);

const BOOKING_STATUS_LABEL: Record<string, string> = {
  PENDING_HOLD: 'Holding your seats',
  ACTIVE_HOLD: 'Seats held — waiting on the crew',
  CAPTURED: 'Paid — waiting on the crew',
  CONFIRMED: 'Confirmed',
  EN_ROUTE_DEPART: 'On the way out',
  ON_ISLAND: 'On island',
  EN_ROUTE_RETURN: 'Heading home',
  COMPLETED: 'Completed',
  RELEASED: 'Released',
  CANCELLED: 'Cancelled',
};

const GUEST_OPTIONS = [1, 2, 3, 4];

const DEST_EXPERIENCES: Record<string, { tagline: string; highlights: [string, string, string] }> = {
  BGI: { tagline: 'The island that makes every other island jealous', highlights: ['Crystal-clear south coast beaches', 'Crop Over festival energy year-round', 'Bridgetown duty-free dining scene'] },
  GND: { tagline: 'The undiscovered one — before everyone finds out', highlights: ['Grand Etang rainforest crater lake', 'Grenada chocolate straight from the estate', 'Underwater sculpture park at Molinere'] },
  TAB: { tagline: 'Your next move is 20 minutes by air', highlights: ['Buccoo Reef glass-bottom boat tours', 'Pigeon Point beach, sun-lounger ready', 'Sunday School street party in Buccoo'] },
  ANU: { tagline: '365 beaches. You\'ve seen none of them yet', highlights: ['English Harbour\'s colonial-era dockyard', 'Half Moon Bay — the most photographed beach in the Caribbean', 'Shirley Heights Sunday sunset BBQ'] },
  SKB: { tagline: 'Caribbean with no attitude. Just your kind of pace', highlights: ['Brimstone Hill Fortress — Caribbean\'s Gibraltar', 'Nevis Peak rainforest day hike', 'Black sand Cockleshell Beach with dual-island views'] },
  SLU: { tagline: 'The Pitons are on every Caribbean bucket list for a reason', highlights: ['Sulfur springs — drive-in volcano', 'Marigot Bay — the most beautiful bay in the Caribbean', 'Rainforest aerial tram over the canopy'] },
};

// Lanes riders can raise their hand for. Enough hands (60% of a typical block)
// files a demand case in the admin approvals inbox — the mechanic that turns
// "no flights to X" into a negotiable airline block.
const LANE_DESTINATIONS: Array<{ code: string; name: string }> = [
  { code: 'BGI', name: 'Barbados' },
  { code: 'SLU', name: 'St. Lucia' },
  { code: 'GND', name: 'Grenada' },
  { code: 'ANU', name: 'Antigua' },
  { code: 'SKB', name: 'St. Kitts' },
  { code: 'SVD', name: 'St. Vincent' },
  { code: 'DOM', name: 'Dominica' },
];

function nextMonths(count: number): Array<{ value: string; label: string }> {
  const out: Array<{ value: string; label: string }> = [];
  const d = new Date();
  for (let i = 1; i <= count; i++) {
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + i, 1));
    out.push({
      value: m.toISOString().slice(0, 10),
      label: m.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }),
    });
  }
  return out;
}

type RouteT = RouteProp<AppStackParamList, 'EscapeStorefront'>;

export default function EscapeStorefrontScreen() {
  // 'airline_active' and 'hotel_active' on the admin's Platform Control page.
  const { flags } = usePlatformFlags();
  const navigation = useNavigation<Nav>();
  const route = useRoute<RouteT>();
  const deepLinkPkgId = (route.params as any)?.packageId as string | undefined;
  const { activeTrip } = useEscapeTrip();

  const [packages, setPackages] = useState<EscapePackageCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedPackage, setSelectedPackage] = useState<EscapePackageCard | null>(null);
  const [guestCount, setGuestCount] = useState(1);
  const [showGuestPicker, setShowGuestPicker] = useState(false);
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [joinedPkgIds, setJoinedPkgIds] = useState<Set<string>>(new Set());
  const [joiningPkgId, setJoiningPkgId] = useState<string | null>(null);
  const [myBookings, setMyBookings] = useState<MyEscapeBooking[]>([]);

  // Lane interest ("open a route we don't fly yet")
  const [myLanes, setMyLanes] = useState<any[]>([]);
  const [laneDest, setLaneDest] = useState<string | null>(null);
  const [laneMonth, setLaneMonth] = useState<string | null>(null);
  const [laneParty, setLaneParty] = useState(2);
  const [laneSubmitting, setLaneSubmitting] = useState(false);
  const laneMonths = React.useMemo(() => nextMonths(6), []);

  const loadMyLanes = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;
      const { data } = await supabase
        .from('escape_lane_interest')
        .select('id, destination_code, destination_name, travel_month, party_size')
        // RLS already scopes this to the signed-in rider (verified: policy
        // eli_select_own USING rider_id = auth.uid()). Filtering explicitly
        // too so the query states its own intent and does not depend solely
        // on a policy living in another system.
        .eq('rider_id', session.user.id)
        .gte('travel_month', new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString().slice(0, 10))
        .order('travel_month', { ascending: true });
      setMyLanes(data ?? []);
    } catch { /* non-fatal */ }
  }, []);

  useEffect(() => { loadMyLanes(); }, [loadMyLanes]);

  const joinLane = async () => {
    if (!laneDest || !laneMonth) {
      toast('Choose an island and a month first.', 'error');
      return;
    }
    setLaneSubmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        toast('Please sign in first.', 'error');
        return;
      }
      const dest = LANE_DESTINATIONS.find(d => d.code === laneDest)!;
      const { error } = await supabase.from('escape_lane_interest').insert({
        rider_id: session.user.id,
        destination_code: dest.code,
        destination_name: dest.name,
        travel_month: laneMonth,
        party_size: laneParty,
      });
      if (error) {
        if ((error as any).code === '23505') {
          toast(`You're already on the list for ${dest.name} that month.`);
        } else {
          toast(error.message, 'error');
        }
        return;
      }
      // In-app receipt in the notification centre (type must be 'escape')
      const monthLabel = laneMonths.find(m => m.value === laneMonth)?.label ?? laneMonth;
      supabase.rpc('notify_user', {
        p_user_id: session.user.id,
        p_type: 'escape',
        p_title: `You're on the list: ${dest.name}`,
        p_body: `Holding ${laneParty} seat${laneParty !== 1 ? 's' : ''} for ${monthLabel}. We'll alert you the moment this route opens.`,
      }).then(null, () => null);
      setLaneDest(null);
      setLaneMonth(null);
      setLaneParty(2);
      toast(`You're on the list for ${dest.name}.`, 'success');
      loadMyLanes();
    } finally {
      setLaneSubmitting(false);
    }
  };

  const leaveLane = async (id: string) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return;
    // The error was previously discarded entirely — when this delete was
    // being refused (missing table GRANT), the row silently stayed and the
    // rider was told nothing. Ownership is enforced by RLS; the explicit
    // rider_id filter states the same intent locally.
    const { error } = await supabase
      .from('escape_lane_interest')
      .delete()
      .eq('id', id)
      .eq('rider_id', session.user.id);
    if (error) {
      toast('Could not leave the list: ' + error.message, 'error');
      return;
    }
    loadMyLanes();
  };

  useEffect(() => {
    loadPackages();
    Location.getForegroundPermissionsAsync().then(({ status }) => {
      if (status === 'granted') {
        Location.getCurrentPositionAsync({}).then(pos => {
          setUserLocation({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
        }).catch(() => {});
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!deepLinkPkgId || packages.length === 0) return;
    const target = packages.find(p => p.id === deepLinkPkgId);
    if (target) handleJoinPool(target);
  }, [deepLinkPkgId, packages]);

  const loadPackages = useCallback(async () => {
    setLoadError(null);
    try {
      const { data, error } = await supabase
        .from('escape_packages')
        .select(`
          id,
          package_name,
          cover_image_url,
          tagline,
          price_per_person_cents,
          max_total_guests,
          allocated_guests,
          flight_blocks (
            destination_name,
            destination_code,
            departure_time,
            return_time,
            tipping_point_seats,
            allocated_seats,
            cancel_deadline,
            status
          ),
          lodging_nodes ( name, nights )
        `)
        .eq('is_active', true)
        .in('flight_blocks.status', ['POOLING', 'CONFIRMED'])
        .order('created_at', { ascending: false });

      if (!error && data) {
        const valid = (data as any[]).filter(p => {
          const fb = Array.isArray(p.flight_blocks) ? p.flight_blocks[0] : p.flight_blocks;
          if (!fb) return false;
          if (fb.status === 'CANCELLED') return false;
          if (new Date(fb.departure_time) < new Date()) return false;
          return true;
        });
        setPackages(valid as EscapePackageCard[]);
      }

      // The rider's own bookings. This used to read escape_group_participants
      // -- the older, disconnected G-Escape system that checkout no longer
      // writes to -- so "Joined" could never light up for a real booking.
      // Checkout (travel/book_escape) writes package_reservations, so that is
      // the source here. It also feeds "Your escapes", which replaced the
      // separate Travel "My Bookings" screen when Travel merged into Escape.
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        const { data: reservations } = await supabase
          .from('package_reservations')
          .select(`
            id,
            escape_package_id,
            status,
            guest_count,
            total_price_cents,
            booking_ref,
            escape_packages (
              package_name,
              flight_blocks ( destination_name, departure_time )
            )
          `)
          .eq('rider_id', session.user.id)
          .order('created_at', { ascending: false })
          .limit(20);
        const rows = ((reservations ?? []) as any[]).map(r => {
          const pkg = Array.isArray(r.escape_packages) ? r.escape_packages[0] : r.escape_packages;
          const fb = pkg && (Array.isArray(pkg.flight_blocks) ? pkg.flight_blocks[0] : pkg.flight_blocks);
          return { ...r, escape_packages: pkg ? { ...pkg, flight_blocks: fb ?? null } : null } as MyEscapeBooking;
        });
        setMyBookings(rows);
        setJoinedPkgIds(new Set(
          rows.filter(r => LIVE_BOOKING_STATUSES.has(r.status)).map(r => r.escape_package_id),
        ));
      }
    } catch (err) {
      console.error('EscapeStorefront load error:', err);
      setLoadError('Could not load packages. Check your connection and try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Applied HERE and not inside loadPackages: that callback has an empty
  // dependency array, so reading flags in it would freeze them at first render
  // and an admin toggle would never reach the list. Every escape package is
  // built on a flight block, so airline_active off empties the storefront;
  // hotel_active only removes the packages that include lodging.
  const visiblePackages = useMemo(() => {
    if (!flags.airline) return [];
    if (flags.hotel) return packages;
    return packages.filter(p => {
      const ln = Array.isArray((p as any).lodging_nodes)
        ? (p as any).lodging_nodes[0]
        : (p as any).lodging_nodes;
      return !ln;
    });
  }, [packages, flags.airline, flags.hotel]);

  const onRefresh = () => {
    setRefreshing(true);
    loadPackages();
  };

  const handleJoinPool = (pkg: EscapePackageCard) => {
    if (joinedPkgIds.has(pkg.id)) {
      toast("You're already on this trip.");
      return;
    }
    setSelectedPackage(pkg);
    setGuestCount(1);
    setShowGuestPicker(true);
  };

  // Sends the rider to the real checkout instead of silently joining a
  // group for free.
  //
  // This previously called travel/join_escape_group, which writes to
  // escape_group_participants — the OLDER of the two G-Escape systems,
  // and one that takes NO payment. EscapeCheckoutScreen calls
  // travel/book_escape, which writes to package_reservations (the live
  // system the tipping-point sweep and admin approvals actually read)
  // and collects payment via WiPay.
  //
  // Net effect of the old wiring: the only reachable path booked riders
  // into a deprecated table without charging them, while the screen that
  // charges correctly was registered in the navigator but unreachable —
  // nothing anywhere navigated to 'EscapeCheckout'.
  const handleConfirmGuests = async () => {
    if (!selectedPackage) return;
    setShowGuestPicker(false);

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      toast('Please sign in to book.', 'error');
      return;
    }

    // Checkout needs a location for the airport-transfer leg. Fall back
    // to Port of Spain rather than blocking the booking outright — a
    // missing GPS fix must not cost a sale.
    const loc = userLocation ?? { latitude: 10.6549, longitude: -61.5019 };

    navigation.navigate('EscapeCheckout', {
      packageId: selectedPackage.id,
      guestCount,
      userLocation: loc,
    });
  };

  const fmt = (cents: number) => `TT$${((cents || 0) / 100).toFixed(0)}`;
  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-TT', {
    weekday: 'short', day: 'numeric', month: 'short',
  });

  const m = useTheme();
  const insets = useSafeAreaInsets();

  const renderCard = ({ item }: { item: EscapePackageCard }) => {
    const fb = Array.isArray(item.flight_blocks) ? (item.flight_blocks as any[])[0] : item.flight_blocks;
    const ln = Array.isArray(item.lodging_nodes) ? (item.lodging_nodes as any[])[0] : item.lodging_nodes;
    if (!fb) return null;

    const poolPct = Math.min(100, Math.round((fb.allocated_seats / Math.max(1, fb.tipping_point_seats)) * 100));
    const seatsLeft = fb.tipping_point_seats - fb.allocated_seats;
    const isConfirmed = fb.status === 'CONFIRMED';
    const seatsAvailForGuest = item.max_total_guests - item.allocated_guests;
    const alreadyJoined = joinedPkgIds.has(item.id);
    const exp = DEST_EXPERIENCES[fb.destination_code];

    return (
      <Card style={{ padding: 0, overflow: 'hidden', marginBottom: SPACE.lg }}>
        {item.cover_image_url
          ? <Image source={{ uri: item.cover_image_url }} style={{ height: 160, width: '100%' }} />
          : (
            <LinearGradient colors={BRAND_GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ height: 120, alignItems: 'center', justifyContent: 'center' }}>
              <Txt variant="hero" tone="onBrand">{fb.destination_code}</Txt>
            </LinearGradient>
          )}
        <View style={{ padding: SPACE.lg }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Txt variant="label" tone={isConfirmed ? 'success' : 'accent'} style={{ flex: 1 }}>{isConfirmed ? 'Flight confirmed' : 'Filling up'}</Txt>
            {alreadyJoined && <Txt variant="label" tone="success">You're in</Txt>}
          </View>
          <Txt variant="title" style={{ marginTop: SPACE.xs }}>{fb.destination_name}</Txt>
          <Txt variant="body" tone="dim">{item.package_name}</Txt>
          {item.tagline || exp ? <Txt variant="body" style={{ marginTop: SPACE.sm }}>{item.tagline || exp?.tagline}</Txt> : null}
          {exp && exp.highlights.map((h, i) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', marginTop: 4 }}>
              <Txt variant="body" tone="accent">·  </Txt>
              <Txt variant="caption" tone="dim" style={{ flex: 1 }}>{h}</Txt>
            </View>
          ))}
          <Txt variant="caption" tone="dim" style={{ marginTop: SPACE.md }}>
            {[fmtDate(fb.departure_time), ln?.nights ? `${ln.nights} nights` : null, ln?.name].filter(Boolean).join(' · ')}
          </Txt>

          {!isConfirmed && (
            <View style={{ marginTop: SPACE.md }}>
              <View style={{ height: 6, borderRadius: 3, backgroundColor: m.field, overflow: 'hidden' }}>
                <View style={{ height: 6, width: `${poolPct}%` as any, backgroundColor: '#8B7CFF' }} />
              </View>
              <Txt variant="caption" tone="dim" style={{ marginTop: SPACE.xs }}>
                {seatsLeft > 0 ? `${fb.allocated_seats} of ${fb.tipping_point_seats} seats · ${seatsLeft} more to confirm the flight` : 'Enough seats filled'}
              </Txt>
            </View>
          )}

          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: SPACE.lg }}>
            <View style={{ flex: 1 }}>
              <Txt variant="caption" tone="faint">From</Txt>
              <Txt variant="headline">{fmt(item.price_per_person_cents)} <Txt variant="caption" tone="dim">per person</Txt></Txt>
            </View>
            <Button
              title={seatsAvailForGuest <= 0 ? 'Full' : alreadyJoined ? 'Joined' : 'Join'}
              size="md"
              disabled={seatsAvailForGuest <= 0 || alreadyJoined}
              onPress={() => handleJoinPool(item)}
            />
          </View>
        </View>
      </Card>
    );
  };

  const header = (
    <>
      {activeTrip && (
        <Card style={{ marginBottom: SPACE.lg, paddingVertical: SPACE.xs }}>
          <Row icon="airplane" title="Your trip is booked" subtitle="Tap to see your pass" last onPress={() => navigation.navigate('ActivePass')} />
        </Card>
      )}
      {myBookings.length > 0 && (
        <Section title="Your escapes" style={{ marginTop: 0, marginBottom: SPACE.lg }}>
          <Card style={{ paddingVertical: SPACE.xs }}>
            {myBookings.map((b, i) => {
              const live = LIVE_BOOKING_STATUSES.has(b.status);
              const fb = b.escape_packages?.flight_blocks;
              return (
                <Row key={b.id}
                  title={fb?.destination_name ?? b.escape_packages?.package_name ?? 'G Escape'}
                  subtitle={[fb?.departure_time ? fmtDate(fb.departure_time) : null, `${b.guest_count} guest${b.guest_count !== 1 ? 's' : ''}`, fmt(b.total_price_cents), BOOKING_STATUS_LABEL[b.status] ?? b.status].filter(Boolean).join(' · ')}
                  last={i === myBookings.length - 1}
                  onPress={live ? () => navigation.navigate('ActivePass') : undefined} />
              );
            })}
          </Card>
        </Section>
      )}
      {visiblePackages.length > 0 && <Txt variant="overline" tone="faint" style={{ marginBottom: SPACE.md }}>TRIPS FILLING NOW</Txt>}
    </>
  );

  const laneSection = (
    <Card style={{ marginTop: SPACE.md }}>
      <Txt variant="title">Don't see your island?</Txt>
      <Txt variant="body" tone="dim" style={{ marginTop: SPACE.xs }}>
        Raise your hand. When enough people want the same route, we take the numbers to the airline.
      </Txt>
      <Txt variant="overline" tone="faint" style={{ marginTop: SPACE.lg, marginBottom: SPACE.sm }}>ISLAND</Txt>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {LANE_DESTINATIONS.map(d => <Chip key={d.code} label={d.name} selected={laneDest === d.code} onPress={() => setLaneDest(laneDest === d.code ? null : d.code)} />)}
      </View>
      <Txt variant="overline" tone="faint" style={{ marginTop: SPACE.md, marginBottom: SPACE.sm }}>MONTH</Txt>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {laneMonths.map(mo => <Chip key={mo.value} label={mo.label} selected={laneMonth === mo.value} onPress={() => setLaneMonth(laneMonth === mo.value ? null : mo.value)} />)}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: SPACE.md }}>
        <IconButton icon="remove" label="Fewer seats" onPress={() => setLaneParty(Math.max(1, laneParty - 1))} />
        <Txt variant="bodyStrong" style={{ width: 80, textAlign: 'center' }}>{laneParty} seat{laneParty !== 1 ? 's' : ''}</Txt>
        <IconButton icon="add" label="More seats" onPress={() => setLaneParty(Math.min(10, laneParty + 1))} />
      </View>
      <Button title="Join the list" size="md" style={{ marginTop: SPACE.lg }} loading={laneSubmitting} disabled={!laneDest || !laneMonth} onPress={joinLane} />
      {myLanes.length > 0 && (
        <View style={{ marginTop: SPACE.lg }}>
          <Txt variant="overline" tone="faint" style={{ marginBottom: SPACE.sm }}>YOU'RE ON THE LIST FOR</Txt>
          {myLanes.map((l, i) => (
            <Row key={l.id} icon="airplane-outline"
              title={l.destination_name ?? l.destination_code}
              subtitle={`${new Date(l.travel_month + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })} · ${l.party_size} seat${l.party_size !== 1 ? 's' : ''}`}
              last={i === myLanes.length - 1}
              right={<Pressable accessibilityRole="button" accessibilityLabel="Leave this list" hitSlop={8} onPress={() => leaveLane(l.id)}><Ionicons name="close-circle" size={20} color={m.faint} /></Pressable>} />
          ))}
        </View>
      )}
    </Card>
  );

  const seatsOpen = selectedPackage ? selectedPackage.max_total_guests - selectedPackage.allocated_guests : 0;

  return (
    <View style={{ flex: 1, backgroundColor: m.page }}>
      <StatusBar style={m.statusBar} />
      <Header title="G Escape" onBack={() => navigation.goBack()} />
      {loading ? <Loading /> : loadError ? (
        <EmptyState icon="cloud-offline-outline" title="Could not load trips" body="Check your connection and try again."
          action={<Button title="Try again" variant="secondary" onPress={loadPackages} />} />
      ) : (
        <FlatList
          data={visiblePackages}
          keyExtractor={item => item.id}
          renderItem={renderCard}
          contentContainerStyle={{ paddingHorizontal: GUTTER, paddingTop: SPACE.sm, paddingBottom: insets.bottom + SPACE.xxl }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={m.accent} />}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={header}
          ListEmptyComponent={<EmptyState icon="airplane-outline" title="No trips on sale right now" body="Check back soon, or ask for a new route below." />}
          ListFooterComponent={laneSection}
        />
      )}

      <Modal visible={showGuestPicker && !!selectedPackage} transparent animationType="slide" onRequestClose={() => setShowGuestPicker(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(10,6,20,0.55)' }} onPress={() => setShowGuestPicker(false)} accessibilityLabel="Close" />
        <View style={{ backgroundColor: m.sheet[1], borderTopLeftRadius: RADIUS.sheet, borderTopRightRadius: RADIUS.sheet, padding: GUTTER, paddingBottom: Math.max(insets.bottom, SPACE.lg) + SPACE.sm }}>
          <Txt variant="title">How many people?</Txt>
          <Txt variant="body" tone="dim" style={{ marginTop: SPACE.xs }}>Including you. Each person gets a seat and a place to stay.</Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: SPACE.lg }}>
            {GUEST_OPTIONS.map(n => (
              <Chip key={n} label={`${n} ${n === 1 ? 'person' : 'people'}`} selected={guestCount === n} onPress={() => n <= seatsOpen ? setGuestCount(n) : toast(`Only ${seatsOpen} place${seatsOpen !== 1 ? 's' : ''} left on this trip.`)} />
            ))}
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: SPACE.md }}>
            <Txt variant="body" tone="dim">Estimated total</Txt>
            <Txt variant="headline">{selectedPackage ? fmt(selectedPackage.price_per_person_cents * guestCount) : ''}</Txt>
          </View>
          <Button title="Continue to checkout" style={{ marginTop: SPACE.xl }} onPress={handleConfirmGuests} />
        </View>
      </Modal>
    </View>
  );
}
