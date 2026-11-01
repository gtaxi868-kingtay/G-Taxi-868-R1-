import React, { useState, useEffect, useCallback } from 'react';
import { View, FlatList, Pressable, RefreshControl } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@gtaxi/core';
import type { AppStackParamList } from '../navigation/types';
import { useAuth } from '../context/AuthContext';
import { toast } from '../components/Toast';
import { BrandBadge, Button, Card, EmptyState, GUTTER, Header, Loading, Row, Section, SPACE, Txt, useTheme } from '../ui/kit';


type Nav = NativeStackNavigationProp<AppStackParamList, 'Carnival'>;

interface Band {
  id: string;
  name: string;
  description: string;
  logo_url: string;
  revshare_percent: number;
}

interface Event {
  id: string;
  band_id: string;
  name: string;
  description: string;
  venue: string;
  lat: number;
  lng: number;
  event_date: string;
  ticket_price_cents: number;
  ticket_url: string;
}

interface BandMember {
  band_id: string;
  joined_at: string;
  bands: { name: string; logo_url: string };
}

interface RevshareSummary {
  band_id: string;
  band_name: string;
  total_rides: number;
  total_revshare_cents: number;
}

export default function CarnivalScreen() {
  const navigation = useNavigation<Nav>();
  const { profile } = useAuth();
  const [bands, setBands] = useState<Band[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [myMembership, setMyMembership] = useState<BandMember | null>(null);
  const [myRevshare, setMyRevshare] = useState<RevshareSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedBand, setSelectedBand] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [bandsRes, eventsRes, membershipRes, revshareRes] = await Promise.all([
        supabase.from('carnival_bands').select('*').eq('is_active', true).order('name'),
        supabase.from('carnival_events').select('*').gte('event_date', new Date().toISOString()).eq('is_active', true).order('event_date'),
        profile?.id
          ? supabase.from('band_members').select('*, bands:band_id(name, logo_url)').eq('rider_id', profile.id).maybeSingle()
          : Promise.resolve({ data: null }),
        profile?.id
          ? supabase.from('band_revshare_ledger').select('band_id, bands:band_id(name), revshare_cents').eq('rider_id', profile.id)
          : Promise.resolve({ data: [] }),
      ]);

      if (bandsRes.data) setBands(bandsRes.data);
      if (eventsRes.data) setEvents(eventsRes.data);
      if (membershipRes.data) setMyMembership(membershipRes.data as unknown as BandMember);

      if (revshareRes.data) {
        const grouped: Record<string, RevshareSummary> = {};
        for (const r of revshareRes.data as any[]) {
          const bid = r.band_id;
          if (!grouped[bid]) {
            grouped[bid] = {
              band_id: bid,
              band_name: r.bands?.name || 'Unknown',
              total_rides: 0,
              total_revshare_cents: 0,
            };
          }
          grouped[bid].total_rides += 1;
          grouped[bid].total_revshare_cents += r.revshare_cents || 0;
        }
        setMyRevshare(Object.values(grouped));
      }
    } catch (err) {
      console.error('[CarnivalScreen] fetch error:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [profile?.id]);

  useFocusEffect(useCallback(() => { fetchData(); }, [fetchData]));

  const onRefresh = () => { setRefreshing(true); fetchData(); };

  const joinBand = async (bandId: string) => {
    if (!profile?.id) { toast('Sign in to join a band.', 'error'); return; }
    try {
      const { error } = await supabase.from('band_members').insert({ rider_id: profile.id, band_id: bandId });
      if (error) {
        if (error.code === '23505') { toast('You are already in this band.'); }
        else { toast(error.message, 'error'); }
        return;
      }
      toast('You joined the band. Tap their keychain at fetes to link your rides.', 'success');
      fetchData();
    } catch (err: any) { toast(err.message || 'Could not join.', 'error'); }
  };

  // Same fix as Events: send the rider's real location as the pickup.
  const rideToVenue = async (ev: Event) => {
    let pickup: { latitude: number; longitude: number; address: string } | undefined;
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const pos = (await Location.getLastKnownPositionAsync()) || (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
        if (pos) pickup = { latitude: pos.coords.latitude, longitude: pos.coords.longitude, address: 'Current location' };
      }
    } catch { /* falls through */ }
    if (!pickup) { toast('Turn on location so we know where to pick you up.', 'error'); return; }
    (navigation.navigate as any)('RideConfirmation', {
      pickup,
      destination: { latitude: ev.lat, longitude: ev.lng, address: ev.venue },
      source: 'carnival',
      sourceMetadata: { band_id: ev.band_id, carnival_event_id: ev.id },
    });
  };

  const m = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, backgroundColor: m.page }}>
      <StatusBar style={m.statusBar} />
      <Header title="Carnival" onBack={() => navigation.goBack()} />
      {loading ? <Loading /> : (
        <FlatList
          data={bands}
          keyExtractor={(b) => b.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={m.accent} />}
          contentContainerStyle={{ paddingHorizontal: GUTTER, paddingBottom: insets.bottom + SPACE.xxl }}
          ListHeaderComponent={
            <>
              {myMembership && (
                <Card style={{ flexDirection: 'row', alignItems: 'center', marginTop: SPACE.sm }}>
                  <BrandBadge icon="musical-notes" size={48} round />
                  <View style={{ flex: 1, marginLeft: SPACE.md }}>
                    <Txt variant="caption" tone="dim">Your band</Txt>
                    <Txt variant="title">{myMembership.bands?.name}</Txt>
                    <Txt variant="caption" tone="faint">Member since {new Date(myMembership.joined_at).toLocaleDateString()}</Txt>
                  </View>
                </Card>
              )}
              {myRevshare.length > 0 && (
                <Section title="What your rides earned your band">
                  <Card style={{ paddingVertical: SPACE.xs }}>
                    {myRevshare.map((rs, i) => (
                      <Row key={rs.band_id} title={rs.band_name} subtitle={`${rs.total_rides} ride${rs.total_rides !== 1 ? 's' : ''}`} last={i === myRevshare.length - 1}
                        right={<Txt variant="bodyStrong" tone="success">TT${(rs.total_revshare_cents / 100).toFixed(2)}</Txt>} />
                    ))}
                  </Card>
                </Section>
              )}
              <Txt variant="overline" tone="faint" style={{ marginTop: SPACE.xl }}>MAS BANDS</Txt>
              <Txt variant="caption" tone="dim" style={{ marginTop: 2, marginBottom: SPACE.md }}>Tap your band's G keychain at their events to link your rides.</Txt>
            </>
          }
          renderItem={({ item: band }) => {
            const bandEvents = events.filter((e) => e.band_id === band.id);
            const open = selectedBand === band.id;
            return (
              <Card style={{ marginBottom: SPACE.md }}>
                <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setSelectedBand(open ? null : band.id)}
                  style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: m.field, alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="musical-note" size={20} color={m.accent} />
                  </View>
                  <View style={{ flex: 1, marginLeft: SPACE.md }}>
                    <Txt variant="headline">{band.name}</Txt>
                    {band.description ? <Txt variant="caption" tone="dim" numberOfLines={2}>{band.description}</Txt> : null}
                  </View>
                  <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={m.faint} />
                </Pressable>
                {open && (
                  <View style={{ marginTop: SPACE.md }}>
                    {bandEvents.length === 0 ? <Txt variant="body" tone="dim">No upcoming fetes listed yet.</Txt> : bandEvents.map((ev) => (
                      <View key={ev.id} style={{ paddingVertical: SPACE.md, borderTopWidth: 1, borderTopColor: m.chipBorder }}>
                        <Txt variant="bodyStrong">{ev.name}</Txt>
                        <Txt variant="caption" tone="dim">
                          {ev.venue} · {new Date(ev.event_date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} {new Date(ev.event_date).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                          {ev.ticket_price_cents > 0 ? ` · TT$${(ev.ticket_price_cents / 100).toFixed(2)}` : ''}
                        </Txt>
                        {ev.lat && ev.lng ? <Button title="Ride there" icon="car-outline" size="sm" variant="secondary" style={{ alignSelf: 'flex-start', marginTop: SPACE.sm }} onPress={() => rideToVenue(ev)} /> : null}
                      </View>
                    ))}
                    {myMembership?.band_id !== band.id && (
                      <Button title="Join this band" size="md" style={{ marginTop: SPACE.md }} onPress={() => joinBand(band.id)} />
                    )}
                  </View>
                )}
              </Card>
            );
          }}
          ListEmptyComponent={<EmptyState icon="musical-notes-outline" title="No bands yet" body="Mas bands will show up here as they join." />}
        />
      )}
    </View>
  );
}
