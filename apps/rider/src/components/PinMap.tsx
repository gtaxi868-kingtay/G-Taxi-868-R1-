import React from 'react';
import { StyleSheet } from 'react-native';
import MapView, { PROVIDER_DEFAULT } from 'react-native-maps';

// The map under the fixed centre pin on PinOnMapScreen. The rider moves the
// map, not the pin, which is far easier with a thumb.
export function PinMap({ latitude, longitude, onSettled }: {
    latitude: number; longitude: number; onSettled: (latitude: number, longitude: number) => void;
}) {
    return (
        <MapView
            style={StyleSheet.absoluteFillObject}
            provider={PROVIDER_DEFAULT}
            showsUserLocation
            showsMyLocationButton={false}
            initialRegion={{ latitude, longitude, latitudeDelta: 0.006, longitudeDelta: 0.006 }}
            onRegionChangeComplete={(r) => onSettled(r.latitude, r.longitude)}
        />
    );
}
