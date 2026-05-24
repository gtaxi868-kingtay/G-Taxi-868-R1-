import React, { useState } from 'react';
import {
    View, Text, TouchableOpacity, StyleSheet,
    ScrollView, useWindowDimensions, Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { ghostBorder, elevationGlow } from '@gtaxi/design-system/utils/style-rules';
import { SURFACE, VOICES, ANIMATION } from '@gtaxi/design-system';

const CYAN = '#06B6D4';

interface Product {
    id: string;
    name: string;
    price_cents: number;
    description: string;
    is_available: boolean;
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

const NUTRIENT_PILLS = [
    { label: 'Water', value: '8oz', color: CYAN },
    { label: 'Calories', value: '120', color: '#F59E0B' },
    { label: 'Fat', value: '0g', color: '#EF4444' },
    { label: 'Protein', value: '2g', color: '#10B981' },
];

export function ProductDetailScreen({ navigation, route }: any) {
    const { width } = useWindowDimensions();
    const { product, onAddToCart } = route.params as { product: Product; onAddToCart?: (p: Product) => void };
    const insets = useSafeAreaInsets();
    const [quantity, setQuantity] = useState(1);

    const adjustQty = (delta: number) => {
        Haptics.selectionAsync();
        setQuantity(prev => Math.max(1, prev + delta));
    };

    const handleAddToCart = () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        if (onAddToCart) {
            for (let i = 0; i < quantity; i++) onAddToCart(product);
        }
        Alert.alert(
            '✅ Added to Cart',
            `${quantity}x ${product.name} added.`,
            [
                { text: 'Keep Shopping', style: 'cancel' },
                { text: 'View Cart', onPress: () => navigation.navigate('GroceryCart') },
            ]
        );
        navigation.goBack();
    };

    const totalCents = product.price_cents * quantity;

    return (
        <LinearGradient colors={['#0A0A1F', '#12122A']} style={s.container}>
            <View style={[s.header, { paddingTop: insets.top + 8 }]}>
                <TouchableOpacity
                    onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); navigation.goBack(); }}
                    style={s.backBtn}
                >
                    <Ionicons name="arrow-back" size={22} color="#FFF" />
                </TouchableOpacity>
                <Text style={s.headerTitle}>Product Details</Text>
                <View style={{ width: 38 }} />
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scrollContent}>
                <View style={s.heroBox}>
                    <Text style={s.heroEmoji}>{getProductIcon(product.name)}</Text>
                    <View style={s.glowRing} />
                </View>

                <View style={s.pillRow}>
                    {NUTRIENT_PILLS.map(pill => (
                        <View key={pill.label} style={[s.pill, { borderColor: pill.color + '44' }]}>
                            <Text style={[s.pillValue, { color: pill.color }]}>{pill.value}</Text>
                            <Text style={s.pillLabel}>{pill.label}</Text>
                        </View>
                    ))}
                </View>

                <View style={s.infoCard}>
                    <Text style={s.productName}>{product.name}</Text>
                    {product.description ? (
                        <Text style={s.productDesc}>{product.description}</Text>
                    ) : null}

                    <View style={s.priceRow}>
                        <Text style={s.price}>${(product.price_cents / 100).toFixed(2)} TTD</Text>
                        <Text style={s.perUnit}>per unit</Text>
                    </View>

                    <View style={s.qtyRow}>
                        <Text style={s.qtyLabel}>Quantity</Text>
                        <View style={s.qtyControl}>
                            <TouchableOpacity style={s.qtyBtn} onPress={() => adjustQty(-1)}>
                                <Text style={s.qtyBtnText}>−</Text>
                            </TouchableOpacity>
                            <Text style={s.qtyValue}>{quantity}</Text>
                            <TouchableOpacity style={[s.qtyBtn, s.qtyBtnActive]} onPress={() => adjustQty(1)}>
                                <Text style={s.qtyBtnText}>+</Text>
                            </TouchableOpacity>
                        </View>
                    </View>

                    <View style={s.totalRow}>
                        <Text style={s.totalLabel}>Total</Text>
                        <Text style={s.totalValue}>${(totalCents / 100).toFixed(2)} TTD</Text>
                    </View>
                </View>
            </ScrollView>

            <View style={[s.ctaContainer, { paddingBottom: insets.bottom + 16 }]}>
                <TouchableOpacity style={s.ctaButton} onPress={handleAddToCart} activeOpacity={0.88}>
                    <LinearGradient
                        colors={[VOICES.rider.accent, CYAN]}
                        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                        style={s.ctaGradient}
                    >
                        <Ionicons name="cart-outline" size={22} color="#FFF" style={{ marginRight: 8 }} />
                        <Text style={s.ctaText}>Add to Cart  ·  ${(totalCents / 100).toFixed(2)} TTD</Text>
                    </LinearGradient>
                </TouchableOpacity>
            </View>
        </LinearGradient>
    );
}

