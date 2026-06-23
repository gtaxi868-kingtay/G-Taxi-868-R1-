import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, RefreshControl, SafeAreaView, Image, Alert,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@gtaxi/core';
import type { AppStackParamList } from '../navigation/types';
import { useEscapeTrip } from '../context/EscapeContext';

const BRAND = '#1DE0E6';

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

const GUEST_OPTIONS = [1, 2, 3, 4];

const DEST_EXPERIENCES: Record<string, { tagline: string; highlights: [string, string, string] }> = {
  BGI: { tagline: 'The island that makes every other island jealous', highlights: ['Crystal-clear south coast beaches', 'Crop Over festival energy year-round', 'Bridgetown duty-free dining scene'] },
  GND: { tagline: 'The undiscovered one — before everyone finds out', highlights: ['Grand Etang rainforest crater lake', 'Grenada chocolate straight from the estate', 'Underwater sculpture park at Molinere'] },
  TAB: { tagline: 'Your next move is 20 minutes by air', highlights: ['Buccoo Reef glass-bottom boat tours', 'Pigeon Point beach, sun-lounger ready', 'Sunday School street party in Buccoo'] },
  ANU: { tagline: '365 beaches. You\'ve seen none of them yet', highlights: ['English Harbour\'s colonial-era dockyard', 'Half Moon Bay — the most photographed beach in the Caribbean', 'Shirley Heights Sunday sunset BBQ'] },
  SKB: { tagline: 'Caribbean with no attitude. Just your kind of pace', highlights: ['Brimstone Hill Fortress — Caribbean\'s Gibraltar', 'Nevis Peak rainforest day hike', 'Black sand Cockleshell Beach with dual-island views'] },
  SLU: { tagline: 'The Pitons are on every Caribbean bucket list for a reason', highlights: ['Sulfur springs — drive-in volcano', 'Marigot Bay — the most beautiful bay in the Caribbean', 'Rainforest aerial tram over the canopy'] },
};

type RouteT = RouteProp<AppStackParamList, 'EscapeStorefront'>;

