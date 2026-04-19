import React, { useEffect, useState, useCallback } from 'react';
import {
    View, Text, FlatList, TouchableOpacity, StyleSheet,
    ActivityIndicator, Dimensions, Alert,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { supabase } from '../../../../shared/supabase';

const { width } = Dimensions.get('window');
const CARD_WIDTH = (width - 52) / 2;

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

    const fetchProducts = useCallback(async () => {
        try {
            const { data, error } = await supabase
                .from('products')
                .select('id, name, price_cents, description, is_available, merchant_id')
                .eq('merchant_id', merchant.id)
                .eq('is_available', true)
                .order('name', { ascending: true });

            if (error) throw error;
            setProducts((data || []) as Product[]);
        } catch (err) {
            console.error('[ProductListing] fetch error:', err);
            Alert.alert('Error', 'Could not load products. Please try again.');
        } finally {
            setLoading(false);
        }
    }, [merchant.id]);

    useEffect(() => { fetchProducts(); }, [fetchProducts]);

    const getCartQty = (productId: string) =>
        cart.find(c => c.product.id === productId)?.quantity ?? 0;

    const addToCart = (product: Product) => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        setCart(prev => {
            const existing = prev.find(c => c.product.id === product.id);
            if (existing) {
                return prev.map(c =>
                    c.product.id === product.id
                        ? { ...c, quantity: c.quantity + 1 }
                        : c
                );
            }
            return [...prev, { product, quantity: 1 }];
        });
    };

    const cartTotal = cart.reduce((sum, i) => sum + i.product.price_cents * i.quantity, 0);
    const cartCount = cart.reduce((sum, i) => sum + i.quantity, 0);

    const renderProduct = ({ item }: { item: Product }) => {
        const qty = getCartQty(item.id);
        return (
            <TouchableOpacity
                style={[s.productCard, { width: CARD_WIDTH }]}
                activeOpacity={0.85}
                onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    navigation.navigate('ProductDetail', { product: item, onAddToCart: addToCart });
                }}
            >
                <BlurView intensity={20} style={StyleSheet.absoluteFillObject} tint="dark" />
                {/* Product image placeholder with emoji based on name */}
                <View style={s.productImageBox}>
                    <Text style={s.productEmoji}>
                        {item.name.toLowerCase().includes('drink') ? '🥤'
                            : item.name.toLowerCase().includes('fruit') ? '🍎'
                            : item.name.toLowerCase().includes('bread') ? '🍞'
                            : '📦'}
                    </Text>
                </View>
                <View style={s.productMeta}>
                    <Text style={s.productName} numberOfLines={2}>{item.name}</Text>
                    <Text style={s.productPrice}>
                        ${(item.price_cents / 100).toFixed(2)} TTD
                    </Text>
                </View>
                <TouchableOpacity
                    style={[s.addBtn, qty > 0 && s.addBtnActive]}
                    onPress={() => addToCart(item)}
                >
                    <Text style={s.addBtnText}>{qty > 0 ? `+${qty}` : '+'}</Text>
                </TouchableOpacity>
            </TouchableOpacity>
        );
    };

    return (
        <LinearGradient colors={['#0A0A1F', '#12122A']} style={s.container}>
            {/* Header */}
            <View style={[s.header, { paddingTop: insets.top + 8 }]}>
                <TouchableOpacity
                    onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); navigation.goBack(); }}
                    style={s.backBtn}
                >
                    <Ionicons name="arrow-back" size={22} color="#FFF" />
                </TouchableOpacity>
                <View style={s.headerCenter}>
                    <Text style={s.headerTitle}>{merchant.name}</Text>
                    <Text style={s.headerSub}>
                        {merchant.category.charAt(0).toUpperCase() + merchant.category.slice(1)}
                    </Text>
                </View>
                {/* Cart button */}
                <TouchableOpacity
                    style={s.cartBtn}
                    onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        navigation.navigate('GroceryCart', { cart, merchant });
                    }}
                    disabled={cartCount === 0}
                >
                    <Ionicons name="bag-outline" size={22} color={cartCount > 0 ? '#00FFFF' : 'rgba(255,255,255,0.3)'} />
                    {cartCount > 0 && (
                        <View style={s.cartBadge}>
                            <Text style={s.cartBadgeText}>{cartCount}</Text>
                        </View>
                    )}
                </TouchableOpacity>
            </View>

            {loading ? (
                <View style={s.center}>
                    <ActivityIndicator size="large" color="#00FFFF" />
                    <Text style={s.loadingText}>Loading products...</Text>
                </View>
            ) : products.length === 0 ? (
                <View style={s.center}>
                    <Text style={s.emptyEmoji}>📦</Text>
                    <Text style={s.emptyText}>No products available.</Text>
                </View>
            ) : (
                <FlatList
                    data={products}
                    keyExtractor={item => item.id}
                    renderItem={renderProduct}
                    numColumns={2}
                    contentContainerStyle={s.grid}
                    columnWrapperStyle={{ gap: 12 }}
                    showsVerticalScrollIndicator={false}
                />
            )}

            {/* Sticky cart bar */}
            {cartCount > 0 && (
                <TouchableOpacity
                    style={s.cartBar}
                    onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                        navigation.navigate('GroceryCart', { cart, merchant });
                    }}
                >
                    <BlurView intensity={40} style={StyleSheet.absoluteFillObject} tint="dark" />
                    <Text style={s.cartBarLeft}>{cartCount} item{cartCount !== 1 ? 's' : ''}</Text>
                    <Text style={s.cartBarCenter}>View Cart</Text>
                    <Text style={s.cartBarRight}>${(cartTotal / 100).toFixed(2)} TTD</Text>
                </TouchableOpacity>
            )}
        </LinearGradient>
    );
}

