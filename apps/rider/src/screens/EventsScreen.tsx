import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, RefreshControl, SafeAreaView,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@gtaxi/core';
import type { AppStackParamList } from '../navigation/types';

const BRAND = '#FF2D55';
const CYAN = '#1DE0E6';

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

  const rideToVenue = (ev: EventItem) => {
    const organizerId = ev.organizer_id;
    (navigation.navigate as any)('RideConfirmation', {
      destination: { latitude: ev.lat, longitude: ev.lng, address: ev.venue },
      source: 'events',
      sourceMetadata: {
        organizer_id: organizerId,
        event_id: ev.id,
        band_id: ev.band_id,
        event_type: ev.event_type,
      },
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
        <Text style={s.headerTitle}>Events & Nightlife</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={s.tabRow}>
        {TYPE_TABS.map((tab) => (
          <TouchableOpacity
            key={tab.key}
            style={[s.tab, selectedType === tab.key && s.tabActive]}
            onPress={() => setSelectedType(tab.key)}
          >
            <Ionicons
              name={tab.icon as any}
              size={14}
              color={selectedType === tab.key ? '#fff' : '#666'}
            />
            <Text style={[s.tabLabel, selectedType === tab.key && s.tabLabelActive]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={organizers}
        keyExtractor={(o) => o.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={BRAND} />}
        ListHeaderComponent={() => (
          <Text style={s.sectionTitle}>
            {selectedType === 'all' ? 'Everything happening' : `${selectedType.charAt(0).toUpperCase() + selectedType.slice(1)}s`}
          </Text>
        )}
        renderItem={({ item: organizer }) => {
          const orgEvents = filteredEvents.filter((e) => e.organizer_id === organizer.id);
          if (orgEvents.length === 0) return null;
          const isExpanded = expandedOrganizer === organizer.id;
          return (
            <TouchableOpacity
              style={s.orgCard}
              onPress={() => setExpandedOrganizer(isExpanded ? null : organizer.id)}
              activeOpacity={0.7}
            >
              <View style={s.orgRow}>
                <View style={[s.orgAvatar, organizer.is_band && s.orgAvatarBand]}>
                  <Ionicons
                    name={organizer.is_band ? 'musical-note' : 'calendar'}
                    size={22}
                    color="#fff"
                  />
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={s.orgName}>{organizer.name}</Text>
                  <Text style={s.orgCount}>
                    {orgEvents.length} {orgEvents.length === 1 ? 'event' : 'events'}
                  </Text>
                </View>
                <Ionicons
                  name={isExpanded ? 'chevron-up' : 'chevron-down'}
                  size={20}
                  color="#666"
                />
              </View>

              {isExpanded && (
                <View style={s.orgDetail}>
                  {orgEvents.map((ev) => (
                    <View key={ev.id} style={s.eventCard}>
                      <Text style={s.eventTypeBadge}>{ev.event_type}</Text>
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
                        <TouchableOpacity style={s.rideBtn} onPress={() => rideToVenue(ev)}>
                          <Ionicons name="car" size={16} color="#fff" />
                          <Text style={s.rideBtnText}>Ride to venue</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  ))}
                </View>
              )}
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={
          <View style={{ padding: 40, alignItems: 'center' }}>
            <Ionicons name="calendar-outline" size={48} color="#444" />
            <Text style={s.emptyText}>No events listed yet</Text>
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
    backgroundColor: '#0A0A0F',
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
  tabRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
    flexWrap: 'wrap',
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#1A1A2E',
    gap: 4,
  },
  tabActive: {
    backgroundColor: BRAND,
  },
  tabLabel: {
    fontSize: 12,
    color: '#666',
    fontWeight: '500',
  },
  tabLabelActive: {
    color: '#fff',
  },
  listContent: {
    paddingBottom: 40,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 12,
  },
  orgCard: {
    backgroundColor: '#13132B',
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 16,
    padding: 16,
  },
  orgRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  orgAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: CYAN + '30',
    alignItems: 'center',
    justifyContent: 'center',
  },
  orgAvatarBand: {
    backgroundColor: BRAND + '30',
  },
  orgName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
  orgCount: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  orgDetail: {
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
  eventTypeBadge: {
    fontSize: 10,
    fontWeight: '600',
    color: CYAN,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 4,
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
  rideBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: CYAN,
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
  emptyText: {
    fontSize: 14,
    color: '#444',
    marginTop: 12,
  },
});
