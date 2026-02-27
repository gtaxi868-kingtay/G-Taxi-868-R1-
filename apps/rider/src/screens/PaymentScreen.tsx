// PaymentScreen.tsx
// Phase 6 Fix 6.6 — Full card payment via Stripe alongside cash and wallet options.
//
// Payment methods:
//   cash   — rider pays driver in cash; no in-app transaction at booking time
//   wallet — deducted from rider wallet balance via process_wallet_payment RPC
//   card   — Stripe PaymentSheet flow; calls create_payment_intent edge function
//
// When ride_id and payment_method are passed via route params, the screen
// handles the active-ride payment flow (e.g. from ActiveRideScreen confirm).
// Without params it acts as a standalone method-selection settings screen.

import React, { useState, useCallback } from 'react';
import {
    View,
    StyleSheet,
    TouchableOpacity,
    ScrollView,
    Alert,
    ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStripe } from '@stripe/stripe-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Surface, Txt, Card } from '../design-system/primitives';
import { tokens } from '../design-system/tokens';
import { supabase } from '../../../../shared/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

type PaymentMethod = 'cash' | 'wallet' | 'card';

interface PaymentOption {
    id: PaymentMethod;
    icon: string;
    label: string;
    subtitle: string;
    available: boolean;
}

const PAYMENT_OPTIONS: PaymentOption[] = [
    {
        id: 'cash',
        icon: '💵',
        label: 'Cash',
        subtitle: 'Pay your driver directly',
        available: true,
    },
    {
        id: 'wallet',
        icon: '👛',
        label: 'G-Taxi Wallet',
        subtitle: 'Deducted from your in-app balance',
        available: true,
    },
    {
        id: 'card',
        icon: '💳',
        label: 'Debit / Credit Card',
        subtitle: 'Secure payment via Stripe',
        available: true,
    },
];

// ─── Component ────────────────────────────────────────────────────────────────

