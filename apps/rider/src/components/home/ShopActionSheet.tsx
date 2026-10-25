import React from 'react';
import { Image, Modal, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GUTTER, RADIUS, shade, SPACE, Txt, useTheme } from '../../ui/kit';
import { KeyTile } from '../KeyTile';
import { toast } from '../Toast';
import { formatDistance, shopLook } from './shopLook';
import type { MapShop } from './rankShops';

export type ShopAction = 'ride' | 'stop' | 'grab' | 'deliver';

// What the rider can do with a shop (founder decision 2026-10-24): all four,
// rider chooses. "Driver grabs it" is shown but not live: it needs a prepaid
// order linked to a ride stop, and ride_stops has no order/merchant column yet
// (a database change that is the founder's call). So it explains itself
// instead of pretending to work.
export function ShopActionSheet({ shop, onClose, onAction }: { shop: MapShop | null; onClose: () => void; onAction: (a: ShopAction, s: MapShop) => void }) {
    const m = useTheme();
    const insets = useSafeAreaInsets();
    if (!shop) return null;
    const look = shopLook(shop.store_type, shop.category);
    const dist = formatDistance(shop.distance_m);
    const act = (a: ShopAction) => { onClose(); onAction(a, shop); };

    return (
        <Modal visible transparent animationType="slide" onRequestClose={onClose}>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(10,6,20,0.45)' }} />
            <View style={{ backgroundColor: m.sheet[1], borderTopLeftRadius: RADIUS.sheet, borderTopRightRadius: RADIUS.sheet,
                paddingHorizontal: GUTTER, paddingTop: SPACE.md, paddingBottom: Math.max(insets.bottom, SPACE.lg) + SPACE.sm }}>
                <View style={{ width: 44, height: 5, borderRadius: 3, backgroundColor: m.chipBorder, alignSelf: 'center', marginBottom: SPACE.lg }} />

                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <View style={{ width: 56, height: 56, borderRadius: 16, overflow: 'hidden', backgroundColor: look.color, borderBottomWidth: 4, borderColor: shade(look.color), alignItems: 'center', justifyContent: 'center' }}>
                        {shop.cover_image_url
                            ? <Image source={{ uri: shop.cover_image_url }} style={{ width: 56, height: 56 }} />
                            : <Ionicons name={look.icon} size={28} color="#FFFFFF" />}
                    </View>
                    <View style={{ flex: 1, marginLeft: SPACE.md }}>
                        <Txt variant="title" numberOfLines={1}>{shop.name}</Txt>
                        <Txt variant="caption" tone="dim" numberOfLines={1}>
                            {look.label}{dist ? ` · ${dist} away` : ''} · {shop.is_open ? 'Open now' : 'Closed'}
                        </Txt>
                    </View>
                </View>

                <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: SPACE.lg, marginHorizontal: -SPACE.xs }}>
                    <View style={{ width: '50%', paddingHorizontal: SPACE.xs, marginBottom: SPACE.md }}>
                        <KeyTile size="wide" title="Ride there" subtitle="Go to this shop" icon="car-sport" color="#8B7CFF" onPress={() => act('ride')} />
                    </View>
                    <View style={{ width: '50%', paddingHorizontal: SPACE.xs, marginBottom: SPACE.md }}>
                        <KeyTile size="wide" title="Stop on my way" subtitle="Add it to your trip" icon="git-branch" color="#4C9AFF" onPress={() => act('stop')} />
                    </View>
                    <View style={{ width: '50%', paddingHorizontal: SPACE.xs, marginBottom: SPACE.md }}>
                        <KeyTile size="wide" title="Driver grabs it" subtitle="Coming soon" icon="bag-handle" color={m.key === 'night' ? '#4A4058' : '#B9AFC9'}
                            onPress={() => toast('Coming soon: order and pay ahead, and your driver collects it on the way.')} />
                    </View>
                    <View style={{ width: '50%', paddingHorizontal: SPACE.xs, marginBottom: SPACE.md }}>
                        <KeyTile size="wide" title="Deliver to me" subtitle="Order from here" icon="bicycle" color="#2FB57C" onPress={() => act('deliver')} />
                    </View>
                </View>
            </View>
        </Modal>
    );
}
