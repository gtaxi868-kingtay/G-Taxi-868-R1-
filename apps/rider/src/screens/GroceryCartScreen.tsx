import React, { useState } from 'react';
import { View, Pressable, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { useStripe } from '@stripe/stripe-react-native';
import { supabase } from '@gtaxi/core';
import { useAuth } from '../context/AuthContext';
import { useRide } from '../context/RideContext';
import { toast } from '../components/Toast';
import { Button, Card, Chip, Divider, EmptyState, Screen, Section, SPACE, Toggle, Txt, useTheme } from '../ui/kit';

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
    const [paymentMethod, setPaymentMethod] = useState<'cash' | 'wallet' | 'card'>('cash');
    // Delivery is priced by distance from the store to the drop-off, so it
    // is only known once the delivery location is (quoted at checkout).
    const [quotedFee, setQuotedFee] = useState<number | null>(null);

    const subTotal = cart.reduce((sum, i) => sum + i.product.price_cents * i.quantity, 0);
    const total = subTotal + (quotedFee ?? 0);

    const updateQty = (productId: string, delta: number) => {
        Haptics.selectionAsync();
        setCart(prev =>
            prev
                .map(c => c.product.id === productId ? { ...c, quantity: c.quantity + delta } : c)
                .filter(c => c.quantity > 0)
        );
    };

    const resolveDeliveryLocation = async (): Promise<{ address: string; lat: number; lng: number } | null> => {
        if (deliverToRide && activeRide?.dropoff_lat != null && activeRide?.dropoff_lng != null) {
            return {
                address: activeRide.dropoff_address || 'Active ride dropoff',
                lat: activeRide.dropoff_lat,
                lng: activeRide.dropoff_lng,
            };
        }

        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
            Alert.alert('Location needed', 'Enable location access so the driver knows where to deliver.');
            return null;
        }

        const pos = await Location.getCurrentPositionAsync({});
        const [place] = await Location.reverseGeocodeAsync({
            latitude: pos.coords.latitude, longitude: pos.coords.longitude,
        }).catch(() => [null]);

        const address = place
            ? [place.name, place.street, place.city].filter(Boolean).join(', ')
            : `${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`;

        return { address, lat: pos.coords.latitude, lng: pos.coords.longitude };
    };

    const handleCheckout = async () => {
        if (cart.length === 0) return;
        if (!user?.id) { toast('Please sign in again.', 'error'); return; }

        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        setLoading(true);

        try {
            const location = await resolveDeliveryLocation();
            if (!location) { setLoading(false); return; }

            // place_order builds the order from the server-side cart
            // (cart_items). The app used to keep the cart only on the phone,
            // so every order failed with "Cart is empty". Send it first.
            const clear = await supabase.functions.invoke('grocery', {
                body: { action: 'manage_cart', cart_action: 'clear', merchant_id: merchant.id },
            });
            if (clear.error || clear.data?.success === false) throw new Error(clear.data?.error || 'Could not prepare your cart');
            for (const item of cart) {
                const { data: added, error: addErr } = await supabase.functions.invoke('grocery', {
                    body: { action: 'manage_cart', cart_action: 'add', merchant_id: merchant.id, product_id: item.product.id, quantity: item.quantity },
                });
                if (addErr || added?.success === false) throw new Error(added?.error || `${item.product.name} is no longer available`);
            }

            const { data: quoteResult, error: quoteErr } = await supabase.functions.invoke('grocery', {
                body: {
                    action: 'quote_delivery',
                    merchant_id: merchant.id,
                    delivery_lat: location.lat,
                    delivery_lng: location.lng,
                },
            });
            if (quoteErr || !quoteResult?.success) {
                throw new Error(quoteResult?.error || quoteErr?.message || 'Could not price delivery');
            }
            const fee: number = quoteResult.quote.fee_cents;
            const km = (quoteResult.quote.distance_meters / 1000).toFixed(1);
            setQuotedFee(fee);

            const goAhead = await new Promise<boolean>((resolve) => {
                Alert.alert(
                    'Delivery fee',
                    `Delivery is $${(fee / 100).toFixed(2)} TTD for about ${km} km from the store.\nTotal: $${((subTotal + fee) / 100).toFixed(2)} TTD`,
                    [
                        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
                        { text: 'Place order', onPress: () => resolve(true) },
                    ],
                );
            });
            if (!goAhead) { setLoading(false); return; }

            const { data: placeResult, error: placeErr } = await supabase.functions.invoke('grocery', {
                body: {
                    action: 'place_order',
                    merchant_id: merchant.id,
                    delivery_address: location.address,
                    delivery_lat: location.lat,
                    delivery_lng: location.lng,
                    payment_method: paymentMethod,
                },
            });

            if (placeErr) throw new Error(placeErr.message || 'Failed to place order');
            if (placeResult?.success === false) throw new Error(placeResult.error || 'Failed to place order');

            const order = placeResult.order;
            const orderTotal: number = order.total_cents ?? subTotal + fee;

            if (paymentMethod === 'card') {
                const { data: piData, error: piErr } = await supabase.functions.invoke('grocery', {
                    body: { action: 'create_payment_intent', order_id: order.order_id },
                });

                if (piErr || piData?.error) throw new Error(piData?.error || piErr?.message || 'Failed to create payment');

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
                    Alert.alert('Payment cancelled', presentErr.message);
                    setLoading(false);
                    return;
                }

                await supabase.functions.invoke('grocery', {
                    body: { action: 'confirm_authorization', order_id: order.order_id },
                });

                const { error: matchErr } = await supabase.functions.invoke('merchant', {
                    body: { action: 'match_delivery', order_id: order.order_id },
                });
                if (matchErr) {
                    Alert.alert(
                        'Order created',
                        `Your order from ${merchant.name} has been paid but dispatch failed. Support will follow up.\nAmount: $${(orderTotal / 100).toFixed(2)} TTD`,
                        [{ text: 'OK', onPress: () => navigation.navigate('GroceryOrderStatus', { orderId: order.order_id }) }]
                    );
                } else {
                    Alert.alert(
                        'Order placed',
                        `Your order from ${merchant.name} has been paid.\nAmount: $${(orderTotal / 100).toFixed(2)} TTD`,
                        [{ text: 'OK', onPress: () => navigation.navigate('GroceryOrderStatus', { orderId: order.order_id }) }]
                    );
                }
            } else {
                const { error: matchErr } = await supabase.functions.invoke('merchant', {
                    body: { action: 'match_delivery', order_id: order.order_id },
                });
                if (matchErr) {
                    console.warn('[Checkout] match_order_delivery:', matchErr.message);
                }

                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                toast(paymentMethod === 'cash'
                    ? `Order placed. Pay $${(orderTotal / 100).toFixed(2)} TTD in cash when it arrives.`
                    : `Order placed and paid from your G-Coin: $${(orderTotal / 100).toFixed(2)} TTD.`, 'success');
                navigation.replace('GroceryOrderStatus', { orderId: order.order_id });
            }
        } catch (err: any) {
            toast(err.message || 'Your order did not go through. Please try again.', 'error');
        } finally {
            setLoading(false);
        }
    };

    const m = useTheme();
    const qtyBtn = (icon: any, label: string, onPress: () => void) => (
        <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={6}
            style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: m.field, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name={icon} size={16} color={m.ink} />
        </Pressable>
    );
    const line = (label: string, value: string, strong?: boolean) => (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 }}>
            <Txt variant={strong ? 'headline' : 'body'} tone={strong ? 'ink' : 'dim'}>{label}</Txt>
            <Txt variant={strong ? 'headline' : 'bodyStrong'}>{value}</Txt>
        </View>
    );

    return (
        <Screen
            title="Your cart"
            onBack={() => navigation.goBack()}
            footer={cart.length > 0 ? (
                <Button
                    title={quotedFee != null ? `Place order · $${(total / 100).toFixed(2)}` : 'See delivery fee and order'}
                    icon={paymentMethod === 'cash' ? 'cash-outline' : 'wallet-outline'}
                    loading={loading}
                    onPress={handleCheckout}
                />
            ) : undefined}
        >
            {cart.length === 0 ? (
                <EmptyState icon="cart-outline" title="Your cart is empty" body="Add something from the shop to get started."
                    action={<Button title="Back to the shop" variant="secondary" onPress={() => navigation.goBack()} />} />
            ) : (
                <>
                    <Txt variant="body" tone="dim" style={{ marginTop: SPACE.sm }}>From {merchant?.name}</Txt>
                    <Card style={{ marginTop: SPACE.md, paddingVertical: SPACE.xs }}>
                        {cart.map((item, i) => (
                            <View key={item.product.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: SPACE.md, borderBottomWidth: i === cart.length - 1 ? 0 : 1, borderBottomColor: m.chipBorder }}>
                                <View style={{ flex: 1, marginRight: SPACE.sm }}>
                                    <Txt variant="bodyStrong" numberOfLines={2}>{item.product.name}</Txt>
                                    <Txt variant="caption" tone="dim">${((item.product.price_cents * item.quantity) / 100).toFixed(2)}</Txt>
                                </View>
                                {qtyBtn(item.quantity === 1 ? 'trash-outline' : 'remove', item.quantity === 1 ? 'Remove' : 'Fewer', () => updateQty(item.product.id, -1))}
                                <Txt variant="bodyStrong" style={{ width: 36, textAlign: 'center' }}>{item.quantity}</Txt>
                                {qtyBtn('add', 'More', () => updateQty(item.product.id, 1))}
                            </View>
                        ))}
                    </Card>

                    {activeRide && (
                        <Card style={{ marginTop: SPACE.md, flexDirection: 'row', alignItems: 'center' }}>
                            <View style={{ flex: 1, marginRight: SPACE.md }}>
                                <Txt variant="bodyStrong">Deliver to my ride</Txt>
                                <Txt variant="caption" tone="dim">{deliverToRide ? 'Goes to where your ride is dropping you off' : 'A courier brings it to where you are now'}</Txt>
                            </View>
                            <Toggle label="Deliver to my ride" value={deliverToRide} onChange={(v) => { Haptics.selectionAsync(); setDeliverToRide(v); }} />
                        </Card>
                    )}

                    <Section title="Pay with">
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                            <Chip icon="cash-outline" label="Cash on delivery" selected={paymentMethod === 'cash'} onPress={() => { Haptics.selectionAsync(); setPaymentMethod('cash'); }} />
                            <Chip icon="wallet-outline" label="G-Coin" selected={paymentMethod === 'wallet'} onPress={() => { Haptics.selectionAsync(); setPaymentMethod('wallet'); }} />
                        </View>
                    </Section>

                    <Card style={{ marginTop: SPACE.md }}>
                        {line('Items', `$${(subTotal / 100).toFixed(2)}`)}
                        {line('Delivery', quotedFee != null ? `$${(quotedFee / 100).toFixed(2)}` : 'Shown before you order')}
                        <Divider style={{ marginVertical: SPACE.sm }} />
                        {line('Total', quotedFee != null ? `$${(total / 100).toFixed(2)} TTD` : `$${(subTotal / 100).toFixed(2)} + delivery`, true)}
                    </Card>
                </>
            )}
        </Screen>
    );
}
