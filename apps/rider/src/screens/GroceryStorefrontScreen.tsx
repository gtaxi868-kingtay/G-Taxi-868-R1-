import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { View, FlatList, ScrollView, RefreshControl } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { supabase } from '@gtaxi/core';
import { useAuth } from '../context/AuthContext';
import { useLocationTracking } from '../hooks/useLocationTracking';
import { Card, Chip, EmptyState, GUTTER, Header, Loading, Row, SPACE, Txt, useTheme } from '../ui/kit';

interface Merchant {
    id: string;
    name: string;
    category: string;
    address: string;
    is_active: boolean;
    delivery_fee_cents: number;
}

interface RegularItem {
    id: string;
    name: string;
    count: number;
    merchant_id: string;
    merchant_name: string;
}

const CATEGORY_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
    grocery: 'cart-outline',
    laundry: 'shirt-outline',
    pharmacy: 'medkit-outline',
    bakery: 'cafe-outline',
    drinks: 'wine-outline',
    default: 'storefront-outline',
};

export function GroceryStorefrontScreen({ navigation }: any) {
    const { user } = useAuth();
    const insets = useSafeAreaInsets();
    const { location } = useLocationTracking(true);

    const [merchants, setMerchants] = useState<Merchant[]>([]);
    const [usualStores, setUsualStores] = useState<any[]>([]);
    const [regularItems, setRegularItems] = useState<RegularItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [fetchError, setFetchError] = useState<string | null>(null);
    const [selectedCategory, setSelectedCategory] = useState<string>('all');

    const categories = useMemo(
        () => Array.from(new Set(merchants.map(m => m.category))),
        [merchants]
    );

    const fetchMerchants = useCallback(async () => {
        try {
            const { data, error } = await supabase
                .from('merchants')
                .select('id, name, category, address, is_active, delivery_fee_cents')
                .eq('is_active', true)
                .order('name', { ascending: true });

            if (error) throw error;

            setFetchError(null);
            const list = (data || []) as Merchant[];
            setMerchants(list);

            if (user?.id) {
                // order_items has no product name or shop columns: go through
                // the product. The database only returns this rider's own items.
                const { data: orders } = await supabase
                    .from('order_items')
                    .select('product_id, products!product_id(name, merchant_id, merchants(name))')
                    .limit(100);

                if (orders && orders.length > 0) {
                    const counts: Record<string, any> = {};
                    orders.forEach((o: any) => {
                        const p = o.products;
                        if (!p || !o.product_id) return;
                        if (!counts[o.product_id]) {
                            counts[o.product_id] = { name: p.name, id: o.product_id, merchant_id: p.merchant_id, merchant_name: p.merchants?.name, count: 0 };
                        }
                        counts[o.product_id].count += 1;
                    });

                    const sorted = Object.values(counts)
                        .sort((a: any, b: any) => b.count - a.count)
                        .slice(0, 8);
                    
                    setRegularItems(sorted as RegularItem[]);
                }
            }
        } catch (err: any) {
            console.error('[GroceryStorefront] fetch error:', err);
            setFetchError(err?.message || 'Could not load stores. Pull down to retry.');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    useEffect(() => { fetchMerchants(); }, [fetchMerchants]);

    // Additive: personalized "YOUR USUALS" store row via g_rank_merchants.
    // Consent-gated server-side; if off or no history, is_usual comes back false
    // and the row simply doesn't render. Never blocks the existing store list.
    useEffect(() => {
        if (!location || !user?.id) return;
        supabase
            .rpc('g_rank_merchants', {
                p_rider_id: user.id,
                p_lat: location.latitude,
                p_lng: location.longitude,
                p_store_type: 'grocery',
                p_limit: 12,
            })
            .then(
                ({ data }) => {
                    const usuals = (data || []).filter((m: any) => m.is_usual || m.is_featured);
                    setUsualStores(usuals);
                },
                (err: unknown) => console.warn('[GroceryStorefront] g_rank_merchants failed:', err),
            );
    }, [location?.latitude, location?.longitude, user?.id]);

    const onRefresh = useCallback(() => {
        setRefreshing(true);
        fetchMerchants();
    }, [fetchMerchants]);

    const filteredMerchants = selectedCategory === 'all'
        ? merchants
        : merchants.filter(m => m.category === selectedCategory);

    const handleMerchantPress = (merchant: Merchant) => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        navigation.navigate('ProductListing', { merchant });
    };

    const m = useTheme();
    const label = (c: string) => c.charAt(0).toUpperCase() + c.slice(1);

    const rail = (title: string, items: React.ReactNode) => (
        <View style={{ marginTop: SPACE.lg }}>
            <Txt variant="overline" tone="faint" style={{ marginBottom: SPACE.sm }}>{title}</Txt>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -GUTTER }} contentContainerStyle={{ paddingHorizontal: GUTTER, gap: SPACE.md }}>
                {items}
            </ScrollView>
        </View>
    );

    const header = (
        <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -GUTTER }} contentContainerStyle={{ paddingHorizontal: GUTTER }}>
                {['all', ...categories].map(cat => (
                    <Chip key={cat} label={cat === 'all' ? 'All' : label(cat)} selected={selectedCategory === cat}
                        onPress={() => { setSelectedCategory(cat); Haptics.selectionAsync(); }} />
                ))}
            </ScrollView>

            {usualStores.length > 0 && rail('Your usuals', usualStores.map((store: any) => (
                <Card key={store.merchant_id} style={{ width: 150, padding: SPACE.md }} onPress={() => {
                    Haptics.selectionAsync();
                    navigation.navigate('ProductListing', { merchant: { id: store.merchant_id, name: store.name, category: store.category, address: store.address, is_active: true, delivery_fee_cents: store.delivery_fee_cents } });
                }}>
                    <Ionicons name={CATEGORY_ICONS[store.category] || CATEGORY_ICONS.default} size={20} color={m.accent} />
                    <Txt variant="bodyStrong" numberOfLines={1} style={{ marginTop: SPACE.sm }}>{store.name}</Txt>
                    <Txt variant="caption" tone="dim" numberOfLines={1}>{store.is_featured ? 'Featured' : `Ordered ${store.visit_count}×`}</Txt>
                </Card>
            )))}

            {regularItems.length > 0 && rail('Buy again', regularItems.map((item) => (
                <Card key={item.id} style={{ width: 150, padding: SPACE.md }} onPress={() => { Haptics.selectionAsync(); navigation.navigate('ProductDetail', { productId: item.id }); }}>
                    <Ionicons name="cube-outline" size={20} color={m.accent} />
                    <Txt variant="bodyStrong" numberOfLines={1} style={{ marginTop: SPACE.sm }}>{item.name}</Txt>
                    <Txt variant="caption" tone="dim" numberOfLines={1}>{item.merchant_name}</Txt>
                </Card>
            )))}

            <Txt variant="overline" tone="faint" style={{ marginTop: SPACE.xl, marginBottom: SPACE.sm }}>ALL SHOPS</Txt>
        </>
    );

    return (
        <View style={{ flex: 1, backgroundColor: m.page }}>
            <StatusBar style={m.statusBar} />
            <Header title="Shops near you" onBack={() => { Haptics.selectionAsync(); navigation.goBack(); }} />
            {loading ? <Loading /> : (
                <FlatList<Merchant>
                    data={fetchError ? [] : filteredMerchants}
                    keyExtractor={item => item.id}
                    ListHeaderComponent={header}
                    renderItem={({ item, index }) => (
                        <Row icon={CATEGORY_ICONS[item.category] || CATEGORY_ICONS.default} title={item.name}
                            subtitle={[label(item.category), item.address].filter(Boolean).join(' · ')}
                            last={index === filteredMerchants.length - 1} onPress={() => handleMerchantPress(item)} />
                    )}
                    contentContainerStyle={{ paddingHorizontal: GUTTER, paddingTop: SPACE.sm, paddingBottom: insets.bottom + SPACE.xxl }}
                    showsVerticalScrollIndicator={false}
                    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={m.accent} colors={['#8B7CFF']} />}
                    ListEmptyComponent={fetchError
                        ? <EmptyState icon="cloud-offline-outline" title="Could not load shops" body="Pull down to try again." />
                        : <EmptyState icon="storefront-outline" title="No shops open near you yet" body="Pull down to refresh." />}
                />
            )}
        </View>
    );
}
