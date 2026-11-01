import React, { useState, useCallback } from 'react';
import { View, FlatList, RefreshControl, ScrollView, Linking } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { supabase } from '@gtaxi/core';
import type { AppStackParamList } from '../navigation/types';
import { toast } from '../components/Toast';
import { Button, Card, Chip, EmptyState, GUTTER, Header, Loading, SPACE, Txt, useTheme } from '../ui/kit';


type Nav = NativeStackNavigationProp<AppStackParamList, 'Events'>;

interface Organizer {
  id: string;
  name: string;
  description: string;
  logo_url: string;
  is_band: boolean;
}

interface EventItem {
  id: string;
  organizer_id: string;
  band_id: string | null;
  name: string;
  description: string;
  event_type: string;
  category: string;
  venue: string;
  lat: number;
  lng: number;
  event_date: string;
  ticket_price_cents: number;
  ticket_url: string;
  organizers?: Organizer;
}

const TYPE_TABS = [
  { key: 'all', label: 'All', icon: 'apps' },
  { key: 'fete', label: 'Fetes', icon: 'musical-notes' },
  { key: 'concert', label: 'Concerts', icon: 'mic' },
  { key: 'party', label: 'Parties', icon: 'beer' },
  { key: 'bar', label: 'Bar Nights', icon: 'wine' },
  { key: 'festival', label: 'Festivals', icon: 'calendar' },
] as const;

export default function EventsScreen() {
  const navigation = useNavigation<Nav>();
  const [events, setEvents] = useState<EventItem[]>([]);
  const [organizers, setOrganizers] = useState<Organizer[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedType, setSelectedType] = useState('all');
  const [expandedOrganizer, setExpandedOrganizer] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [eventsRes, orgRes] = await Promise.all([
        supabase
          .from('events')
          .select('*, organizers:organizer_id(*)')
          .gte('event_date', new Date().toISOString())
          .eq('is_active', true)
          .order('event_date'),
        supabase.from('event_organizers').select('*').eq('is_active', true).order('name'),
      ]);

      if (eventsRes.data) setEvents(eventsRes.data as unknown as EventItem[]);
      if (orgRes.data) setOrganizers(orgRes.data);
    } catch (err) {
      console.error('[EventsScreen] fetch error:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { fetchData(); }, [fetchData]));

  const onRefresh = () => { setRefreshing(true); fetchData(); };

  const filteredEvents = selectedType === 'all'
    ? events
    : events.filter((e) => e.event_type === selectedType);

  // Used to send no pickup, so RideConfirmation fell back to a fixed point in
  // Port of Spain. Use where the rider actually is.
  const rideToVenue = async (ev: EventItem) => {
    let pickup: { latitude: number; longitude: number; address: string } | undefined;
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const pos = (await Location.getLastKnownPositionAsync()) || (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
        if (pos) pickup = { latitude: pos.coords.latitude, longitude: pos.coords.longitude, address: 'Current location' };
      }
    } catch { /* falls through to the toast */ }
    if (!pickup) { toast('Turn on location so we know where to pick you up.', 'error'); return; }
    (navigation.navigate as any)('RideConfirmation', {
      pickup,
      destination: { latitude: ev.lat, longitude: ev.lng, address: ev.venue },
      source: 'events',
      sourceMetadata: { organizer_id: ev.organizer_id, event_id: ev.id, band_id: ev.band_id, event_type: ev.event_type },
    });
  };

  const m = useTheme();
  const insets = useSafeAreaInsets();
  const orgName = (id: string) => organizers.find(o => o.id === id)?.name || events.find(e => e.organizer_id === id)?.organizers?.name;

  return (
    <View style={{ flex: 1, backgroundColor: m.page }}>
      <StatusBar style={m.statusBar} />
      <Header title="Events and nightlife" onBack={() => navigation.goBack()} />
      {loading ? <Loading /> : (
        <FlatList
          data={filteredEvents}
          keyExtractor={(e) => e.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={m.accent} />}
          contentContainerStyle={{ paddingHorizontal: GUTTER, paddingBottom: insets.bottom + SPACE.xxl }}
          ListHeaderComponent={
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -GUTTER, marginTop: SPACE.sm, marginBottom: SPACE.md }} contentContainerStyle={{ paddingHorizontal: GUTTER }}>
              {TYPE_TABS.map((tab) => (
                <Chip key={tab.key} icon={tab.icon as any} label={tab.label} selected={selectedType === tab.key} onPress={() => setSelectedType(tab.key)} />
              ))}
            </ScrollView>
          }
          renderItem={({ item: ev }) => {
            const d = new Date(ev.event_date);
            return (
              <Card style={{ marginBottom: SPACE.md }}>
                <View style={{ flexDirection: 'row' }}>
                  <View style={{ width: 56, alignItems: 'center', paddingVertical: SPACE.sm, borderRadius: 14, backgroundColor: m.field }}>
                    <Txt variant="overline" tone="accent">{d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase()}</Txt>
                    <Txt variant="title">{d.getDate()}</Txt>
                  </View>
                  <View style={{ flex: 1, marginLeft: SPACE.md }}>
                    <Txt variant="headline" numberOfLines={2}>{ev.name}</Txt>
                    <Txt variant="caption" tone="dim" numberOfLines={1}>{[orgName(ev.organizer_id), ev.venue].filter(Boolean).join(' · ')}</Txt>
                    <Txt variant="caption" tone="dim">
                      {d.toLocaleDateString('en-US', { weekday: 'short' })} {d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                      {ev.ticket_price_cents > 0 ? ` · TT$${(ev.ticket_price_cents / 100).toFixed(2)}` : ''}
                    </Txt>
                  </View>
                </View>
                {ev.description ? <Txt variant="body" tone="dim" numberOfLines={3} style={{ marginTop: SPACE.md }}>{ev.description}</Txt> : null}
                <View style={{ flexDirection: 'row', gap: SPACE.md, marginTop: SPACE.md }}>
                  {ev.lat && ev.lng ? <Button title="Ride there" icon="car-outline" size="md" style={{ flex: 1 }} onPress={() => rideToVenue(ev)} /> : null}
                  {ev.ticket_url ? <Button title="Tickets" size="md" variant="secondary" style={{ flex: 1 }} onPress={() => Linking.openURL(ev.ticket_url)} /> : null}
                </View>
              </Card>
            );
          }}
          ListEmptyComponent={<EmptyState icon="calendar-outline" title="Nothing listed yet" body="Fetes, concerts and nights out will show up here." />}
        />
      )}
    </View>
  );
}
