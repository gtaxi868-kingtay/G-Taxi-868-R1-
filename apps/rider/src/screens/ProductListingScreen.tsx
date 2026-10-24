import React, { useEffect, useState, useCallback } from 'react';
import { View, FlatList, Pressable } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { supabase } from '@gtaxi/core';
import { BrandBadge, Button, Card, EmptyState, GUTTER, Header, IconButton, Loading, SPACE, Txt, useTheme } from '../ui/kit';

function productIconFor(name: string): keyof typeof Ionicons.glyphMap {
    const n = name.toLowerCase();
    if (n.includes('drink')) return 'wine-outline';
    if (n.includes('fruit')) return 'nutrition-outline';
    if (n.includes('bread')) return 'cafe-outline';
    return 'cube-outline';
}

interface Product {
    id: string;
    name: string;
    price_cents: number;
    description: string;
    is_available: boolean;
    merchant_id: string;
}

interface CartItem {
    product: Product;
    quantity: number;
}

export function ProductListingScreen({ navigation, route }: any) {
    const { merchant } = route.params;
    const insets = useSafeAreaInsets();

    const [products, setProducts] = useState<Product[]>([]);
    const [loading, setLoading] = useState(true);
    const [cart, setCart] = useState<CartItem[]>([]);
    const [loadError, setLoadError] = useState(false);

    const fetchProducts = useCallback(async () => {
        try {
            const { data, error } = await supabase
                .from('products')
                .select('id, name, price_cents, description, is_available, merchant_id')
                .eq('merchant_id', merchant.id)
                .eq('is_available', true)
                .order('name', { ascending: true });

            if (error) throw error;
            setLoadError(false);
            setProducts((data || []) as Product[]);
        } catch (err) {
            console.error('[ProductListing] fetch error:', err);
            setLoadError(true);
        } finally {
            setLoading(false);
        }
    }, [merchant.id]);

    useEffect(() => { fetchProducts(); }, [fetchProducts]);

    // Items added from the product detail screen come back as a param.
    const added = route.params?.addProduct;
    useEffect(() => {
        if (!added?.product) return;
        setCart(prev => {
            const existing = prev.find(c => c.product.id === added.product.id);
            if (existing) return prev.map(c => c.product.id === added.product.id ? { ...c, quantity: c.quantity + added.quantity } : c);
            return [...prev, { product: added.product, quantity: added.quantity }];
        });
    }, [added?.key]);

    const getCartQty = (productId: string) =>
        cart.find(c => c.product.id === productId)?.quantity ?? 0;

    const addToCart = (product: Product) => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        setCart(prev => {
            const existing = prev.find(c => c.product.id === product.id);
            if (existing) return prev.map(c => c.product.id === product.id ? { ...c, quantity: c.quantity + 1 } : c);
            return [...prev, { product, quantity: 1 }];
        });
    };

    const m = useTheme();
    const cartTotal = cart.reduce((sum, i) => sum + i.product.price_cents * i.quantity, 0);
    const cartCount = cart.reduce((sum, i) => sum + i.quantity, 0);
    const openCart = () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); navigation.navigate('GroceryCart', { cart, merchant }); };

    const renderProduct = ({ item }: { item: Product }) => {
        const qty = getCartQty(item.id);
        return (
            <View style={{ width: '50%', padding: SPACE.xs }}>
                <Card style={{ padding: SPACE.md }} onPress={() => { Haptics.selectionAsync(); navigation.navigate('ProductDetail', { product: item, merchant }); }}>
                    <View style={{ height: 88, borderRadius: 16, backgroundColor: m.field, alignItems: 'center', justifyContent: 'center' }}>
                        <Ionicons name={productIconFor(item.name)} size={30} color={m.accent} />
                    </View>
                    <Txt variant="bodyStrong" numberOfLines={2} style={{ marginTop: SPACE.sm, minHeight: 42 }}>{item.name}</Txt>
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: SPACE.xs }}>
                        <Txt variant="body" tone="dim" style={{ flex: 1 }}>${(item.price_cents / 100).toFixed(2)}</Txt>
                        <Pressable accessibilityRole="button" accessibilityLabel={`Add ${item.name}`} onPress={() => addToCart(item)} hitSlop={6}>
                            {qty > 0 ? (
                                <View style={{ minWidth: 36, height: 36, borderRadius: 18, paddingHorizontal: 8, backgroundColor: '#8B7CFF', alignItems: 'center', justifyContent: 'center' }}>
                                    <Txt variant="label" tone="onBrand">{qty}</Txt>
                                </View>
                            ) : <BrandBadge icon="add" size={36} round />}
                        </Pressable>
                    </View>
                </Card>
            </View>
        );
    };

    return (
        <View style={{ flex: 1, backgroundColor: m.page }}>
            <StatusBar style={m.statusBar} />
            <Header title={merchant.name} onBack={() => { Haptics.selectionAsync(); navigation.goBack(); }}
                right={cartCount > 0 ? <IconButton icon="cart-outline" label="View cart" onPress={openCart} /> : undefined} />

            {loading ? <Loading /> : (
                <FlatList<Product>
                    data={products}
                    keyExtractor={item => item.id}
                    renderItem={renderProduct}
                    numColumns={2}
                    contentContainerStyle={{ paddingHorizontal: GUTTER - SPACE.xs, paddingBottom: (cartCount > 0 ? 110 : 0) + insets.bottom + SPACE.xl }}
                    showsVerticalScrollIndicator={false}
                    ListEmptyComponent={loadError
                        ? <EmptyState icon="cloud-offline-outline" title="Could not load this shop" body="Check your connection and try again." action={<Button title="Try again" variant="secondary" onPress={fetchProducts} />} />
                        : <EmptyState icon="cube-outline" title="Nothing to order yet" body="This shop has not added products yet." />}
                />
            )}

            {cartCount > 0 && (
                <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: GUTTER, paddingTop: SPACE.md, paddingBottom: Math.max(insets.bottom, SPACE.lg), backgroundColor: m.page, borderTopWidth: 1, borderTopColor: m.chipBorder }}>
                    <Button title={`View cart · ${cartCount} item${cartCount !== 1 ? 's' : ''} · $${(cartTotal / 100).toFixed(2)}`} onPress={openCart} />
                </View>
            )}
        </View>
    );
}
