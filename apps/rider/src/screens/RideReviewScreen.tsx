import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, useWindowDimensions,
  ScrollView, Alert, Platform,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MapView, { Marker, Polyline, PROVIDER_DEFAULT } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Reanimated, {
  useSharedValue, useAnimatedStyle, withSpring,
} from 'react-native-reanimated';
import { GlassCard } from '@gtaxi/design-system/native';
import { elevationGlow, glassSurface, ghostBorder } from '@gtaxi/design-system/utils/style-rules';
import { supabase } from '@gtaxi/core';

const THEME = {
  accent: '#34E6EC',
  bg: '#050505',
  textPrimary: '#EAF3F6',
  textSecondary: 'rgba(255,255,255,0.6)',
  textMuted: 'rgba(255,255,255,0.35)',
  glassBg: 'rgba(5,5,5,0.85)',
  borderGlass: 'rgba(0,255,255,0.15)',
  green: '#00FF94',
  gold: '#F59E0B',
  red: '#DC2626',
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
      Alert.alert('Missing Stops', 'Please add at least a pickup and dropoff location.');
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
      Alert.alert('Failed to Create Ride', err.message || 'Please try again.');
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

  return (
    <View style={s.root}>
      <StatusBar style="light" />

      {/* Back Button */}
      <TouchableOpacity
        style={[s.backBtn, { top: insets.top + 12 }]}
        onPress={() => navigation.goBack()}
        activeOpacity={0.85}
      >
        <Ionicons name="chevron-back" size={24} color={THEME.textPrimary} />
      </TouchableOpacity>

      {/* Map Thumbnail */}
      <View style={s.mapContainer}>
        <MapView
          style={StyleSheet.absoluteFill}
          provider={PROVIDER_DEFAULT}
          customMapStyle={DARK_MAP_STYLE}
          initialRegion={{
            latitude: getCenterLat(),
            longitude: getCenterLng(),
            latitudeDelta: 0.08,
            longitudeDelta: 0.08,
          }}
          scrollEnabled={false}
          zoomEnabled={false}
          rotateEnabled={false}
        >
          {stops.filter(s => s.lat).map((stop, i) => (
            <Marker key={`marker-${i}`} coordinate={{ latitude: stop.lat, longitude: stop.lng }}>
              <View style={[s.markerDot, { backgroundColor: STOP_ICONS[stop.type]?.color || THEME.accent }]}>
                <Text style={s.markerIndex}>{i + 1}</Text>
              </View>
            </Marker>
          ))}
          {stops.filter(s => s.lat).length >= 2 && (
            <Polyline
              coordinates={stops.filter(s => s.lat).map(s => ({ latitude: s.lat, longitude: s.lng }))}
              strokeColor={THEME.accent}
              strokeWidth={2}
              lineDashPattern={[6, 4]}
            />
          )}
        </MapView>
      </View>

      {/* Validation Warning */}
      {params.validation_required && (
        <GlassCard style={s.warningBanner}>
          <Ionicons name="warning" size={16} color={THEME.gold} />
          <Text style={s.warningText}>Location unclear. Please verify the stops below.</Text>
        </GlassCard>
      )}

      {/* Stop Timeline */}
      <View style={[s.timelinePanel, { paddingTop: insets.top + 80, paddingBottom: insets.bottom + 120 }]}>
        <ScrollView
          style={s.timelineScroll}
          contentContainerStyle={s.timelineContent}
          showsVerticalScrollIndicator={false}
        >
          <Text style={s.timelineTitle}>Your Route</Text>

          {stops.map((stop, i) => {
            const icon = STOP_ICONS[stop.type];
            return (
              <View key={`stop-${i}`} style={s.stopRow}>
                <View style={s.stopTimelineCol}>
                  <View style={[s.stopDot, { backgroundColor: icon?.color || THEME.accent }]}>
                    <Ionicons name={icon?.icon as any} size={14} color={THEME.bg} />
                  </View>
                  {i < stops.length - 1 && <View style={s.stopLine} />}
                </View>

                <View style={s.stopContent}>
                  <Text style={s.stopType}>{STOP_LABELS[stop.type] || 'Stop'}</Text>
                  <Text style={s.stopAddress} numberOfLines={2}>
                    {stop.address || 'Location pending...'}
                  </Text>
                  {stop.lat === 0 && (
                    <Text style={s.stopUnresolved}>Unresolved — will search on map</Text>
                  )}
                </View>

                <TouchableOpacity
                  style={s.editBtn}
                  onPress={() => {
                    navigation.navigate('DestinationSearch', {
                      editStopIndex: i,
                      currentStops: stops,
                    });
                  }}
                  activeOpacity={0.7}
                >
                  <Ionicons name="pencil" size={16} color={THEME.textMuted} />
                </TouchableOpacity>
              </View>
            );
          })}
        </ScrollView>

        {/* Fare Summary Chip */}
        <GlassCard style={s.fareCard}>
          <View style={s.fareRow}>
            <Ionicons name="cash-outline" size={18} color={THEME.accent} />
            <Text style={s.fareLabel}>Est. Fare</Text>
            <Text style={s.fareValue}>TTD ${fareDollars}</Text>
          </View>
          <View style={s.fareDivider} />
          <View style={s.fareMeta}>
            <View style={s.fareMetaItem}>
              <Ionicons name="navigate-outline" size={14} color={THEME.textMuted} />
              <Text style={s.fareMetaText}>{totalDistanceKm} km</Text>
            </View>
            <View style={s.fareMetaItem}>
              <Ionicons name="time-outline" size={14} color={THEME.textMuted} />
              <Text style={s.fareMetaText}>~{totalDurationMin} min</Text>
            </View>
            <View style={s.fareMetaItem}>
              <Ionicons name="flag-outline" size={14} color={THEME.textMuted} />
              <Text style={s.fareMetaText}>{stops.length} stop{stops.length > 1 ? 's' : ''}</Text>
            </View>
          </View>
        </GlassCard>

        {/* Confirm Button */}
        <TouchableOpacity
          style={[s.confirmBtn, isCreating && s.confirmBtnDisabled]}
          onPress={handleCreateRide}
          disabled={isCreating}
          activeOpacity={0.85}
        >
          <Ionicons name="car-sport-sharp" size={22} color={THEME.bg} />
          <Text style={s.confirmBtnText}>
            {isCreating ? 'Requesting...' : 'Confirm Ride'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: THEME.bg,
  },
  backBtn: {
    position: 'absolute',
    left: 16,
    zIndex: 30,
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: THEME.glassBg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: THEME.borderGlass,
  },
  mapContainer: {
    height: 240,
    width: '100%',
  },
  markerDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: THEME.bg,
  },
  markerIndex: {
    fontSize: 12,
    fontWeight: '800',
    color: THEME.bg,
  },
  warningBanner: {
    marginHorizontal: 16,
    marginTop: -40,
    zIndex: 25,
    padding: 12,
  },
  warningText: {
    fontSize: 12,
    fontWeight: '600',
    color: THEME.gold,
    marginTop: 4,
  },
  timelinePanel: {
    flex: 1,
    paddingHorizontal: 16,
  },
  timelineScroll: {
    flex: 1,
  },
  timelineContent: {
    paddingTop: 16,
    paddingBottom: 8,
  },
  timelineTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: THEME.textPrimary,
    marginBottom: 20,
    letterSpacing: -0.5,
  },
  stopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 4,
  },
  stopTimelineCol: {
    width: 32,
    alignItems: 'center',
  },
  stopDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopLine: {
    width: 2,
    flex: 1,
    minHeight: 40,
    backgroundColor: 'rgba(0,255,255,0.2)',
    marginVertical: 4,
  },
  stopContent: {
    flex: 1,
    marginLeft: 12,
    paddingBottom: 16,
  },
  stopType: {
    fontSize: 11,
    fontWeight: '700',
    color: THEME.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  stopAddress: {
    fontSize: 15,
    fontWeight: '600',
    color: THEME.textPrimary,
    lineHeight: 20,
  },
  stopUnresolved: {
    fontSize: 11,
    fontWeight: '500',
    color: THEME.gold,
    marginTop: 2,
  },
  editBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
    marginTop: 4,
  },
  fareCard: {
    ...elevationGlow(),
    padding: 16,
    marginBottom: 16,
  },
  fareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  fareLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: THEME.textSecondary,
    flex: 1,
  },
  fareValue: {
    fontSize: 20,
    fontWeight: '800',
    color: THEME.accent,
    fontVariant: ['tabular-nums'],
  },
  fareDivider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginVertical: 12,
  },
  fareMeta: {
    flexDirection: 'row',
    gap: 20,
  },
  fareMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  fareMetaText: {
    fontSize: 12,
    fontWeight: '600',
    color: THEME.textMuted,
    fontVariant: ['tabular-nums'],
  },
  confirmBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 18,
    borderRadius: 16,
    backgroundColor: THEME.accent,
    shadowColor: '#34E6EC',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
    elevation: 8,
  },
  confirmBtnDisabled: {
    opacity: 0.6,
  },
  confirmBtnText: {
    fontSize: 16,
    fontWeight: '800',
    color: THEME.bg,
    letterSpacing: 0.3,
  },
});
