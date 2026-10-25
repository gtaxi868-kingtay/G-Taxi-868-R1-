import React, { useEffect, useRef, useState } from 'react';
import { Easing, Image } from 'react-native';
import { AnimatedRegion, MarkerAnimated } from 'react-native-maps';

const CAR_ASSET = require('../../../assets/images/car_gtaxi_standard_v7.png');

// A nearby driver that glides to each new position instead of jumping.
// Positions arrive every ~30 s, rounded to ~100 m (nearby_driver_dots), so a
// short linear glide reads as "moving" without pretending to be live GPS.
// react-native-maps' documented pattern: AnimatedRegion + MarkerAnimated.
export const CarMarker = React.memo(function CarMarker({ lat, lng, heading, glide = true }: { lat: number; lng: number; heading: number; glide?: boolean }) {
    const region = useRef(new AnimatedRegion({ latitude: lat, longitude: lng, latitudeDelta: 0, longitudeDelta: 0 })).current;
    // Snapshot the image once it has rendered; never re-snapshot every frame.
    const [track, setTrack] = useState(true);
    useEffect(() => { const t = setTimeout(() => setTrack(false), 800); return () => clearTimeout(t); }, []);

    useEffect(() => {
        const anim = region.timing({
            latitude: lat, longitude: lng, latitudeDelta: 0, longitudeDelta: 0,
            duration: glide ? 2500 : 0, easing: Easing.inOut(Easing.quad), useNativeDriver: false,
        } as any);
        anim.start();
        return () => anim.stop();
    }, [lat, lng, glide]);

    return (
        <MarkerAnimated coordinate={region as any} anchor={{ x: 0.5, y: 0.5 }} rotation={heading || 0} flat tracksViewChanges={track}>
            <Image source={CAR_ASSET} style={{ width: 40, height: 40 }} resizeMode="contain" />
        </MarkerAnimated>
    );
});
