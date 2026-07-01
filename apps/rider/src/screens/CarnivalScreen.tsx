import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, RefreshControl, SafeAreaView, Alert,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@gtaxi/core';
import type { AppStackParamList } from '../navigation/types';
import { useAuth } from '../context/AuthContext';

const BRAND = '#FF2D55';

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
    if (!profile?.id) { Alert.alert('Sign in required', 'Create an account to join a band.'); return; }
    try {
      const { error } = await supabase.from('band_members').insert({ rider_id: profile.id, band_id: bandId });
      if (error) {
        if (error.code === '23505') { Alert.alert('Already joined', 'You are already a member of this band.'); }
        else { Alert.alert('Error', error.message); }
        return;
      }
      Alert.alert('Joined!', 'You are now a member of this band. Tap a band keychain at fetes to earn revshare on your rides.');
      fetchData();
    } catch (err: any) { Alert.alert('Error', err.message); }
  };

  const rideToVenue = (ev: Event) => {
    (navigation.navigate as any)('RideConfirmation', {
      destination: { latitude: ev.lat, longitude: ev.lng, address: ev.venue },
      source: 'carnival',
      sourceMetadata: { band_id: ev.band_id, carnival_event_id: ev.id },
    });
  };

  if (loading) {
    return (
      <SafeAreaView style={s.container}>
        <ActivityIndicator size="large" color={BRAND} style={{ marginTop: 60 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Carnival</Text>
        <View style={{ width: 40 }} />
      </View>

      <FlatList
        data={bands}
        keyExtractor={(b) => b.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={BRAND} />}
        ListHeaderComponent={() => (
          <>
            {myMembership && (
              <View style={s.membershipCard}>
                <Ionicons name="musical-notes" size={28} color={BRAND} />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={s.membershipLabel}>Your Band</Text>
                  <Text style={s.membershipName}>{myMembership.bands?.name}</Text>
                  <Text style={s.membershipDate}>
                    Member since {new Date(myMembership.joined_at).toLocaleDateString()}
                  </Text>
                </View>
              </View>
            )}

            {myRevshare.length > 0 && (
              <View style={s.revshareCard}>
                <Text style={s.revshareTitle}>Ride Revenue Share</Text>
                {myRevshare.map((rs) => (
                  <View key={rs.band_id} style={s.revshareRow}>
                    <Text style={s.revshareBand}>{rs.band_name}</Text>
                    <Text style={s.revshareStats}>
                      {rs.total_rides} ride{rs.total_rides !== 1 ? 's' : ''} · TTD ${(rs.total_revshare_cents / 100).toFixed(2)} earned
                    </Text>
                  </View>
                ))}
              </View>
            )}

            <Text style={s.sectionTitle}>Mas Bands</Text>
            <Text style={s.sectionSub}>Tap a keychain at your band's event to link your rides</Text>
          </>
        )}
        renderItem={({ item: band }) => {
          const bandEvents = events.filter((e) => e.band_id === band.id);
          const isSelected = selectedBand === band.id;
          return (
            <TouchableOpacity
              style={s.bandCard}
              onPress={() => setSelectedBand(isSelected ? null : band.id)}
              activeOpacity={0.7}
            >
              <View style={s.bandRow}>
                <View style={s.bandAvatar}>
                  <Ionicons name="musical-note" size={24} color="#fff" />
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={s.bandName}>{band.name}</Text>
                  <Text style={s.bandDesc} numberOfLines={2}>{band.description}</Text>
                </View>
                <Ionicons
                  name={isSelected ? 'chevron-up' : 'chevron-down'}
                  size={20}
                  color="#666"
                />
              </View>

              {isSelected && (
                <View style={s.bandDetail}>
                  {bandEvents.length === 0 ? (
                    <Text style={s.noEvents}>No upcoming fetes listed yet</Text>
                  ) : (
                    bandEvents.map((ev) => (
                      <View key={ev.id} style={s.eventCard}>
                        <Text style={s.eventName}>{ev.name}</Text>
                        <Text style={s.eventVenue}>
                          <Ionicons name="location" size={14} color="#999" /> {ev.venue}
                        </Text>
                        <View style={s.eventMeta}>
                          <Text style={s.eventDate}>
                            {new Date(ev.event_date).toLocaleDateString('en-US', {
                              weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                            })}
                          </Text>
                          {ev.ticket_price_cents > 0 && (
                            <Text style={s.eventPrice}>
                              TTD ${(ev.ticket_price_cents / 100).toFixed(2)}
                            </Text>
                          )}
                        </View>
                        {ev.lat && ev.lng && (
                          <TouchableOpacity
                            style={s.rideBtn}
                            onPress={() => rideToVenue(ev)}
                          >
                            <Ionicons name="car" size={16} color="#fff" />
                            <Text style={s.rideBtnText}>Ride to venue</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    ))
                  )}

                  <TouchableOpacity style={s.joinBtn} onPress={() => joinBand(band.id)}>
                    <Ionicons name="add-circle" size={18} color="#fff" />
                    <Text style={s.joinBtnText}>Join this Band</Text>
                  </TouchableOpacity>

                  <View style={s.keychainHint}>
                    <Ionicons name="radio" size={16} color={BRAND} />
                    <Text style={s.keychainHintText}>
                      Tap an NFC keychain at your band's event to link rides and earn revshare
                    </Text>
                  </View>
                </View>
              )}
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={
          <View style={{ padding: 40, alignItems: 'center' }}>
            <Ionicons name="musical-notes-outline" size={48} color="#444" />
            <Text style={s.emptyText}>No carnival bands available yet</Text>
          </View>
        }
        contentContainerStyle={s.listContent}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#07070F',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1A1A2E',
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1A1A2E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
  },
  listContent: {
    paddingBottom: 40,
  },
  membershipCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1A1A2E',
    margin: 16,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BRAND + '40',
  },
  membershipLabel: {
    fontSize: 11,
    color: BRAND,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  membershipName: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
    marginTop: 2,
  },
  membershipDate: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  revshareCard: {
    backgroundColor: '#1A1A2E',
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 16,
    borderRadius: 16,
  },
  revshareTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 12,
  },
  revshareRow: {
    marginBottom: 8,
  },
  revshareBand: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  revshareStats: {
    fontSize: 12,
    color: '#999',
    marginTop: 2,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
    marginHorizontal: 16,
    marginTop: 8,
  },
  sectionSub: {
    fontSize: 13,
    color: '#666',
    marginHorizontal: 16,
    marginBottom: 16,
  },
  bandCard: {
    backgroundColor: '#13132B',
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 16,
    padding: 16,
  },
  bandRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  bandAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: BRAND + '30',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bandName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
  bandDesc: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  bandDetail: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#1A1A2E',
  },
  eventCard: {
    backgroundColor: '#0D0D1A',
    padding: 12,
    borderRadius: 12,
    marginBottom: 8,
  },
  eventName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 4,
  },
  eventVenue: {
    fontSize: 12,
    color: '#999',
    marginBottom: 6,
  },
  eventMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  eventDate: {
    fontSize: 12,
    color: BRAND,
    fontWeight: '500',
  },
  eventPrice: {
    fontSize: 12,
    color: '#fff',
    fontWeight: '600',
  },
  joinBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: BRAND,
    paddingVertical: 10,
    borderRadius: 10,
    marginBottom: 12,
  },
  joinBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
    marginLeft: 6,
  },
  rideBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#34E6EC',
    paddingVertical: 8,
    borderRadius: 8,
    marginTop: 8,
  },
  rideBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
    marginLeft: 6,
  },
  noEvents: {
    fontSize: 13,
    color: '#666',
    fontStyle: 'italic',
    marginBottom: 12,
  },
  keychainHint: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: BRAND + '15',
    padding: 12,
    borderRadius: 12,
    marginTop: 8,
  },
  keychainHintText: {
    fontSize: 12,
    color: BRAND,
    marginLeft: 8,
    flex: 1,
  },
  emptyText: {
    fontSize: 14,
    color: '#444',
    marginTop: 12,
  },
});
