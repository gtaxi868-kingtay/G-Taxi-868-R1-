import React, { useState, useCallback } from 'react';
import { View, StyleSheet, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MapView, { Marker, Polyline, PROVIDER_DEFAULT } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Reanimated, {
  useSharedValue, useAnimatedStyle, withSpring,
} from 'react-native-reanimated';
import { toast } from '../components/Toast';
import { Button, Card, RADIUS, Screen, Section, SPACE, Txt, useTheme } from '../ui/kit';
import { supabase } from '@gtaxi/core';

const THEME = {
  accent: '#34E6EC',
  bg: '#050505',
  textPrimary: '#EAF3F6',
  textSecondary: 'rgba(255,255,255,0.6)',
  textMuted: 'rgba(255,255,255,0.35)',
  glassBg: 'rgba(5,5,5,0.85)',
  borderGlass: 'rgba(0,255,255,0.15)',
  green: '#2FB57C',
  gold: '#F5A524',
  red: '#E5484D',
};

const DARK_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#050505' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#34E6EC' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#050505' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#0A0A0A' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#34E6EC', weight: 0.5 }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#34E6EC', lightness: -80 }] },
];

interface Stop {
  type: 'pickup' | 'stop' | 'dropoff';
  address: string;
  lat: number;
  lng: number;
}

interface RideReviewParams {
  stops: Stop[];
  service_type: string;
  estimated_fare_cents: number;
  total_duration_seconds: number;
  total_distance_meters: number;
  validation_required: boolean;
  raw_query: string;
}

const STOP_ICONS: Record<string, { icon: keyof typeof Ionicons.glyphMap; color: string }> = {
  pickup: { icon: 'radio-button-on', color: THEME.green },
  stop: { icon: 'ellipse', color: THEME.gold },
  dropoff: { icon: 'location-sharp', color: THEME.red },
};

const STOP_LABELS: Record<string, string> = {
  pickup: 'Pickup',
  stop: 'Stop',
  dropoff: 'Dropoff',
};

