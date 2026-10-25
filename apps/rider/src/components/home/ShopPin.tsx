import React, { useEffect, useRef, useState } from 'react';
import { Animated, Image, View } from 'react-native';
import { Marker } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import { shade } from '../../ui/kit';
import { shopLook } from './shopLook';
import type { MapShop } from './rankShops';

// A shop on the Home map.
//   free shop: small dot in its colour
//   paid (featured) shop: logo bubble with a slow pulse
//   selected (its card is showing): grows
//
// Performance: react-native-maps re-snapshots a custom marker view on every
// frame while tracksViewChanges is true, which is what makes busy maps janky on
// mid-range Android. So tracking is on only briefly after a change (to capture
// the new size/logo) and for the pulse of a featured pin, never for plain dots.
export const ShopPin = React.memo(function ShopPin({ shop, selected, onPress }: { shop: MapShop; selected: boolean; onPress: (s: MapShop) => void }) {
    const look = shopLook(shop.store_type, shop.category);
    const featured = !!shop.is_featured;
    const [track, setTrack] = useState(true);
    useEffect(() => {
        setTrack(true);
        const t = setTimeout(() => setTrack(false), 700);
        return () => clearTimeout(t);
    }, [selected, shop.cover_image_url]);

    const pulse = useRef(new Animated.Value(0)).current;
    useEffect(() => {
        if (!featured) return;
        const loop = Animated.loop(Animated.sequence([
            Animated.timing(pulse, { toValue: 1, duration: 1600, useNativeDriver: true }),
            Animated.timing(pulse, { toValue: 0, duration: 0, useNativeDriver: true }),
            Animated.delay(900),
        ]));
        loop.start();
        return () => loop.stop();
    }, [featured]);

    const size = featured ? (selected ? 50 : 40) : (selected ? 34 : 22);

    return (
        <Marker
            coordinate={{ latitude: shop.lat, longitude: shop.lng }}
            anchor={{ x: 0.5, y: 0.5 }}
            onPress={() => onPress(shop)}
            tracksViewChanges={track || featured}
            zIndex={selected ? 20 : featured ? 10 : 5}
            accessibilityLabel={`${shop.name}${featured ? ', featured' : ''}`}
        >
            <View style={{ width: size + 24, height: size + 24, alignItems: 'center', justifyContent: 'center' }}>
                {featured ? (
                    <Animated.View pointerEvents="none" style={{
                        position: 'absolute', width: size + 20, height: size + 20, borderRadius: (size + 20) / 2, backgroundColor: look.color,
                        opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0] }),
                        transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1.2] }) }],
                    }} />
                ) : null}
                <View style={{
                    width: size, height: size, borderRadius: size / 2, overflow: 'hidden', backgroundColor: look.color,
                    borderWidth: featured || selected ? 3 : 2, borderColor: '#FFFFFF', borderBottomColor: featured || selected ? shade(look.color) : '#FFFFFF',
                    alignItems: 'center', justifyContent: 'center',
                    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 4,
                }}>
                    {featured && shop.cover_image_url
                        ? <Image source={{ uri: shop.cover_image_url }} style={{ width: size, height: size }} />
                        : <Ionicons name={look.icon} size={Math.round(size * 0.5)} color="#FFFFFF" />}
                </View>
            </View>
        </Marker>
    );
});