const s = StyleSheet.create({
    container: { flex: 1 },
    header: {
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: 20, paddingBottom: 12, gap: 12,
    },
    backBtn: {
        width: 38, height: 38, borderRadius: 19,
        backgroundColor: 'rgba(255,255,255,0.1)',
        alignItems: 'center', justifyContent: 'center',
    },
    headerCenter: { flex: 1 },
    headerTitle: { fontSize: 18, fontWeight: '700', color: '#FFF' },
    headerSub: { fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 2 },
    cartBtn: {
        width: 38, height: 38, borderRadius: 19,
        backgroundColor: 'rgba(255,255,255,0.1)',
        alignItems: 'center', justifyContent: 'center',
    },
    cartBadge: {
        position: 'absolute', top: -2, right: -2,
        width: 16, height: 16, borderRadius: 8,
        backgroundColor: '#7C3AED', alignItems: 'center', justifyContent: 'center',
    },
    cartBadgeText: { fontSize: 10, color: '#FFF', fontWeight: '800' },
    grid: { padding: 20, gap: 12, paddingBottom: 100 },
    productCard: {
        borderRadius: 20, overflow: 'hidden',
        borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
        padding: 14, backgroundColor: 'rgba(255,255,255,0.05)',
    },
    productImageBox: {
        height: 90, borderRadius: 14,
        backgroundColor: 'rgba(123,97,255,0.15)',
        alignItems: 'center', justifyContent: 'center',
        marginBottom: 10,
    },
    productEmoji: { fontSize: 40 },
    productMeta: { gap: 4, marginBottom: 10 },
    productName: { fontSize: 14, fontWeight: '600', color: '#FFF', lineHeight: 19 },
    productPrice: { fontSize: 15, fontWeight: '800', color: '#7C3AED' },
    addBtn: {
        alignSelf: 'flex-end', width: 32, height: 32, borderRadius: 16,
        backgroundColor: 'rgba(123,97,255,0.3)',
        alignItems: 'center', justifyContent: 'center',
    },
    addBtnActive: { backgroundColor: '#7C3AED' },
    addBtnText: { fontSize: 18, color: '#FFF', fontWeight: '700', lineHeight: 22 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
    loadingText: { color: 'rgba(255,255,255,0.5)', marginTop: 12, fontSize: 14 },
    emptyEmoji: { fontSize: 48, marginBottom: 16 },
    emptyText: { color: '#FFF', fontSize: 18, fontWeight: '700' },
    cartBar: {
        position: 'absolute', bottom: 24, left: 20, right: 20,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        borderRadius: 20, overflow: 'hidden', padding: 18,
        borderWidth: 1, borderColor: 'rgba(0,255,255,0.3)',
    },
    cartBarLeft: { fontSize: 13, color: 'rgba(255,255,255,0.7)', fontWeight: '600' },
    cartBarCenter: { fontSize: 16, color: '#00FFFF', fontWeight: '800' },
    cartBarRight: { fontSize: 13, color: 'rgba(255,255,255,0.7)', fontWeight: '600' },
});
