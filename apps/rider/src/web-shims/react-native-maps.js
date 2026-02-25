import React from 'react';
import { View, Text } from 'react-native';

const MapView = (props) => {
    return (
        <View style={{ flex: 1, backgroundColor: '#111', justifyContent: 'center', alignItems: 'center' }}>
            <Text style={{ color: 'white', fontWeight: 'bold' }}>[WEB MAP PLACEHOLDER]</Text>
            <Text style={{ color: '#888', fontSize: 10 }}>Native Maps not supported in web audit</Text>
            {props.children}
        </View>
    );
};

export const Marker = (props) => <View>{props.children}</View>;
Marker.Animated = (props) => <View>{props.children}</View>;
export const Polyline = () => null;
export const PROVIDER_GOOGLE = 'google';
export const PROVIDER_DEFAULT = 'default';
export const Callout = (props) => <View>{props.children}</View>;

export class AnimatedRegion {
    constructor(obj) { Object.assign(this, obj); }
    setValue() { }
    addListener() { }
    removeListener() { }
    stopAnimation() { }
    timing() { return { start: (cb) => cb && cb() }; }
    spring() { return { start: (cb) => cb && cb() }; }
}

export default MapView;