export default function EscapeStorefrontScreen() {
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

  useEffect(() => {
    loadPackages();
    Location.getForegroundPermissionsAsync().then(({ status }) => {
      if (status === 'granted') {
        Location.getCurrentPositionAsync({}).then(pos => {
          setUserLocation({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
        }).catch(() => {});
      }
    });
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

        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          const pkgIds = valid.map(p => p.id);
          if (pkgIds.length > 0) {
            const { data: participants } = await supabase
              .from('escape_group_participants')
              .select('package_id')
              .eq('rider_id', session.user.id)
              .in('package_id', pkgIds)
              .in('status', ['intent_pending', 'confirmed']);
            if (participants) {
              setJoinedPkgIds(new Set(participants.map(p => p.package_id)));
            }
          }
        }
      }
    } catch (err) {
      console.error('EscapeStorefront load error:', err);
      setLoadError('Could not load packages. Check your connection and try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    loadPackages();
  };

  const handleJoinPool = (pkg: EscapePackageCard) => {
    if (joinedPkgIds.has(pkg.id)) {
      Alert.alert('Already Joined', 'You\'re already in this group! Check your active passes.');
      return;
    }
    setSelectedPackage(pkg);
    setGuestCount(1);
    setShowGuestPicker(true);
  };

  const handleConfirmGuests = async () => {
    if (!selectedPackage) return;
    setShowGuestPicker(false);
    setJoiningPkgId(selectedPackage.id);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        Alert.alert('Not logged in', 'Please sign in to join an escape.');
        return;
      }

      const { data, error } = await supabase.functions.invoke('travel', {
        body: { action: 'join_escape_group', package_id: selectedPackage.id, party_size: guestCount },
      });

      if (error) throw error;

      if (data?.error) {
        if (data.participant_id) {
          Alert.alert('Already Joined', 'You\'re already in this group!');
          setJoinedPkgIds(prev => new Set(prev).add(selectedPackage.id));
        } else {
          Alert.alert('Error', data.error);
        }
        return;
      }

      Alert.alert(
        'You\'re in!',
        `You joined ${selectedPackage.package_name} with ${guestCount} guest${guestCount !== 1 ? 's' : ''}. We\'ll notify you when the group is ready to lock seats.`,
        [{ text: 'View My Pass', onPress: () => navigation.navigate('ActivePass') }]
      );
      setJoinedPkgIds(prev => new Set(prev).add(selectedPackage.id));
      loadPackages();
    } catch (err: any) {
      Alert.alert('Join failed', err.message ?? 'Something went wrong');
    } finally {
      setJoiningPkgId(null);
    }
  };

  const fmt = (cents: number) => `TTD ${(cents / 100).toFixed(0)}`;
  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-TT', {
    weekday: 'short', day: 'numeric', month: 'short',
  });

  const renderCard = ({ item }: { item: EscapePackageCard }) => {
    const fb = Array.isArray(item.flight_blocks) ? (item.flight_blocks as any[])[0] : item.flight_blocks;
    const ln = Array.isArray(item.lodging_nodes) ? (item.lodging_nodes as any[])[0] : item.lodging_nodes;
    if (!fb) return null;

    const poolPct = Math.min(100, Math.round((fb.allocated_seats / fb.tipping_point_seats) * 100));
    const seatsLeft = fb.tipping_point_seats - fb.allocated_seats;
    const isConfirmed = fb.status === 'CONFIRMED';
    const nightCount = ln?.nights ?? undefined;
    const seatsAvailForGuest = item.max_total_guests - item.allocated_guests;
    const alreadyJoined = joinedPkgIds.has(item.id);
    const isJoining = joiningPkgId === item.id;

    return (
      <View style={styles.card}>
        {item.cover_image_url
          ? <Image source={{ uri: item.cover_image_url }} style={styles.coverImg} />
          : <View style={[styles.coverImg, styles.coverPlaceholder]}>
              <Text style={styles.coverPlaceholderText}>{fb.destination_code}</Text>
            </View>
        }

        <View style={[styles.statusBadge, isConfirmed ? styles.statusConfirmed : styles.statusPooling]}>
          <Text style={styles.statusText}>{isConfirmed ? 'CONFIRMED' : 'Gathering the Crew'}</Text>
        </View>

        {alreadyJoined && (
          <View style={styles.joinedBadge}>
            <Ionicons name="checkmark-circle" size={14} color={BRAND} />
            <Text style={styles.joinedText}>Joined</Text>
          </View>
        )}

        <View style={styles.cardBody}>
          <Text style={styles.destination}>{fb.destination_name}</Text>
          <Text style={styles.pkgName}>{item.package_name}</Text>
          {item.tagline ? <Text style={styles.tagline}>{item.tagline}</Text> : null}

          {DEST_EXPERIENCES[fb.destination_code] && (
            <View style={styles.experienceCard}>
              <Text style={styles.experienceTagline}>{DEST_EXPERIENCES[fb.destination_code].tagline}</Text>
              {DEST_EXPERIENCES[fb.destination_code].highlights.map((h, i) => (
                <View key={i} style={styles.highlightRow}>
                  <View style={styles.highlightDot} />
                  <Text style={styles.highlightText}>{h}</Text>
                </View>
              ))}
            </View>
          )}

          <View style={styles.metaRow}>
            <Ionicons name="calendar-outline" size={12} color="rgba(255,255,255,0.4)" />
            <Text style={styles.meta}>{fmtDate(fb.departure_time)}</Text>
            {nightCount ? <Text style={styles.metaSep}>·</Text> : null}
            {nightCount ? <Text style={styles.meta}>{nightCount}N</Text> : null}
            {ln?.name ? <Text style={styles.metaSep}>·</Text> : null}
            {ln?.name ? <Text style={styles.meta} numberOfLines={1}>{ln.name}</Text> : null}
          </View>

          {!isConfirmed && (
            <View style={styles.poolSection}>
              <View style={styles.poolHeader}>
                <Text style={styles.poolLabel}>Flight pool</Text>
                <Text style={styles.poolCount}>{fb.allocated_seats} / {fb.tipping_point_seats}</Text>
              </View>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${poolPct}%` as any }]} />
              </View>
              <Text style={styles.poolSub}>
                {seatsLeft > 0
                  ? `${seatsLeft} more seat${seatsLeft !== 1 ? 's' : ''} to lock the flight`
                  : 'Tipping point reached'}
              </Text>
            </View>
          )}

          {isConfirmed && (
            <View style={styles.confirmedBanner}>
              <Ionicons name="checkmark-circle" size={14} color="#22C55E" />
              <Text style={styles.confirmedText}>Flight confirmed — seats guaranteed</Text>
            </View>
          )}

          <View style={styles.cardFooter}>
            <View>
              <Text style={styles.priceLabel}>FROM</Text>
              <Text style={styles.price}>{fmt(item.price_per_person_cents)}<Text style={styles.pricePer}> /person</Text></Text>
            </View>
            <TouchableOpacity
              style={[
                styles.joinBtn,
                (seatsAvailForGuest <= 0 || alreadyJoined) && styles.joinBtnDisabled,
                isJoining && styles.joinBtnJoining,
              ]}
              onPress={() => handleJoinPool(item)}
              disabled={seatsAvailForGuest <= 0 || alreadyJoined || isJoining}
              activeOpacity={0.85}
            >
              {isJoining ? (
                <ActivityIndicator size="small" color="#0B0E12" />
              ) : (
                <Text style={styles.joinBtnText}>
                  {seatsAvailForGuest <= 0 ? 'Full' : alreadyJoined ? 'Joined ✓' : 'Join Pool'}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>G Escape</Text>
        <Text style={styles.headerSub}>Group Caribbean packages — split the flight</Text>
      </View>

      {activeTrip && (
        <TouchableOpacity
          style={styles.activeTripBanner}
          onPress={() => navigation.navigate('ActivePass')}
        >
          <View style={styles.activeDot} />
          <Text style={styles.activeTripText}>You have an active escape — tap to view</Text>
          <Ionicons name="chevron-forward" size={16} color={BRAND} />
        </TouchableOpacity>
      )}

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={BRAND} />
        </View>
      ) : loadError ? (
        <View style={styles.centered}>
          <Ionicons name="cloud-offline-outline" size={40} color="#F87171" />
          <Text style={[styles.emptyTitle, { color: '#F87171', marginTop: 12 }]}>Connection Error</Text>
          <Text style={styles.emptySub}>{loadError}</Text>
          <TouchableOpacity onPress={loadPackages} style={styles.retryBtn}>
            <Text style={styles.retryBtnText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      ) : packages.length === 0 ? (
        <View style={styles.centered}>
          <Ionicons name="airplane-outline" size={48} color="rgba(255,255,255,0.15)" />
          <Text style={styles.emptyTitle}>No escapes available yet</Text>
          <Text style={styles.emptySub}>Check back soon — new packages drop weekly.</Text>
        </View>
      ) : (
        <FlatList
          data={packages}
          keyExtractor={item => item.id}
          renderItem={renderCard}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={BRAND} />}
          showsVerticalScrollIndicator={false}
        />
      )}

      {showGuestPicker && selectedPackage && (
        <TouchableOpacity
          style={styles.sheetOverlay}
          activeOpacity={1}
          onPress={() => setShowGuestPicker(false)}
        >
          <TouchableOpacity activeOpacity={1} style={styles.sheet}>
            <Text style={styles.sheetTitle}>How many guests?</Text>
            <Text style={styles.sheetSub}>
              Including yourself. Each person gets a seat on the flight and a villa spot.
            </Text>
            <View style={styles.guestRow}>
              {GUEST_OPTIONS.map(n => {
                const seatsLeft = (selectedPackage.max_total_guests - selectedPackage.allocated_guests);
                const disabled = n > seatsLeft;
                return (
                  <TouchableOpacity
                    key={n}
                    style={[styles.guestOption, guestCount === n && styles.guestOptionSelected, disabled && styles.guestOptionDisabled]}
                    onPress={() => !disabled && setGuestCount(n)}
                    disabled={disabled}
                  >
                    <Text style={[styles.guestOptionText, guestCount === n && styles.guestOptionTextSelected]}>
                      {n}
                    </Text>
                    {n > 1 && <Text style={[styles.guestOptionLabel, guestCount === n && styles.guestOptionLabelSelected]}>ppl</Text>}
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={styles.sheetPriceRow}>
              <Text style={styles.sheetPriceLabel}>Estimated total</Text>
              <Text style={styles.sheetPrice}>
                TTD {((selectedPackage.price_per_person_cents * guestCount) / 100).toFixed(0)}
              </Text>
            </View>
            <TouchableOpacity style={styles.sheetCta} onPress={handleConfirmGuests}>
              <Text style={styles.sheetCtaText}>Join Group</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:             { flex: 1, backgroundColor: '#0B0E12' },
  header:           { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 12 },
  headerTitle:      { fontSize: 28, fontWeight: '800', color: '#F2F5F8', letterSpacing: -0.5 },
  headerSub:        { fontSize: 13, color: 'rgba(242,245,248,0.42)', marginTop: 2 },
  activeTripBanner: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(29,224,230,0.08)',
                      marginHorizontal: 16, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14,
                      marginBottom: 10, borderWidth: 1, borderColor: 'rgba(29,224,230,0.2)', gap: 8 },
  activeDot:        { width: 8, height: 8, borderRadius: 4, backgroundColor: '#10B981' },
  activeTripText:   { flex: 1, color: BRAND, fontSize: 13, fontWeight: '500' },
  centered:         { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 30 },
  emptyTitle:       { color: '#F2F5F8', fontSize: 18, fontWeight: '700', textAlign: 'center', marginTop: 12 },
  emptySub:         { color: 'rgba(242,245,248,0.42)', fontSize: 14, textAlign: 'center', marginTop: 8, lineHeight: 20 },
  retryBtn:         { marginTop: 16, backgroundColor: BRAND, borderRadius: 14, paddingHorizontal: 24, paddingVertical: 12 },
  retryBtnText:     { color: '#0B0E12', fontWeight: '700', fontSize: 14 },
  list:             { paddingHorizontal: 16, paddingBottom: 40 },
  joinedBadge:      { position: 'absolute', top: 44, right: 12, flexDirection: 'row', alignItems: 'center',
                      backgroundColor: 'rgba(29,224,230,0.12)', borderRadius: 8,
                      paddingHorizontal: 8, paddingVertical: 3, gap: 4,
                      borderWidth: 1, borderColor: 'rgba(29,224,230,0.25)' },
  joinedText:       { color: BRAND, fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },

  card:             { backgroundColor: '#13171D', borderRadius: 20, marginBottom: 16, overflow: 'hidden',
                      borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  coverImg:         { width: '100%', height: 160, resizeMode: 'cover' },
  coverPlaceholder: { backgroundColor: '#1A1F27', justifyContent: 'center', alignItems: 'center' },
  coverPlaceholderText: { color: BRAND, fontSize: 32, fontWeight: '200', letterSpacing: 4 },
  statusBadge:      { position: 'absolute', top: 12, left: 12, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  statusPooling:    { backgroundColor: `${BRAND}1F`, borderWidth: 1, borderColor: `${BRAND}33` },
  statusConfirmed:  { backgroundColor: '#22C55E22', borderWidth: 1, borderColor: '#22C55E44' },
  statusText:       { color: BRAND, fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  cardBody:         { padding: 16 },
  destination:      { fontSize: 22, fontWeight: '800', color: '#F2F5F8', letterSpacing: -0.3 },
  pkgName:          { fontSize: 13, color: BRAND, fontWeight: '600', marginTop: 2 },
  tagline:          { fontSize: 12, color: 'rgba(242,245,248,0.42)', marginTop: 3 },
  metaRow:          { flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 6, flexWrap: 'wrap' },
  meta:             { color: 'rgba(242,245,248,0.5)', fontSize: 12 },
  metaSep:          { color: 'rgba(242,245,248,0.2)', fontSize: 12 },
  poolSection:      { marginTop: 14 },
  poolHeader:       { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  poolLabel:        { color: 'rgba(242,245,248,0.42)', fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  poolCount:        { color: '#F2F5F8', fontSize: 11, fontWeight: '600' },
  progressTrack:    { height: 4, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden' },
  progressFill:     { height: 4, backgroundColor: BRAND, borderRadius: 2 },
  poolSub:          { color: 'rgba(242,245,248,0.35)', fontSize: 10, marginTop: 6 },
  confirmedBanner:  { marginTop: 12, backgroundColor: '#22C55E11', borderRadius: 8, paddingVertical: 8,
                      paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 6,
                      borderWidth: 1, borderColor: '#22C55E22' },
  confirmedText:    { color: '#22C55E', fontSize: 12, fontWeight: '600' },
  cardFooter:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 },
  priceLabel:       { color: 'rgba(242,245,248,0.35)', fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  price:            { color: '#F2F5F8', fontSize: 18, fontWeight: '800' },
  pricePer:         { color: 'rgba(242,245,248,0.42)', fontSize: 12, fontWeight: '400' },
  joinBtn:          { backgroundColor: BRAND, borderRadius: 12, paddingHorizontal: 22, paddingVertical: 12, minWidth: 110, alignItems: 'center' },
  joinBtnDisabled:  { backgroundColor: 'rgba(255,255,255,0.06)', opacity: 0.6 },
  joinBtnJoining:   { opacity: 0.7 },
  joinBtnText:      { color: '#0B0E12', fontWeight: '700', fontSize: 14 },

  experienceCard:     { backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 12, padding: 12, marginTop: 10,
                        marginBottom: 4, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  experienceTagline:  { color: BRAND, fontSize: 11, fontStyle: 'italic', marginBottom: 8, lineHeight: 15 },
  highlightRow:       { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginBottom: 4 },
  highlightDot:       { width: 4, height: 4, borderRadius: 2, backgroundColor: BRAND, marginTop: 5, flexShrink: 0 },
  highlightText:      { color: 'rgba(242,245,248,0.5)', fontSize: 11, lineHeight: 15, flex: 1 },

  sheetOverlay:     { position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)',
                      justifyContent: 'flex-end' },
  sheet:            { backgroundColor: '#13171D', borderTopLeftRadius: 28, borderTopRightRadius: 28,
                      padding: 24, paddingBottom: 40, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', borderBottomWidth: 0 },
  sheetTitle:       { color: '#F2F5F8', fontSize: 18, fontWeight: '700', marginBottom: 8 },
  sheetSub:         { color: 'rgba(242,245,248,0.5)', fontSize: 13, lineHeight: 18, marginBottom: 20 },
  guestRow:         { flexDirection: 'row', gap: 12, marginBottom: 20 },
  guestOption:      { flex: 1, paddingVertical: 14, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.04)',
                      alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  guestOptionSelected: { backgroundColor: `${BRAND}1F`, borderColor: BRAND },
  guestOptionDisabled: { opacity: 0.3 },
  guestOptionText:  { color: '#F2F5F8', fontSize: 20, fontWeight: '700' },
  guestOptionTextSelected: { color: BRAND },
  guestOptionLabel:  { color: 'rgba(242,245,248,0.35)', fontSize: 9, marginTop: 2 },
  guestOptionLabelSelected: { color: BRAND },
  sheetPriceRow:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  sheetPriceLabel:  { color: 'rgba(242,245,248,0.5)', fontSize: 14 },
  sheetPrice:       { color: '#10B981', fontSize: 22, fontWeight: '800' },
  sheetCta:         { backgroundColor: BRAND, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  sheetCtaText:     { color: '#0B0E12', fontWeight: '800', fontSize: 16 },
});
