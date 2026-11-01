import React from 'react';
import { View } from 'react-native';

// react-native-maps has no web build; the web preview only shows the layout.
export function PinMap(_: { latitude: number; longitude: number; onSettled: (latitude: number, longitude: number) => void }) {
    return <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#DDE3EA' }} />;
}