export default function RideReviewScreen({ route, navigation }: any) {
  const insets = useSafeAreaInsets();
  const { height: SCREEN_HEIGHT } = useWindowDimensions();
  const params: RideReviewParams = route.params;
  const [isCreating, setIsCreating] = useState(false);
  const [stops, setStops] = useState<Stop[]>(params.stops);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const dragY = useSharedValue(0);

  const fareDollars = (params.estimated_fare_cents / 100).toFixed(2);
  const totalDurationMin = params.stops.length >= 2 ? Math.round(params.total_duration_seconds / 60) : 0;
  const totalDistanceKm = params.total_distance_meters ? (params.total_distance_meters / 1000).toFixed(1) : '—';

  const getCenterLat = useCallback(() => {
    const lats = stops.filter(s => s.lat).map(s => s.lat);
    return lats.reduce((a, b) => a + b, 0) / lats.length || 10.65;
  }, [stops]);

  const getCenterLng = useCallback(() => {
    const lngs = stops.filter(s => s.lng).map(s => s.lng);
    return lngs.reduce((a, b) => a + b, 0) / lngs.length || -61.5;
  }, [stops]);

  const handleCreateRide = async () => {
    if (stops.length < 2) {
      toast('Add a pickup and a drop-off first.', 'error');
      return;
    }

    const pickup = stops[0];
    const dropoff = stops[stops.length - 1];
    const intermediateStops = stops.slice(1, -1).map((s, i) => ({
      place_name: s.address,
      place_address: s.address,
      lat: s.lat,
      lng: s.lng,
      stop_type: 'waypoint',
      estimated_wait_minutes: 5,
    }));

    setIsCreating(true);
    try {
      const { data, error } = await supabase.functions.invoke('create_ride', {
        body: {
          pickup_lat: pickup.lat,
          pickup_lng: pickup.lng,
          pickup_address: pickup.address,
          dropoff_lat: dropoff.lat,
          dropoff_lng: dropoff.lng,
          dropoff_address: dropoff.address,
          vehicle_type: 'Standard',
          payment_method: 'cash',
          stops: intermediateStops,
          source: 'ai_conversational',
          source_metadata: { raw_query: params.raw_query, validation_required: params.validation_required },
          identity_verified: false,
        }
      });

      if (error) throw new Error(error);
      if (!data?.data?.ride_id) throw new Error('No ride_id returned');

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      navigation.replace('SearchingDriver', {
        rideId: data.data.ride_id,
        destination: dropoff,
        fare: { total_fare_cents: params.estimated_fare_cents },
        pickup: pickup,
      });
    } catch (err: any) {
      toast(err.message || 'Could not book the ride. Please try again.', 'error');
    } finally {
      setIsCreating(false);
    }
  };

  const moveStop = (fromIndex: number, toIndex: number) => {
    if (toIndex < 0 || toIndex >= stops.length) return;
    if (fromIndex === 0 || toIndex === 0) return;
    if (fromIndex === stops.length - 1 || toIndex === stops.length - 1) return;
    const updated = [...stops];
    const [moved] = updated.splice(fromIndex, 1);
    updated.splice(toIndex, 0, moved);
    setStops(updated);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const m = useTheme();
  // The old pencil buttons opened DestinationSearch with params it does not
  // read (editStopIndex), which booked a new ride instead of editing a stop.
  // Editing stops here is not supported, so they are gone.
  return (
    <Screen
      title="Your route"
      onBack={() => navigation.goBack()}
      footer={<Button title={`Confirm ride · TT$${fareDollars}`} icon="car-sport" loading={isCreating} onPress={handleCreateRide} />}
    >
      <View style={{ height: 180, borderRadius: RADIUS.card, overflow: 'hidden', marginTop: SPACE.sm }}>
        <MapView style={StyleSheet.absoluteFill} provider={PROVIDER_DEFAULT} customMapStyle={m.key === 'night' ? DARK_MAP_STYLE : []}
          initialRegion={{ latitude: getCenterLat(), longitude: getCenterLng(), latitudeDelta: 0.08, longitudeDelta: 0.08 }}
          scrollEnabled={false} zoomEnabled={false} rotateEnabled={false}>
          {stops.filter(st => st.lat).map((stop, i) => (
            <Marker key={`marker-${i}`} coordinate={{ latitude: stop.lat, longitude: stop.lng }}>
              <View style={{ width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#FFFFFF', backgroundColor: STOP_ICONS[stop.type]?.color || '#8B7CFF' }}>
                <Txt variant="label" tone="onBrand">{i + 1}</Txt>
              </View>
            </Marker>
          ))}
          {stops.filter(st => st.lat).length >= 2 && (
            <Polyline coordinates={stops.filter(st => st.lat).map(st => ({ latitude: st.lat, longitude: st.lng }))} strokeColor="#8B7CFF" strokeWidth={3} />
          )}
        </MapView>
      </View>

      {params.validation_required && (
        <Card style={{ marginTop: SPACE.md, flexDirection: 'row', alignItems: 'center' }}>
          <Ionicons name="alert-circle-outline" size={18} color="#D97706" />
          <Txt variant="body" style={{ flex: 1, marginLeft: SPACE.sm }}>We were not sure about some places. Please check the stops below.</Txt>
        </Card>
      )}

      <Section title="Stops">
        <Card>
          {stops.map((stop, i) => (
            <View key={`stop-${i}`} style={{ flexDirection: 'row' }}>
              <View style={{ alignItems: 'center', width: 28 }}>
                <View style={{ width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: STOP_ICONS[stop.type]?.color || '#8B7CFF' }}>
                  <Ionicons name={STOP_ICONS[stop.type]?.icon as any} size={12} color="#FFFFFF" />
                </View>
                {i < stops.length - 1 && <View style={{ width: 2, flex: 1, minHeight: 18, backgroundColor: m.chipBorder }} />}
              </View>
              <View style={{ flex: 1, marginLeft: SPACE.md, paddingBottom: i < stops.length - 1 ? SPACE.lg : 0 }}>
                <Txt variant="caption" tone="faint">{STOP_LABELS[stop.type] || 'Stop'}</Txt>
                <Txt variant="bodyStrong" numberOfLines={2}>{stop.address || 'Location not found yet'}</Txt>
                {stop.lat === 0 && <Txt variant="caption" style={{ color: '#D97706' }}>We could not place this on the map</Txt>}
              </View>
            </View>
          ))}
        </Card>
      </Section>

      <Card style={{ marginTop: SPACE.md, flexDirection: 'row' }}>
        {[[`TT$${fareDollars}`, 'Estimated fare'], [`${totalDistanceKm} km`, 'Distance'], [`~${totalDurationMin} min`, 'Time']].map(([v, l], i) => (
          <View key={l} style={{ flex: 1, alignItems: 'center', borderLeftWidth: i ? 1 : 0, borderLeftColor: m.chipBorder }}>
            <Txt variant="headline">{v}</Txt>
            <Txt variant="caption" tone="dim">{l}</Txt>
          </View>
        ))}
      </Card>
    </Screen>
  );
}