export function PaymentScreen({ navigation, route }: any) {
    // route.params may supply: { ride_id, payment_method, fare_cents }
    // When present, this screen is in "active payment" mode — the Pay button
    // charges the card for the given ride_id.
    const rideId: string | undefined = route?.params?.ride_id;
    const initialMethod: PaymentMethod = route?.params?.payment_method ?? 'cash';
    const fareCents: number | undefined = route?.params?.fare_cents;

    const [selectedMethod, setSelectedMethod] = useState<PaymentMethod>(initialMethod);
    const [loading, setLoading] = useState(false);

    const insets = useSafeAreaInsets();
    const { initPaymentSheet, presentPaymentSheet } = useStripe();

    // ── Card payment flow ──────────────────────────────────────────────────────
    const handleCardPayment = useCallback(async () => {
        if (!rideId) {
            Alert.alert('Error', 'No ride is associated with this payment.');
            return;
        }

        setLoading(true);

        try {
            // Step 1: Create PaymentIntent on server — server verifies ride ownership
            const { data, error: fnError } = await supabase.functions.invoke(
                'create_payment_intent',
                { body: { ride_id: rideId } }
            );

            if (fnError || !data?.clientSecret) {
                Alert.alert(
                    'Payment Setup Failed',
                    fnError?.message ?? 'Could not initialise payment. Please try again.'
                );
                setLoading(false);
                return;
            }

            // Step 2: Initialise Stripe PaymentSheet with the client secret
            const { error: initError } = await initPaymentSheet({
                paymentIntentClientSecret: data.clientSecret,
                merchantDisplayName: 'G-Taxi 868',
                style: 'alwaysDark',
                appearance: {
                    colors: {
                        primary: tokens.colors.primary.purple,
                        background: '#0a0118',
                        componentBackground: '#1a0a28',
                        componentText: '#FFFFFF',
                        primaryText: '#FFFFFF',
                        secondaryText: '#A0A0B0',
                        placeholderText: '#606070',
                        icon: '#FFFFFF',
                        error: '#FF4D4D',
                    },
                },
            });

            if (initError) {
                Alert.alert('Payment Error', initError.message);
                setLoading(false);
                return;
            }

            // Step 3: Present the Stripe payment sheet to the user
            const { error: presentError } = await presentPaymentSheet();

            if (presentError) {
                if (presentError.code === 'Canceled') {
                    // User dismissed — not an error, just let them pick again
                    setLoading(false);
                    return;
                }
                Alert.alert('Payment Failed', presentError.message);
                setLoading(false);
                return;
            }

            // Step 4: Payment confirmed by Stripe — stripe_webhook will capture
            // and write ledger + wallet entries server-side.
            // UI-A4: Use goBack() not navigate('ActiveRide') — navigate requires
            // all required params (destination, fare, driver, rideId) which we
            // don't have here. goBack() returns to the calling ActiveRideScreen.
            Alert.alert(
                'Payment Successful 🎉',
                'Your card payment has been processed. The driver will be notified.',
                [
                    {
                        text: 'OK',
                        onPress: () => navigation.goBack(),
                    },
                ]
            );
        } catch (err: any) {
            console.error('handleCardPayment error:', err);
            Alert.alert('Error', err?.message ?? 'An unexpected error occurred.');
        } finally {
            setLoading(false);
        }
    }, [rideId, initPaymentSheet, presentPaymentSheet, navigation]);

    // ── Confirm selection / trigger payment ────────────────────────────────────
    const handleConfirm = useCallback(async () => {
        if (selectedMethod === 'card') {
            await handleCardPayment();
        } else {
            // cash / wallet: navigate back and let ride confirmation handle it
            navigation.goBack();
        }
    }, [selectedMethod, handleCardPayment, navigation]);

    // ─── Render ───────────────────────────────────────────────────────────────
    return (
        <View style={styles.container}>
            <LinearGradient
                colors={[tokens.colors.background.base, '#0A0A14']}
                style={StyleSheet.absoluteFill}
            />

            {/* Header */}
            <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
                    <Txt variant="headingL">←</Txt>
                </TouchableOpacity>
                <Txt variant="headingM" weight="bold">Payment</Txt>
                <View style={{ width: 40 }} />
            </View>

            <ScrollView
                style={styles.scrollView}
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
            >
                {/* Fare display (active-ride mode only) */}
                {typeof fareCents === 'number' && (
                    <Card padding="md" style={styles.fareCard}>
                        <View style={styles.fareRow}>
                            <Txt variant="bodyReg" color={tokens.colors.text.secondary}>Fare</Txt>
                            <Txt variant="headingM" weight="bold">
                                ${(fareCents / 100).toFixed(2)} TTD
                            </Txt>
                        </View>
                    </Card>
                )}

                {/* Section Header */}
                <Txt variant="bodyBold" style={styles.sectionLabel}>Payment Methods</Txt>

                {/* Payment Options */}
                {PAYMENT_OPTIONS.map((option) => {
                    const isSelected = selectedMethod === option.id;
                    return (
                        <TouchableOpacity
                            key={option.id}
                            activeOpacity={option.available ? 0.7 : 1}
                            onPress={() => {
                                if (option.available) setSelectedMethod(option.id);
                            }}
                        >
                            <Card
                                padding="md"
                                style={[
                                    styles.paymentCard,
                                    isSelected && styles.paymentCardSelected,
                                    !option.available && styles.paymentCardDisabled,
                                ]}
                            >
                                <View style={styles.paymentRow}>
                                    <View style={styles.paymentIconContainer}>
                                        <Txt style={{ fontSize: 28 }}>{option.icon}</Txt>
                                    </View>
                                    <View style={styles.paymentInfo}>
                                        <View style={styles.paymentLabelRow}>
                                            <Txt variant="bodyBold">{option.label}</Txt>
                                            {!option.available && (
                                                <View style={styles.comingSoonBadge}>
                                                    <Txt variant="small" color={tokens.colors.primary.cyan}>Soon</Txt>
                                                </View>
                                            )}
                                        </View>
                                        <Txt variant="caption" color={tokens.colors.text.secondary}>
                                            {option.subtitle}
                                        </Txt>
                                    </View>
                                    {/* Selection Indicator */}
                                    <View style={[
                                        styles.radioOuter,
                                        isSelected && styles.radioOuterSelected,
                                    ]}>
                                        {isSelected && <View style={styles.radioInner} />}
                                    </View>
                                </View>
                            </Card>
                        </TouchableOpacity>
                    );
                })}

                {/* Card detail — shown when card is selected */}
                {selectedMethod === 'card' && (
                    <Card padding="md" style={styles.cardInfoSection}>
                        <InfoRow icon="🔒" text="Secured by Stripe — your card details are never stored on G-Taxi servers" />
                        <InfoRow icon="💳" text="Visa, Mastercard, and internationally-issued cards accepted" />
                        <InfoRow icon="🧾" text="A receipt will be sent to your email after payment" />
                    </Card>
                )}

                {/* How It Works */}
                {selectedMethod !== 'card' && (
                    <View style={styles.infoSection}>
                        <Txt variant="bodyBold" style={styles.sectionLabel}>How It Works</Txt>
                        <Card padding="md" style={styles.infoCard}>
                            {selectedMethod === 'cash' && (
                                <>
                                    <InfoRow icon="🔍" text="Your fare is calculated before you confirm" />
                                    <InfoRow icon="🚗" text="Pay your driver in cash at the end of the ride" />
                                    <InfoRow icon="🧾" text="View your receipt after every trip" />
                                </>
                            )}
                            {selectedMethod === 'wallet' && (
                                <>
                                    <InfoRow icon="👛" text="Your G-Taxi wallet balance is deducted automatically" />
                                    <InfoRow icon="⚡" text="No cash or card needed — just confirm and go" />
                                    <InfoRow icon="🧾" text="Full transaction history in your account" />
                                </>
                            )}
                        </Card>
                    </View>
                )}

                {/* Security notice */}
                <View style={styles.securityNote}>
                    <Txt variant="caption" color={tokens.colors.text.secondary} style={styles.securityText}>
                        🔐 All payments are encrypted and processed securely
                    </Txt>
                </View>
            </ScrollView>

            {/* Confirm / Pay Button */}
            {rideId && (
                <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
                    <TouchableOpacity
                        style={[styles.confirmBtn, loading && styles.confirmBtnDisabled]}
                        activeOpacity={0.8}
                        onPress={handleConfirm}
                        disabled={loading}
                    >
                        {loading ? (
                            <ActivityIndicator color="#FFFFFF" />
                        ) : (
                            <Txt variant="bodyBold" style={styles.confirmBtnText}>
                                {selectedMethod === 'card' ? 'Pay with Card' : 'Confirm Payment Method'}
                            </Txt>
                        )}
                    </TouchableOpacity>
                </View>
            )}
        </View>
    );
}

