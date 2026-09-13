import React, { useEffect, useState, useCallback } from 'react';
import { View, StyleSheet, ActivityIndicator, Text } from 'react-native';
import MapView, { Marker, UrlTile, PROVIDER_DEFAULT } from 'react-native-maps';
import { ENV, DEFAULT_LOCATION, initializeSupabaseClient } from '@gtaxi/core';

const { supabase } = initializeSupabaseClient('native');

interface DriverLocation {
  driver_id: string;
  lat: number;
  lng: number;
  heading?: number | null;
}

interface KioskNode {
  id: string;
  location_name: string;
  lat: number | null;
  lng: number | null;
  is_active: boolean;
  merchant_id: string | null;
}

const POLL_MS = 8000;

// Same reasoning as apps/admin/src/components/DriverMap.tsx: driver_locations
// has no admin RLS policy, so a direct client subscription would silently see
// nothing. Relay through the admin edge function (service role) and poll —
// this is the only real source of "where are the drivers right now" today.
//
// Uses react-native-maps (native map, no extra native config needed with
// PROVIDER_DEFAULT) with a Mapbox raster tile overlay for the dark style —
// the same pattern already proven in apps/driver/src/screens/DashboardScreen.tsx,
// instead of a WebGL-based map library, which has no equivalent on native anyway.
export function LiveOpsMap({ nodes }: { nodes: KioskNode[] }) {
  const [locations, setLocations] = useState<DriverLocation[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchLocations = useCallback(async () => {
    try {
      const { data, error } = await supabase.functions.invoke('admin', {
        body: { action: 'list_driver_locations' },
      });
      if (error) throw error;
      if (data?.success) setLocations(data.locations || []);
    } catch (err) {
      console.error('[LiveOpsMap] fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLocations();
    const interval = setInterval(fetchLocations, POLL_MS);
    return () => clearInterval(interval);
  }, [fetchLocations]);

  if (!ENV.MAPBOX_PUBLIC_TOKEN) {
    return (
      <View style={styles.offline}>
        <Text style={styles.offlineTitle}>Geospatial Link Offline</Text>
        <Text style={styles.offlineDesc}>EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN missing</Text>
      </View>
    );
  }

  const nodesWithLocation = nodes.filter(n => n.lat != null && n.lng != null);

  return (
    <View style={styles.container}>
      <MapView
        style={StyleSheet.absoluteFillObject}
        provider={PROVIDER_DEFAULT}
        initialRegion={{
          latitude: DEFAULT_LOCATION.latitude,
          longitude: DEFAULT_LOCATION.longitude,
          latitudeDelta: 0.4,
          longitudeDelta: 0.4,
        }}
      >
        <UrlTile
          urlTemplate={`https://api.mapbox.com/styles/v1/mapbox/dark-v11/tiles/256/{z}/{x}/{y}@2x?access_token=${ENV.MAPBOX_PUBLIC_TOKEN}`}
          shouldReplaceMapContent
          maximumZ={19}
        />

        {locations.map(loc => (
          <Marker
            key={`driver-${loc.driver_id}`}
            coordinate={{ latitude: loc.lat, longitude: loc.lng }}
            title="Driver"
          >
            <View style={styles.driverMarker} />
          </Marker>
        ))}

        {nodesWithLocation.map(node => (
          <Marker
            key={`node-${node.id}`}
            coordinate={{ latitude: node.lat as number, longitude: node.lng as number }}
            title={node.location_name}
          >
            <View style={[styles.nodeMarker, { opacity: node.is_active ? 1 : 0.35 }]} />
          </Marker>
        ))}
      </MapView>

      <View style={styles.legend}>
        <View style={styles.legendRow}>
          <View style={styles.driverMarker} />
          <Text style={styles.legendText}>Drivers ({locations.length})</Text>
        </View>
        <View style={styles.legendRow}>
          <View style={styles.nodeMarker} />
          <Text style={styles.legendText}>Nodes ({nodesWithLocation.length})</Text>
        </View>
      </View>

      {loading && (
        <View style={styles.loadingBadge}>
          <ActivityIndicator size="small" color="#fff" />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, borderRadius: 16, overflow: 'hidden' },
  offline: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#0B0E12', borderRadius: 16, minHeight: 240,
  },
  offlineTitle: { color: '#f87171', fontSize: 11, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 2 },
  offlineDesc: { color: 'rgba(255,255,255,0.3)', fontSize: 9, fontWeight: '700' },
  driverMarker: {
    width: 14, height: 14, borderRadius: 7,
    backgroundColor: '#A78BFA', borderWidth: 2, borderColor: '#fff',
  },
  nodeMarker: {
    width: 12, height: 12, borderRadius: 3,
    backgroundColor: '#7DD3FC', borderWidth: 2, borderColor: '#fff',
  },
  legend: {
    position: 'absolute', top: 12, left: 12,
    backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 10,
    paddingVertical: 8, paddingHorizontal: 10, gap: 6,
  },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  legendText: { color: 'rgba(255,255,255,0.8)', fontSize: 10, fontWeight: '700' },
  loadingBadge: {
    position: 'absolute', top: 12, right: 12,
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center',
  },
});
