import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, RefreshControl, SafeAreaView, Image,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Location from 'expo-location';
import { supabase } from '@gtaxi/core';
import type { AppStackParamList } from '../navigation/types';
import { useEscapeTrip } from '../context/EscapeContext';

// Browse active G-Escape packages (flight-block pool cards).
// Shows pool progress, departure date, price, destination.
// "Join Pool" → GuestCountPicker bottom sheet → EscapeCheckout.
// Deep link: gtaxi://escape/:packageId auto-opens guest picker for that package.

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

  // Deep link: gtaxi://escape/:packageId — auto-open guest picker for that package
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
        // Filter out packages whose flight block is cancelled/past
        const valid = (data as any[]).filter(p => {
          const fb = Array.isArray(p.flight_blocks) ? p.flight_blocks[0] : p.flight_blocks;
          if (!fb) return false;
          if (fb.status === 'CANCELLED') return false;
          if (new Date(fb.departure_time) < new Date()) return false;
          return true;
        });
        setPackages(valid as EscapePackageCard[]);
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
    setSelectedPackage(pkg);
    setGuestCount(1);
    setShowGuestPicker(true);
  };

  const handleConfirmGuests = () => {
    if (!selectedPackage) return;
    setShowGuestPicker(false);
    navigation.navigate('EscapeCheckout', {
      packageId: selectedPackage.id,
      guestCount,
      userLocation: userLocation ?? { latitude: 10.6549, longitude: -61.5019 },
    });
  };

  const fmt = (cents: number) => `TTD ${(cents / 100).toFixed(0)}`;
  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-TT', {
    weekday: 'short', day: 'numeric', month: 'short',
  });
  const nights = (dep: string, ret: string | null) => {
    if (!ret) return null;
    const diff = (new Date(ret).getTime() - new Date(dep).getTime()) / (1000 * 60 * 60 * 24);
    return Math.round(diff);
  };

  const renderCard = ({ item }: { item: EscapePackageCard }) => {
    const fb = Array.isArray(item.flight_blocks) ? (item.flight_blocks as any[])[0] : item.flight_blocks;
    const ln = Array.isArray(item.lodging_nodes) ? (item.lodging_nodes as any[])[0] : item.lodging_nodes;
    if (!fb) return null;

    const poolPct = Math.min(100, Math.round((fb.allocated_seats / fb.tipping_point_seats) * 100));
    const seatsLeft = fb.tipping_point_seats - fb.allocated_seats;
    const isConfirmed = fb.status === 'CONFIRMED';
    const nightCount = ln?.nights ?? nights(fb.departure_time, fb.return_time);
    const seatsAvailForGuest = item.max_total_guests - item.allocated_guests;

    return (
      <View style={styles.card}>
        {/* Cover image or gradient placeholder */}
        {item.cover_image_url
          ? <Image source={{ uri: item.cover_image_url }} style={styles.coverImg} />
          : <View style={[styles.coverImg, styles.coverPlaceholder]}>
              <Text style={styles.coverPlaceholderText}>{fb.destination_code}</Text>
            </View>
        }

        {/* Status badge */}
        <View style={[styles.statusBadge, isConfirmed ? styles.statusConfirmed : styles.statusPooling]}>
          <Text style={styles.statusText}>{isConfirmed ? 'CONFIRMED' : 'Gathering the Crew'}</Text>
        </View>

        <View style={styles.cardBody}>
          <Text style={styles.destination}>{fb.destination_name}</Text>
          <Text style={styles.pkgName}>{item.package_name}</Text>
          {item.tagline ? <Text style={styles.tagline}>{item.tagline}</Text> : null}

          {/* Jobs fix: island experience highlights before logistics */}
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
            <Text style={styles.meta}>{fmtDate(fb.departure_time)}</Text>
            {nightCount ? <Text style={styles.metaDot}>·</Text> : null}
            {nightCount ? <Text style={styles.meta}>{nightCount}N</Text> : null}
            {ln?.name ? <Text style={styles.metaDot}>·</Text> : null}
            {ln?.name ? <Text style={styles.meta} numberOfLines={1}>{ln.name}</Text> : null}
          </View>

          {/* Pool progress */}
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
              <Text style={styles.confirmedText}>✓ Flight confirmed — seats guaranteed</Text>
            </View>
          )}

          <View style={styles.cardFooter}>
            <View>
              <Text style={styles.priceLabel}>FROM</Text>
              <Text style={styles.price}>{fmt(item.price_per_person_cents)}<Text style={styles.pricePer}> /person</Text></Text>
            </View>
            <TouchableOpacity
              style={[styles.joinBtn, seatsAvailForGuest <= 0 && styles.joinBtnDisabled]}
              onPress={() => handleJoinPool(item)}
              disabled={seatsAvailForGuest <= 0}
              activeOpacity={0.85}
            >
              <Text style={styles.joinBtnText}>
                {seatsAvailForGuest <= 0 ? 'Full' : 'Join Pool'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>G Escape</Text>
        <Text style={styles.headerSub}>Group Caribbean packages — split the flight</Text>
      </View>

      {/* Active trip banner */}
      {activeTrip && (
        <TouchableOpacity
          style={styles.activeTripBanner}
          onPress={() => navigation.navigate('ActivePass')}
        >
          <View style={styles.activeDot} />
          <Text style={styles.activeTripText}>You have an active escape — tap to view</Text>
          <Text style={styles.activeTripChevron}>›</Text>
        </TouchableOpacity>
      )}

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#C8A96E" />
        </View>
      ) : loadError ? (
        <View style={styles.centered}>
          <Text style={[styles.emptyTitle, { color: '#F87171' }]}>Connection Error</Text>
          <Text style={styles.emptySub}>{loadError}</Text>
          <TouchableOpacity onPress={loadPackages} style={{ marginTop: 16, paddingHorizontal: 24, paddingVertical: 12, backgroundColor: '#C8A96E', borderRadius: 12 }}>
            <Text style={{ color: '#000', fontWeight: '700' }}>Try Again</Text>
          </TouchableOpacity>
        </View>
      ) : packages.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyTitle}>No escapes available yet</Text>
          <Text style={styles.emptySub}>Check back soon — new packages drop weekly.</Text>
        </View>
      ) : (
        <FlatList
          data={packages}
          keyExtractor={item => item.id}
          renderItem={renderCard}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#C8A96E" />}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Guest count picker bottom sheet */}
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
                const fb = Array.isArray(selectedPackage.flight_blocks)
                  ? (selectedPackage.flight_blocks as any[])[0]
                  : selectedPackage.flight_blocks;
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
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={styles.sheetPriceRow}>
              <Text style={styles.sheetPriceLabel}>Total</Text>
              <Text style={styles.sheetPrice}>
                TTD {((selectedPackage.price_per_person_cents * guestCount) / 100).toFixed(0)}
              </Text>
            </View>
            <TouchableOpacity style={styles.sheetCta} onPress={handleConfirmGuests}>
              <Text style={styles.sheetCtaText}>Continue to Checkout →</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:             { flex: 1, backgroundColor: '#0C0C0F' },
  header:           { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 12 },
  headerTitle:      { fontSize: 26, fontWeight: '700', color: '#FFF', letterSpacing: -0.5 },
  headerSub:        { fontSize: 13, color: '#555', marginTop: 2 },
  activeTripBanner: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#141418',
                      marginHorizontal: 16, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 14,
                      marginBottom: 10, borderWidth: 1, borderColor: '#C8A96E33', gap: 8 },
  activeDot:        { width: 8, height: 8, borderRadius: 4, backgroundColor: '#4ADE80' },
  activeTripText:   { flex: 1, color: '#C8A96E', fontSize: 13, fontWeight: '500' },
  activeTripChevron:{ color: '#C8A96E', fontSize: 18 },
  centered:         { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 30 },
  emptyTitle:       { color: '#FFF', fontSize: 18, fontWeight: '600', textAlign: 'center' },
  emptySub:         { color: '#555', fontSize: 14, textAlign: 'center', marginTop: 8, lineHeight: 20 },
  list:             { paddingHorizontal: 16, paddingBottom: 40 },

  card:             { backgroundColor: '#141418', borderRadius: 16, marginBottom: 16, overflow: 'hidden',
                      borderWidth: 1, borderColor: '#1E1E26' },
  coverImg:         { width: '100%', height: 160, resizeMode: 'cover' },
  coverPlaceholder: { backgroundColor: '#1A1A24', justifyContent: 'center', alignItems: 'center' },
  coverPlaceholderText: { color: '#C8A96E', fontSize: 32, fontWeight: '200', letterSpacing: 4 },
  statusBadge:      { position: 'absolute', top: 12, right: 12, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  statusPooling:    { backgroundColor: '#C8A96E22', borderWidth: 1, borderColor: '#C8A96E44' },
  statusConfirmed:  { backgroundColor: '#22C55E22', borderWidth: 1, borderColor: '#22C55E44' },
  statusText:       { color: '#C8A96E', fontSize: 9, fontWeight: '700', letterSpacing: 1 },
  cardBody:         { padding: 16 },
  destination:      { fontSize: 20, fontWeight: '700', color: '#FFF', letterSpacing: -0.3 },
  pkgName:          { fontSize: 13, color: '#C8A96E', fontWeight: '600', marginTop: 2 },
  tagline:          { fontSize: 12, color: '#555', marginTop: 3 },
  metaRow:          { flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 4, flexWrap: 'wrap' },
  meta:             { color: '#777', fontSize: 12 },
  metaDot:          { color: '#333', fontSize: 12 },
  poolSection:      { marginTop: 14 },
  poolHeader:       { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  poolLabel:        { color: '#555', fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  poolCount:        { color: '#888', fontSize: 11, fontWeight: '600' },
  progressTrack:    { height: 3, backgroundColor: '#1E1E26', borderRadius: 2, overflow: 'hidden' },
  progressFill:     { height: 3, backgroundColor: '#C8A96E', borderRadius: 2 },
  poolSub:          { color: '#3A3A50', fontSize: 10, marginTop: 6 },
  confirmedBanner:  { marginTop: 12, backgroundColor: '#22C55E11', borderRadius: 8, paddingVertical: 8,
                      paddingHorizontal: 12, borderWidth: 1, borderColor: '#22C55E22' },
  confirmedText:    { color: '#22C55E', fontSize: 12, fontWeight: '600' },
  cardFooter:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 },
  priceLabel:       { color: '#444', fontSize: 9, fontWeight: '700', letterSpacing: 1 },
  price:            { color: '#FFF', fontSize: 18, fontWeight: '700' },
  pricePer:         { color: '#555', fontSize: 12, fontWeight: '400' },
  joinBtn:          { backgroundColor: '#C8A96E', borderRadius: 10, paddingHorizontal: 20, paddingVertical: 12 },
  joinBtnDisabled:  { backgroundColor: '#1E1E26' },
  joinBtnText:      { color: '#000', fontWeight: '700', fontSize: 14 },

  // Experience card
  experienceCard:     { backgroundColor: '#0F1018', borderRadius: 10, padding: 12, marginTop: 10,
                        marginBottom: 4, borderWidth: 1, borderColor: '#1A1A2A' },
  experienceTagline:  { color: '#C8A96E', fontSize: 11, fontStyle: 'italic', marginBottom: 8, lineHeight: 15 },
  highlightRow:       { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginBottom: 4 },
  highlightDot:       { width: 4, height: 4, borderRadius: 2, backgroundColor: '#C8A96E', marginTop: 5, flexShrink: 0 },
  highlightText:      { color: '#666', fontSize: 11, lineHeight: 15, flex: 1 },

  // Guest picker sheet
  sheetOverlay:     { position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)',
                      justifyContent: 'flex-end' },
  sheet:            { backgroundColor: '#141418', borderTopLeftRadius: 20, borderTopRightRadius: 20,
                      padding: 24, paddingBottom: 40, borderWidth: 1, borderColor: '#222', borderBottomWidth: 0 },
  sheetTitle:       { color: '#FFF', fontSize: 18, fontWeight: '700', marginBottom: 8 },
  sheetSub:         { color: '#555', fontSize: 13, lineHeight: 18, marginBottom: 20 },
  guestRow:         { flexDirection: 'row', gap: 12, marginBottom: 20 },
  guestOption:      { flex: 1, paddingVertical: 16, borderRadius: 12, backgroundColor: '#1A1A24',
                      alignItems: 'center', borderWidth: 1, borderColor: '#2A2A3A' },
  guestOptionSelected: { backgroundColor: '#C8A96E', borderColor: '#C8A96E' },
  guestOptionDisabled: { opacity: 0.3 },
  guestOptionText:  { color: '#888', fontSize: 20, fontWeight: '600' },
  guestOptionTextSelected: { color: '#000' },
  sheetPriceRow:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  sheetPriceLabel:  { color: '#555', fontSize: 14 },
  sheetPrice:       { color: '#4ADE80', fontSize: 22, fontWeight: '700' },
  sheetCta:         { backgroundColor: '#C8A96E', borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
  sheetCtaText:     { color: '#000', fontWeight: '700', fontSize: 16 },
});
