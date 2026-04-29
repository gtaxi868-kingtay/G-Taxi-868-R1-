import React, { useState } from 'react';
import {
    View, Text, TouchableOpacity, StyleSheet,
    FlatList, Alert, Switch, Dimensions,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { supabase } from '../../../../shared/supabase';
import { useAuth } from '../context/AuthContext';
import { useRide } from '../context/RideContext';

interface CartItem {
    product: { id: string; name: string; price_cents: number };
    quantity: number;
}

export function GroceryCartScreen({ navigation, route }: any) {
    const { cart: initialCart, merchant } = route.params as { cart: CartItem[]; merchant: any };
    const insets = useSafeAreaInsets();
    const { user } = useAuth();
    const { activeRide } = useRide();

    const [cart, setCart] = useState<CartItem[]>(initialCart || []);
    const [deliverToRide, setDeliverToRide] = useState(false);
    const [loading, setLoading] = useState(false);

    const subTotal = cart.reduce((sum, i) => sum + i.product.price_cents * i.quantity, 0);
    const deliveryFee = 500; // $5 TTD
    const total = subTotal + deliveryFee;

    const updateQty = (productId: string, delta: number) => {
        Haptics.selectionAsync();
        setCart(prev =>
            prev
                .map(c => c.product.id === productId ? { ...c, quantity: c.quantity + delta } : c)
                .filter(c => c.quantity > 0)
        );
    };

    const handleCheckout = async () => {
        if (cart.length === 0) return;
        if (!user?.id) { Alert.alert('Error', 'Please log in.'); return; }

        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        setLoading(true);

        try {
            // Insert grocery order into Supabase
            const { data: order, error: orderErr } = await supabase
                .from('orders')
                .insert({
                    rider_id: user.id,
                    merchant_id: merchant.id,
                    total_cents: total,
                    status: 'pending',
                    delivery_method: deliverToRide && activeRide?.ride_id ? 'to_ride' : 'courier',
                    ride_id: deliverToRide && activeRide?.ride_id ? activeRide.ride_id : null,
                })
                .select('id')
                .single();

            if (orderErr) throw orderErr;

            // Insert order items
            const items = cart.map(c => ({
                order_id: order.id,
                product_id: c.product.id,
                quantity: c.quantity,
                unit_price_cents: c.product.price_cents,
            }));

            const { error: itemsErr } = await supabase
                .from('order_items')
                .insert(items);

            if (itemsErr) throw itemsErr;

            Alert.alert(
                '🛒 Order Placed!',
                `Your order from ${merchant.name} has been confirmed.\nID: ${order.id.slice(0, 8).toUpperCase()}`,
                [{ text: 'OK', onPress: () => navigation.navigate('GroceryOrderStatus', {orderId: order.id}) }]
            );
        } catch (err: any) {
            Alert.alert('Order Failed', err.message || 'Please try again.');
        } finally {
            setLoading(false);
        }
    };

    const renderItem = ({ item }: { item: CartItem }) => (
        <View style={s.itemRow}>
            <BlurView intensity={20} style={StyleSheet.absoluteFillObject} tint="dark" />
            <View style={s.itemLeft}>
                <Text style={s.itemName}>{item.product.name}</Text>
                <Text style={s.itemPrice}>${(item.product.price_cents / 100).toFixed(2)} TTD each</Text>
            </View>
            <View style={s.itemQty}>
                <TouchableOpacity style={s.qtyBtn} onPress={() => updateQty(item.product.id, -1)}>
                    <Text style={s.qtyBtnText}>−</Text>
                </TouchableOpacity>
                <Text style={s.qtyVal}>{item.quantity}</Text>
                <TouchableOpacity style={[s.qtyBtn, s.qtyBtnAdd]} onPress={() => updateQty(item.product.id, 1)}>
                    <Text style={s.qtyBtnText}>+</Text>
                </TouchableOpacity>
            </View>
            <Text style={s.lineTotal}>${((item.product.price_cents * item.quantity) / 100).toFixed(2)}</Text>
        </View>
    );

    return (
        <LinearGradient colors={['#0A0A1F', '#12122A']} style={s.container}>
            <View style={[s.header, { paddingTop: insets.top + 8 }]}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
                    <Ionicons name="arrow-back" size={22} color="#FFF" />
                </TouchableOpacity>
                <Text style={s.headerTitle}>Your Cart</Text>
                <View style={{ width: 38 }} />
            </View>

            <FlatList
                data={cart}
                keyExtractor={i => i.product.id}
                renderItem={renderItem}
                contentContainerStyle={s.listContent}
                showsVerticalScrollIndicator={false}
                ListEmptyComponent={
                    <View style={s.emptyBox}>
                        <Text style={s.emptyEmoji}>🛒</Text>
                        <Text style={s.emptyText}>Your cart is empty</Text>
                    </View>
                }
                ListFooterComponent={cart.length > 0 ? (
                    <View style={s.footer}>
                        {/* Delivery toggle — only shown if rider has an active ride */}
                        {activeRide && (
                            <View style={s.deliveryCard}>
                                <BlurView intensity={25} style={StyleSheet.absoluteFillObject} tint="dark" />
                                <View style={s.deliveryRow}>
                                    <View style={s.deliveryInfo}>
                                        <Text style={s.deliveryTitle}>Deliver to My Taxi</Text>
                                        <Text style={s.deliverySub}>Driver will receive the order</Text>
                                    </View>
                                    <Switch
                                        value={deliverToRide}
                                        onValueChange={v => { Haptics.selectionAsync(); setDeliverToRide(v); }}
                                        trackColor={{ false: 'rgba(255,255,255,0.1)', true: '#7C3AED' }}
                                        thumbColor={deliverToRide ? '#00FFFF' : '#888'}
                                    />
                                </View>
                                {!deliverToRide && (
                                    <Text style={s.deliveryNote}>Independent courier delivery</Text>
                                )}
                            </View>
                        )}

                        {/* Price breakdown */}
                        <View style={s.priceCard}>
                            <BlurView intensity={25} style={StyleSheet.absoluteFillObject} tint="dark" />
                            <View style={s.priceRow}>
                                <Text style={s.priceLabel}>Subtotal</Text>
                                <Text style={s.priceVal}>${(subTotal / 100).toFixed(2)} TTD</Text>
                            </View>
                            <View style={s.priceRow}>
                                <Text style={s.priceLabel}>Delivery Fee</Text>
                                <Text style={s.priceVal}>${(deliveryFee / 100).toFixed(2)} TTD</Text>
                            </View>
                            <View style={[s.priceRow, s.totalRow]}>
                                <Text style={s.totalLabel}>Total</Text>
                                <Text style={s.totalVal}>${(total / 100).toFixed(2)} TTD</Text>
                            </View>
                        </View>
                    </View>
                ) : null}
            />

            {cart.length > 0 && (
                <View style={[s.ctaContainer, { paddingBottom: insets.bottom + 16 }]}>
                    <TouchableOpacity style={s.ctaButton} onPress={handleCheckout} disabled={loading} activeOpacity={0.88}>
                        <LinearGradient
                            colors={['#7C3AED', '#5A2DDE']}
                            start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                            style={s.ctaGradient}
                        >
                            <Ionicons name="checkmark-circle-outline" size={22} color="#FFF" style={{ marginRight: 8 }} />
                            <Text style={s.ctaText}>{loading ? 'Placing Order...' : `Checkout Securely · $${(total / 100).toFixed(2)} TTD`}</Text>
                        </LinearGradient>
                    </TouchableOpacity>
                </View>
            )}
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
    headerTitle: { fontSize: 20, fontWeight: '700', color: '#FFF' },
    listContent: { padding: 20, gap: 12, paddingBottom: 120 },
    itemRow: {
        flexDirection: 'row', alignItems: 'center',
        borderRadius: 18, overflow: 'hidden',
        borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
        padding: 14, gap: 10,
        backgroundColor: 'rgba(255,255,255,0.05)',
    },
    itemLeft: { flex: 1 },
    itemName: { fontSize: 14, fontWeight: '600', color: '#FFF' },
    itemPrice: { fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 2 },
    itemQty: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    qtyBtn: {
        width: 28, height: 28, borderRadius: 14,
        backgroundColor: 'rgba(123,97,255,0.2)',
        alignItems: 'center', justifyContent: 'center',
    },
    qtyBtnAdd: { backgroundColor: '#7C3AED' },
    qtyBtnText: { fontSize: 18, color: '#FFF', fontWeight: '700', lineHeight: 22 },
    qtyVal: { fontSize: 16, fontWeight: '700', color: '#FFF', minWidth: 20, textAlign: 'center' },
    lineTotal: { fontSize: 14, fontWeight: '700', color: '#00FFFF', minWidth: 60, textAlign: 'right' },
    footer: { gap: 12, marginTop: 8 },
    deliveryCard: {
        borderRadius: 20, overflow: 'hidden', padding: 16,
        borderWidth: 1, borderColor: 'rgba(0,255,255,0.2)',
        backgroundColor: 'rgba(0,255,255,0.04)',
    },
    deliveryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    deliveryInfo: {},
    deliveryTitle: { fontSize: 15, fontWeight: '700', color: '#FFF' },
    deliverySub: { fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 2 },
    deliveryNote: { fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 8 },
    priceCard: {
        borderRadius: 20, overflow: 'hidden', padding: 18,
        borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
        backgroundColor: 'rgba(255,255,255,0.04)', gap: 10,
    },
    priceRow: { flexDirection: 'row', justifyContent: 'space-between' },
    priceLabel: { fontSize: 14, color: 'rgba(255,255,255,0.5)' },
    priceVal: { fontSize: 14, color: '#FFF', fontWeight: '600' },
    totalRow: {
        paddingTop: 12, borderTopWidth: 1,
        borderTopColor: 'rgba(255,255,255,0.1)', marginTop: 4,
    },
    totalLabel: { fontSize: 16, fontWeight: '700', color: '#FFF' },
    totalVal: { fontSize: 20, fontWeight: '900', color: '#00FFFF' },
    emptyBox: { alignItems: 'center', paddingTop: 80 },
    emptyEmoji: { fontSize: 56, marginBottom: 16 },
    emptyText: { fontSize: 18, color: 'rgba(255,255,255,0.4)', fontWeight: '600' },
    ctaContainer: { paddingHorizontal: 20, paddingTop: 12 },
    ctaButton: { borderRadius: 20, overflow: 'hidden' },
    ctaGradient: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        paddingVertical: 18, paddingHorizontal: 24,
    },
    ctaText: { fontSize: 16, fontWeight: '800', color: '#FFF' },
});
