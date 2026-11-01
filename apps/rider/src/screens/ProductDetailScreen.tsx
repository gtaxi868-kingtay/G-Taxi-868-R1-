import React, { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { supabase } from '@gtaxi/core';
import { toast } from '../components/Toast';
import { Button, Card, EmptyState, Loading, Screen, SPACE, Txt, useTheme } from '../ui/kit';

interface Product {
    id: string;
    name: string;
    price_cents: number;
    description: string;
    is_available: boolean;
    merchant_id?: string;
}

const PRODUCT_ICONS: Record<string, string> = {
    drink: '🥤', drinks: '🥤', blueberry: '🫐', berry: '🫐',
    fruit: '🍎', apple: '🍎', banana: '🍌', bread: '🍞',
    milk: '🥛', egg: '🥚', chicken: '🍗', default: '📦',
};

function getProductIcon(name: string): string {
    const lower = name.toLowerCase();
    for (const key of Object.keys(PRODUCT_ICONS)) {
        if (lower.includes(key)) return PRODUCT_ICONS[key];
    }
    return PRODUCT_ICONS.default;
}

// Opened from a shop's product list ({ product, merchant }) or from "The
// Regulars" on the store list ({ productId }). Adding sends the item back to
// that shop's product list, which owns the cart. (It used to receive a
// function through route params and crashed when opened with only an id.)
export function ProductDetailScreen({ navigation, route }: any) {
    const m = useTheme();
    const params = route.params || {};
    const [product, setProduct] = useState<Product | null>(params.product || null);
    const [merchant, setMerchant] = useState<any>(params.merchant || null);
    const [loading, setLoading] = useState(!params.product || !params.merchant);
    const [quantity, setQuantity] = useState(1);

    useEffect(() => {
        const id = params.product?.id || params.productId;
        if (!id || (params.product && params.merchant)) return;
        supabase
            .from('products')
            .select('id, name, price_cents, description, is_available, merchant_id, merchants(id, name, category, address, delivery_fee_cents)')
            .eq('id', id)
            .maybeSingle()
            .then(
                ({ data }: any) => {
                    if (data) {
                        const { merchants: shop, ...p } = data;
                        setProduct(p);
                        if (shop) setMerchant({ ...shop, is_active: true });
                    }
                    setLoading(false);
                },
                () => setLoading(false),
            );
    }, []);

    const adjustQty = (delta: number) => {
        Haptics.selectionAsync();
        setQuantity(prev => Math.max(1, prev + delta));
    };

    const handleAddToCart = () => {
        if (!product || !merchant) return;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        toast(`${quantity} × ${product.name} added to your cart`, 'success');
        navigation.navigate({
            name: 'ProductListing',
            params: { merchant, addProduct: { product, quantity, key: Date.now() } },
            merge: true,
        });
    };

    if (loading) return <Screen title="Product" onBack={() => navigation.goBack()}><Loading /></Screen>;
    if (!product) {
        return (
            <Screen title="Product" onBack={() => navigation.goBack()}>
                <EmptyState icon="cube-outline" title="This item is not available" body="It may have sold out or been removed by the shop." />
            </Screen>
        );
    }

    const totalCents = product.price_cents * quantity;
    const qtyBtn = (icon: any, label: string, delta: number) => (
        <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={() => adjustQty(delta)} hitSlop={6}
            style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: m.field, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name={icon} size={20} color={m.ink} />
        </Pressable>
    );

    return (
        <Screen
            title={merchant?.name || 'Product'}
            onBack={() => navigation.goBack()}
            footer={<Button title={`Add to cart · $${(totalCents / 100).toFixed(2)}`} icon="cart-outline" onPress={handleAddToCart} disabled={!merchant} />}
        >
            <View style={{ height: 180, borderRadius: 24, backgroundColor: m.field, alignItems: 'center', justifyContent: 'center', marginTop: SPACE.sm }}>
                <Txt style={{ fontSize: 72, lineHeight: 84 }}>{getProductIcon(product.name)}</Txt>
            </View>

            <Txt variant="hero" style={{ marginTop: SPACE.xl }}>{product.name}</Txt>
            {product.description ? <Txt variant="body" tone="dim" style={{ marginTop: SPACE.sm }}>{product.description}</Txt> : null}
            <Txt variant="title" style={{ marginTop: SPACE.md }}>${(product.price_cents / 100).toFixed(2)} <Txt variant="body" tone="dim">TTD each</Txt></Txt>

            <Card style={{ marginTop: SPACE.xl, flexDirection: 'row', alignItems: 'center' }}>
                <Txt variant="bodyStrong" style={{ flex: 1 }}>Quantity</Txt>
                {qtyBtn('remove', 'Fewer', -1)}
                <Txt variant="title" style={{ width: 48, textAlign: 'center' }}>{quantity}</Txt>
                {qtyBtn('add', 'More', 1)}
            </Card>
        </Screen>
    );
}
