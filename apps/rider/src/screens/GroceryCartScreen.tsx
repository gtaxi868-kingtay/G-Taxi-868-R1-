import React, { useState } from 'react';
import {
    View, Text, TouchableOpacity, StyleSheet,
    FlatList, Alert, Switch, Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useStripe } from '@stripe/stripe-react-native';
import { supabase } from '@gtaxi/core';
import { useAuth } from '../context/AuthContext';
import { useRide } from '../context/RideContext';
import { ghostBorder, elevationGlow } from '@gtaxi/design-system/utils/style-rules';
import { SURFACE, VOICES, ANIMATION } from '@gtaxi/design-system';

const CYAN = '#06B6D4';

interface CartItem {
    product: { id: string; name: string; price_cents: number };
    quantity: number;
}

export function GroceryCartScreen({ navigation, route }: any) {
    const { cart: initialCart, merchant } = route.params as { cart: CartItem[]; merchant: any };
    const insets = useSafeAreaInsets();
    const { user } = useAuth();
    const { activeRide } = useRide();

    const { initPaymentSheet, presentPaymentSheet } = useStripe();

    const [cart, setCart] = useState<CartItem[]>(initialCart || []);
    const [deliverToRide, setDeliverToRide] = useState(false);
    const [loading, setLoading] = useState(false);
    const [paymentMethod, setPaymentMethod] = useState<'card' | 'cash'>('card');

    const subTotal = cart.reduce((sum, i) => sum + i.product.price_cents * i.quantity, 0);
    const deliveryFee = merchant?.delivery_fee_cents ?? 500;
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
            const { data: order, error: orderErr } = await supabase
                .from('orders')
                .insert({
                    rider_id: user.id,
                    merchant_id: merchant.id,
                    total_cents: total,
                    delivery_fee_cents: deliveryFee,
                    status: 'pending',
                    payment_method: paymentMethod === 'cash' ? 'cash' : 'card',
                    payment_status: paymentMethod === 'cash' ? 'cash_on_delivery' : 'unpaid',
                    delivery_method: deliverToRide && activeRide?.ride_id ? 'to_ride' : 'courier',
                    ride_id: deliverToRide && activeRide?.ride_id ? activeRide.ride_id : null,
                })
                .select('id')
                .single();

            if (orderErr) throw orderErr;

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

            if (paymentMethod === 'card') {
                const { data: piData, error: piErr } = await supabase.functions.invoke(
                    'create_order_payment_intent',
                    { body: { order_id: order.id } }
                );

                if (piErr) throw new Error(piErr.message || 'Failed to create payment');

                const { error: initErr } = await initPaymentSheet({
                    merchantDisplayName: merchant.name || 'G-Taxi',
                    paymentIntentClientSecret: piData.clientSecret,
                    customerId: piData.customer,
                    customerEphemeralKeySecret: piData.ephemeralKey,
                    style: 'alwaysDark',
                });

                if (initErr) throw initErr;

                const { error: presentErr } = await presentPaymentSheet();
                if (presentErr) {
                    Alert.alert('Payment Cancelled', presentErr.message);
                    setLoading(false);
                    return;
                }

                const { error: matchErr } = await supabase.functions.invoke('merchant', {
                    body: { action: 'match_delivery', order_id: order.id },
                });
                if (matchErr) {
                    Alert.alert(
                        'Order Created',
                        `Your order from ${merchant.name} has been paid but dispatch failed. Support will follow up.\nAmount: $${(total / 100).toFixed(2)} TTD`,
                        [{ text: 'OK', onPress: () => navigation.navigate('GroceryOrderStatus', { orderId: order.id }) }]
                    );
                } else {
                    Alert.alert(
                        'Order Placed!',
                        `Your order from ${merchant.name} has been paid.\nAmount: $${(total / 100).toFixed(2)} TTD`,
                        [{ text: 'OK', onPress: () => navigation.navigate('GroceryOrderStatus', { orderId: order.id }) }]
                    );
                }
            } else {
                const { error: matchErr } = await supabase.functions.invoke('merchant', {
                    body: { action: 'match_delivery', order_id: order.id },
                });
                if (matchErr) {
                    console.warn('[Checkout] match_order_delivery:', matchErr.message);
                }
                Alert.alert(
                    'Cash on Delivery',
                    `Pay $${(total / 100).toFixed(2)} TTD to the driver upon delivery.\nOrder ID: ${order.id.slice(0, 8).toUpperCase()}`,
                    [{ text: 'OK', onPress: () => navigation.navigate('GroceryOrderStatus', { orderId: order.id }) }]
                );
            }
        } catch (err: any) {
            Alert.alert('Order Failed', err.message || 'Please try again.');
        } finally {
            setLoading(false);
        }
    };

    const renderItem = ({ item }: { item: CartItem }) => (
        <View style={s.itemRow}>
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
                    <Ionicons name="arrow-back" size={22} color="#EAF3F6" />
                </TouchableOpacity>
                <Text style={s.headerTitle}>Your Cart</Text>
                <View style={{ width: 38 }} />
            </View>

            <FlatList<CartItem>
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
                        {activeRide && (
                            <View style={s.deliveryCard}>
                                <View style={s.deliveryRow}>
                                    <View style={s.deliveryInfo}>
                                        <Text style={s.deliveryTitle}>Deliver to My Taxi</Text>
                                        <Text style={s.deliverySub}>Driver will receive the order</Text>
                                    </View>
                                    <Switch
                                        value={deliverToRide}
                                        onValueChange={v => { Haptics.selectionAsync(); setDeliverToRide(v); }}
                                        trackColor={{ false: 'rgba(255,255,255,0.1)', true: VOICES.rider.accent }}
                                        thumbColor={deliverToRide ? CYAN : '#888'}
                                    />
                                </View>
                                {!deliverToRide && (
                                    <Text style={s.deliveryNote}>Independent courier delivery</Text>
                                )}
                            </View>
                        )}

                        <View style={s.paymentCard}>
                            <Text style={s.paymentLabel}>Payment Method</Text>
                            <View style={s.paymentOptions}>
                                <TouchableOpacity
                                    style={[s.paymentOption, paymentMethod === 'card' && s.paymentOptionActive]}
                                    onPress={() => { Haptics.selectionAsync(); setPaymentMethod('card'); }}
                                >
                                    <Ionicons name="card-outline" size={18} color={paymentMethod === 'card' ? CYAN : '#AAA'} />
                                    <Text style={[s.paymentOptionText, paymentMethod === 'card' && s.paymentOptionTextActive]}>Card</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={[s.paymentOption, paymentMethod === 'cash' && s.paymentOptionActive]}
                                    onPress={() => { Haptics.selectionAsync(); setPaymentMethod('cash'); }}
                                >
                                    <Ionicons name="cash-outline" size={18} color={paymentMethod === 'cash' ? CYAN : '#AAA'} />
                                    <Text style={[s.paymentOptionText, paymentMethod === 'cash' && s.paymentOptionTextActive]}>Cash</Text>
                                </TouchableOpacity>
                            </View>
                        </View>

                        <View style={s.priceCard}>
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
                            colors={[VOICES.rider.accent, '#4C1D95']}
                            start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                            style={s.ctaGradient}
                        >
                                <Ionicons name={paymentMethod === 'card' ? "card-outline" : "cash-outline"} size={22} color="#EAF3F6" style={{ marginRight: 8 }} />
                            <Text style={s.ctaText}>{loading ? 'Placing Order...' : paymentMethod === 'card' ? `Pay with Card · $${(total / 100).toFixed(2)} TTD` : `Cash on Delivery · $${(total / 100).toFixed(2)} TTD`}</Text>
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
    headerTitle: { fontSize: 20, fontWeight: '700', color: '#EAF3F6' },
    listContent: { padding: 20, gap: 12, paddingBottom: 120 },
    itemRow: {
        flexDirection: 'row', alignItems: 'center',
        borderRadius: 18, overflow: 'hidden',
        ...ghostBorder(0.1),
        padding: 14, gap: 10,
        backgroundColor: 'rgba(255,255,255,0.05)',
    },
    itemLeft: { flex: 1 },
    itemName: { fontSize: 14, fontWeight: '600', color: '#EAF3F6' },
    itemPrice: { fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 2 },
    itemQty: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    qtyBtn: {
        width: 28, height: 28, borderRadius: 14,
        backgroundColor: `${VOICES.rider.accent}33`,
        alignItems: 'center', justifyContent: 'center',
    },
    qtyBtnAdd: { backgroundColor: VOICES.rider.accent },
    qtyBtnText: { fontSize: 18, color: '#EAF3F6', fontWeight: '700', lineHeight: 22 },
    qtyVal: { fontSize: 16, fontWeight: '700', color: '#EAF3F6', minWidth: 20, textAlign: 'center' },
    lineTotal: { fontSize: 14, fontWeight: '700', color: CYAN, minWidth: 60, textAlign: 'right' },
    footer: { gap: 12, marginTop: 8 },
    deliveryCard: {
        borderRadius: 20, overflow: 'hidden', padding: 16,
        ...ghostBorder(0.2),
        backgroundColor: 'rgba(0,255,255,0.04)',
    },
    deliveryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    deliveryInfo: {},
    deliveryTitle: { fontSize: 15, fontWeight: '700', color: '#EAF3F6' },
    deliverySub: { fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 2 },
    deliveryNote: { fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 8 },
    paymentCard: {
        borderRadius: 20, overflow: 'hidden', padding: 18,
        ...ghostBorder(0.1),
        backgroundColor: 'rgba(255,255,255,0.04)', gap: 12,
    },
    paymentLabel: { fontSize: 13, fontWeight: '700', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: 0.5 },
    paymentOptions: { flexDirection: 'row', gap: 10 },
    paymentOption: {
        flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
        paddingVertical: 14, borderRadius: 14,
        backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
    },
    paymentOptionActive: { borderColor: CYAN, backgroundColor: `${CYAN}15` },
    paymentOptionText: { fontSize: 15, fontWeight: '700', color: '#AAA' },
    paymentOptionTextActive: { color: '#EAF3F6' },
    priceCard: {
        borderRadius: 20, overflow: 'hidden', padding: 18,
        ...ghostBorder(0.1),
        backgroundColor: 'rgba(255,255,255,0.04)', gap: 10,
    },
    priceRow: { flexDirection: 'row', justifyContent: 'space-between' },
    priceLabel: { fontSize: 14, color: 'rgba(255,255,255,0.5)' },
    priceVal: { fontSize: 14, color: '#EAF3F6', fontWeight: '600' },
    totalRow: {
        paddingTop: 12, borderTopWidth: 1,
        borderTopColor: 'rgba(255,255,255,0.1)', marginTop: 4,
    },
    totalLabel: { fontSize: 16, fontWeight: '700', color: '#EAF3F6' },
    totalVal: { fontSize: 20, fontWeight: '900', color: CYAN },
    emptyBox: { alignItems: 'center', paddingTop: 80 },
    emptyEmoji: { fontSize: 56, marginBottom: 16 },
    emptyText: { fontSize: 18, color: 'rgba(255,255,255,0.4)', fontWeight: '600' },
    ctaContainer: { paddingHorizontal: 20, paddingTop: 12 },
    ctaButton: { borderRadius: 20, overflow: 'hidden' },
    ctaGradient: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        paddingVertical: 18, paddingHorizontal: 24,
    },
    ctaText: { fontSize: 16, fontWeight: '800', color: '#EAF3F6' },
});