const s = StyleSheet.create({
    container: { flex: 1 },
    header: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 20, paddingBottom: 12,
    },
    backBtn: {
        width: 38, height: 38, borderRadius: 19,
        backgroundColor: 'rgba(255,255,255,0.1)',
        alignItems: 'center', justifyContent: 'center',
    },
    headerTitle: { fontSize: 18, fontWeight: '700', color: '#FFF' },
    scrollContent: { paddingBottom: 120 },
    heroBox: {
        height: 260, alignItems: 'center', justifyContent: 'center', marginBottom: 8,
    },
    heroEmoji: { fontSize: 120, zIndex: 2 },
    glowRing: {
        position: 'absolute', width: 200, height: 200, borderRadius: 100,
        backgroundColor: `${VOICES.rider.accent}1A`,
        ...elevationGlow(),
    },
    pillRow: {
        flexDirection: 'row', justifyContent: 'center', gap: 10, marginBottom: 20, paddingHorizontal: 16,
    },
    pill: {
        alignItems: 'center', paddingVertical: 10, paddingHorizontal: 14,
        borderRadius: 16, ...ghostBorder(), overflow: 'hidden',
        backgroundColor: 'rgba(255,255,255,0.05)',
    },
    pillValue: { fontSize: 15, fontWeight: '800' },
    pillLabel: { fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 2 },
    infoCard: {
        marginHorizontal: 20, borderRadius: 24, overflow: 'hidden',
        ...ghostBorder(0.12),
        padding: 22, backgroundColor: 'rgba(255,255,255,0.05)',
    },
    productName: { fontSize: 22, fontWeight: '800', color: '#FFF', marginBottom: 8 },
    productDesc: { fontSize: 14, color: 'rgba(255,255,255,0.5)', lineHeight: 20, marginBottom: 16 },
    priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 24 },
    price: { fontSize: 30, fontWeight: '900', color: VOICES.rider.accent },
    perUnit: { fontSize: 13, color: 'rgba(255,255,255,0.4)' },
    qtyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
    qtyLabel: { fontSize: 16, fontWeight: '600', color: '#FFF' },
    qtyControl: { flexDirection: 'row', alignItems: 'center', gap: 16 },
    qtyBtn: {
        width: 36, height: 36, borderRadius: 18,
        backgroundColor: `${VOICES.rider.accent}33`,
        alignItems: 'center', justifyContent: 'center',
    },
    qtyBtnActive: { backgroundColor: VOICES.rider.accent },
    qtyBtnText: { fontSize: 22, color: '#FFF', fontWeight: '700', lineHeight: 26 },
    qtyValue: { fontSize: 22, fontWeight: '800', color: '#FFF', minWidth: 30, textAlign: 'center' },
    totalRow: {
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
        paddingTop: 16, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)',
    },
    totalLabel: { fontSize: 16, color: 'rgba(255,255,255,0.6)', fontWeight: '600' },
    totalValue: { fontSize: 22, color: CYAN, fontWeight: '900' },
    ctaContainer: { paddingHorizontal: 20, paddingTop: 12 },
    ctaButton: { borderRadius: 20, overflow: 'hidden' },
    ctaGradient: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        paddingVertical: 18, paddingHorizontal: 24,
    },
    ctaText: { fontSize: 17, fontWeight: '800', color: '#FFF' },
});
