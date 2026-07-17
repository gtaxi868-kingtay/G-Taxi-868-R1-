// Web stub for react-native-maps.
// react-native-maps has no web target (it wraps native Google/Apple Maps SDKs via codegen,
// which crashes Metro's web bundler). This stub lets rider/driver bundle for web preview —
// it renders a placeholder instead of a real map. Native builds never touch this file.
import React, { forwardRef, useImperativeHandle } from 'react';
import { View, Text, StyleSheet } from 'react-native';

const MapView = forwardRef(function MapView(props, ref) {
  useImperativeHandle(ref, () => ({
    animateToRegion: () => {},
    animateCamera: () => {},
    fitToCoordinates: () => {},
    fitToSuppliedMarkers: () => {},
    getCamera: async () => ({}),
    setCamera: () => {},
  }));
  return (
    <View style={[styles.map, props.style]}>
      <Text style={styles.label}>Map preview unavailable on web</Text>
      {props.children}
    </View>
  );
});

export function Marker() { return null; }
export function Polyline() { return null; }
export function Callout() { return null; }
export function UrlTile() { return null; }
export const PROVIDER_DEFAULT = 'default';
export const PROVIDER_GOOGLE = 'google';

const styles = StyleSheet.create({
  map: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1A1F27',
  },
  label: {
    color: 'rgba(242,245,248,0.42)',
    fontSize: 13,
  },
});

export default MapView;