// ─── Info Row ─────────────────────────────────────────────────────────────────

const InfoRow = ({ icon, text }: { icon: string; text: string }) => (
    <View style={styles.infoRow}>
        <Txt style={{ fontSize: 18, marginRight: 12 }}>{icon}</Txt>
        <Txt variant="bodyReg" color={tokens.colors.text.secondary} style={{ flex: 1 }}>{text}</Txt>
    </View>
);

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: tokens.colors.background.base,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        paddingBottom: 16,
    },
    backBtn: {
        width: 40,
        height: 40,
        alignItems: 'center',
        justifyContent: 'center',
    },
    scrollView: {
        flex: 1,
    },
    scrollContent: {
        paddingHorizontal: 20,
        paddingBottom: 40,
    },
    fareCard: {
        marginBottom: 20,
        backgroundColor: 'rgba(138, 43, 226, 0.12)',
        borderColor: 'rgba(138, 43, 226, 0.3)',
        borderWidth: 1,
    },
    fareRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    sectionLabel: {
        marginBottom: 12,
        marginTop: 8,
    },
    paymentCard: {
        marginBottom: 12,
        borderColor: 'rgba(255,255,255,0.06)',
    },
    paymentCardSelected: {
        borderColor: tokens.colors.primary.purple,
        borderWidth: 1.5,
    },
    paymentCardDisabled: {
        opacity: 0.5,
    },
    paymentRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    paymentIconContainer: {
        width: 48,
        height: 48,
        borderRadius: 12,
        backgroundColor: 'rgba(255,255,255,0.05)',
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 16,
    },
    paymentInfo: {
        flex: 1,
    },
    paymentLabelRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    comingSoonBadge: {
        backgroundColor: 'rgba(0, 255, 255, 0.1)',
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 10,
    },
    radioOuter: {
        width: 22,
        height: 22,
        borderRadius: 11,
        borderWidth: 2,
        borderColor: 'rgba(255,255,255,0.2)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    radioOuterSelected: {
        borderColor: tokens.colors.primary.purple,
    },
    radioInner: {
        width: 12,
        height: 12,
        borderRadius: 6,
        backgroundColor: tokens.colors.primary.purple,
    },
    cardInfoSection: {
        marginTop: 8,
        marginBottom: 12,
        gap: 14,
        backgroundColor: 'rgba(138, 43, 226, 0.06)',
        borderColor: 'rgba(138, 43, 226, 0.15)',
        borderWidth: 1,
    },
    infoSection: {
        marginTop: 24,
    },
    infoCard: {
        gap: 16,
    },
    infoRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
    },
    securityNote: {
        marginTop: 24,
        alignItems: 'center',
    },
    securityText: {
        textAlign: 'center',
    },
    footer: {
        paddingHorizontal: 20,
        paddingTop: 12,
        backgroundColor: 'rgba(10, 1, 24, 0.95)',
        borderTopWidth: 1,
        borderTopColor: 'rgba(255,255,255,0.06)',
    },
    confirmBtn: {
        backgroundColor: tokens.colors.primary.purple,
        borderRadius: 14,
        paddingVertical: 16,
        alignItems: 'center',
        justifyContent: 'center',
    },
    confirmBtnDisabled: {
        opacity: 0.6,
    },
    confirmBtnText: {
        color: '#FFFFFF',
        fontSize: 16,
    },
});
