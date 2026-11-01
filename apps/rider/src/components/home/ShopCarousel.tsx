import React, { useCallback, useRef } from 'react';
import { Animated, FlatList, Image, NativeScrollEvent, NativeSyntheticEvent, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GUTTER, LIP, shade, SPACE, tick, Txt, useKeyPress, useTheme } from '../../ui/kit';
import { formatDistance, shopLook } from './shopLook';
import type { MapShop } from './rankShops';

const CARD_W = 236;
const GAP = SPACE.md;
const STEP = CARD_W + GAP;

// The swipe row in the sheet's peek. Snapping to a card selects that shop (the
// map flies to it and its pin grows); tapping a card opens its actions.
//
// With few shops (the launch reality: 2 located, 0 paid) a designed "shops
// are joining" card follows the real ones, so the row never looks empty or
// broken. It never names or promises a specific shop.
type Item = { kind: 'shop'; shop: MapShop } | { kind: 'joining' };

export function ShopCarousel({ shops, selectedId, onSelect, onOpen }: {
    shops: MapShop[];
    selectedId: string | null;
    onSelect: (shop: MapShop | null) => void;
    onOpen: (shop: MapShop) => void;
}) {
    const items: Item[] = [...shops.map(shop => ({ kind: 'shop' as const, shop })), ...(shops.length < 3 ? [{ kind: 'joining' as const }] : [])];
    const lastIndex = useRef(-1);

    const onSettle = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
        const i = Math.max(0, Math.min(items.length - 1, Math.round(e.nativeEvent.contentOffset.x / STEP)));
        if (i === lastIndex.current) return;
        lastIndex.current = i;
        const it = items[i];
        onSelect(it && it.kind === 'shop' ? it.shop : null);
        if (it && it.kind === 'shop') tick();
    }, [items, onSelect]);

    return (
        <FlatList
            data={items}
            horizontal
            keyExtractor={(it) => (it.kind === 'shop' ? it.shop.id : 'joining')}
            showsHorizontalScrollIndicator={false}
            snapToInterval={STEP}
            decelerationRate="fast"
            disableIntervalMomentum
            onMomentumScrollEnd={onSettle}
            onScrollEndDrag={onSettle}
            style={{ marginHorizontal: -GUTTER, marginTop: SPACE.md }}
            contentContainerStyle={{ paddingHorizontal: GUTTER }}
            ItemSeparatorComponent={() => <View style={{ width: GAP }} />}
            renderItem={({ item }) => item.kind === 'shop'
                ? <ShopCard shop={item.shop} selected={item.shop.id === selectedId} onPress={() => { onSelect(item.shop); onOpen(item.shop); }} />
                : <JoiningCard alone={shops.length === 0} />}
        />
    );
}

function ShopCard({ shop, selected, onPress }: { shop: MapShop; selected: boolean; onPress: () => void }) {
    const m = useTheme();
    const night = m.key === 'night';
    const look = shopLook(shop.store_type, shop.category);
    const { translateY, onPressIn, onPressOut } = useKeyPress();
    const edge = selected ? look.color : night ? '#3A3049' : '#ECE6F3';
    const dist = formatDistance(shop.distance_m);
    return (
        <Pressable accessibilityRole="button" accessibilityLabel={`${shop.name}, ${shop.is_open ? 'open now' : 'closed'}${dist ? `, ${dist} away` : ''}. Tap for ride, stop or delivery.`}
            onPress={onPress} onPressIn={onPressIn} onPressOut={onPressOut} style={{ width: CARD_W }}>
            <View style={{ borderRadius: 20, backgroundColor: selected ? shade(look.color) : edge }}>
                <Animated.View style={{ borderRadius: 20, borderWidth: 2, borderColor: edge, backgroundColor: night ? '#2A2238' : '#FFFFFF',
                    padding: SPACE.md, flexDirection: 'row', alignItems: 'center', marginBottom: LIP, transform: [{ translateY }] }}>
                    <View style={{ width: 48, height: 48, borderRadius: 14, overflow: 'hidden', backgroundColor: look.color, borderBottomWidth: 3, borderColor: shade(look.color), alignItems: 'center', justifyContent: 'center' }}>
                        {shop.cover_image_url
                            ? <Image source={{ uri: shop.cover_image_url }} style={{ width: 48, height: 48 }} />
                            : <Ionicons name={look.icon} size={24} color="#FFFFFF" />}
                    </View>
                    <View style={{ flex: 1, marginLeft: SPACE.md }}>
                        <Txt variant="headline" numberOfLines={1}>{shop.name}</Txt>
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
                            <View style={{ width: 7, height: 7, borderRadius: 4, marginRight: 5, backgroundColor: shop.is_open ? '#2FB57C' : m.faint }} />
                            <Txt variant="caption" tone="dim" numberOfLines={1}>{shop.is_open ? 'Open now' : 'Closed'}{dist ? ` · ${dist}` : ''}</Txt>
                        </View>
                        {shop.offer ? (
                            <View style={{ marginTop: 4, paddingLeft: 7, borderLeftWidth: 3, borderLeftColor: shop.offer.accent_color }}>
                                <Txt variant="caption" numberOfLines={1}>{shop.offer.headline}</Txt>
                            </View>
                        ) : shop.is_featured ? (
                            <View style={{ alignSelf: 'flex-start', marginTop: 4, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: '#FFB020' }}>
                                <Txt variant="label" tone="onBrand" style={{ fontSize: 11 }}>Featured</Txt>
                            </View>
                        ) : null}
                    </View>
                </Animated.View>
            </View>
        </Pressable>
    );
}

function JoiningCard({ alone }: { alone: boolean }) {
    const m = useTheme();
    const night = m.key === 'night';
    return (
        <View style={{ width: CARD_W, borderRadius: 20, borderWidth: 2, borderStyle: 'dashed', borderColor: night ? '#4A4058' : '#D9D0E6',
            padding: SPACE.md, flexDirection: 'row', alignItems: 'center', backgroundColor: night ? 'rgba(42,34,56,0.6)' : 'rgba(255,255,255,0.7)', minHeight: 80 }}>
            <View style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: night ? '#3A3049' : '#F1ECF8', alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="sparkles" size={22} color="#8B7CFF" />
            </View>
            <View style={{ flex: 1, marginLeft: SPACE.md }}>
                <Txt variant="headline" numberOfLines={2}>{alone ? 'Shops near you are joining' : 'More shops are joining'}</Txt>
                <Txt variant="caption" tone="dim" numberOfLines={2}>Ride there, stop on the way, or get it delivered.</Txt>
            </View>
        </View>
    );
}
