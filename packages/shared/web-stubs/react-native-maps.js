// Web stub for react-native-maps.
// react-native-maps has no web target (it wraps native Google/Apple Maps SDKs via codegen,
// which crashes Metro's web bundler). This stub lets rider/driver bundle for web preview —
// it renders a placeholder instead of a real map. Native builds never touch this file.
import React, { forwardRef, useImperativeHandle } from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';

const MapView = forwardRef(function MapView(props, ref) {
  useImperativeHandle(ref, () => ({
    animateToRegion: () => {},
    animateCamera: () => {},
    fitToCoordinates: () => {},
    fitToSuppliedMarkers: () => {},
    getCamera: async () => ({}),
    setCamera: () => {},
  }));
  // Web preview: show a still Mapbox image of the same place and style the
  // phone map would show, so design previews match the phone. The style and
  // token come from the screen's own <UrlTile> child.
  const region = props.region || props.initialRegion;
  let still = null;
  React.Children.forEach(props.children, (child) => {
    const t = child && child.props && child.props.urlTemplate;
    if (typeof t === 'string' && t.includes('api.mapbox.com/styles/v1/')) {
      const m = t.match(/styles\/v1\/([^/]+\/[^/]+)\/tiles.*access_token=([^&]+)/);
      if (m && region) {
        const zoom = Math.max(1, Math.min(17, Math.log2(360 / (region.longitudeDelta || 0.02)) + 0.5));
        still = `https://api.mapbox.com/styles/v1/${m[1]}/static/${region.longitude},${region.latitude},${zoom.toFixed(2)},0/600x1000@2x?access_token=${m[2]}&attribution=false&logo=false`;
      }
    }
  });
  return (
    <View style={[styles.map, props.style]}>
      {still ? (
        <Image source={{ uri: still }} resizeMode="cover" style={StyleSheet.absoluteFillObject} />
      ) : (
        <Text style={styles.label}>Map preview unavailable on web</Text>
      )}
    </View>
  );
});

export function Marker() { return null; }
// Animated marker API (used by the rider's gliding cars). No-ops on web, where
// the map is a still image.
export const MarkerAnimated = function MarkerAnimated() { return null; };
export class AnimatedRegion {
  constructor(region) { this.region = region; }
  timing() { return { start: () => {}, stop: () => {} }; }
  spring() { return { start: () => {}, stop: () => {} }; }
}
export function Polyline() { return null; }
export function Callout() { return null; }
export function UrlTile() { return null; }
export function Circle() { return null; }
export const PROVIDER_DEFAULT = 'default';
export const PROVIDER_GOOGLE = 'google';

const styles = StyleSheet.create({
  map: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: '#E9E6EF',
  },
  label: {
    color: 'rgba(242,245,248,0.42)',
    fontSize: 13,
  },
});

export default MapView;
