import React, { useState } from 'react';
import { View, StyleSheet, TouchableOpacity, ScrollView, Dimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Surface, Txt, Card } from '../design-system/primitives';
import { tokens } from '../design-system/tokens';
import { LinearGradient } from 'expo-linear-gradient';

const { width } = Dimensions.get('window');

type PaymentMethod = 'cash' | 'card';

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
        id: 'card',
        icon: '💳',
        label: 'Debit / Credit Card',
        subtitle: 'Coming Soon to Trinidad & Tobago',
        available: false,
    },
];

export function PaymentScreen({ navigation }: any) {
    const [selectedMethod, setSelectedMethod] = useState<PaymentMethod>('cash');
    const insets = useSafeAreaInsets();

    return (
        <View style={styles.container}>
            <LinearGradient
                colors={[tokens.colors.background.base, '#0A0A14']}
                style={StyleSheet.absoluteFill}
            />

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

                {/* Ride Payment Info */}
                <View style={styles.infoSection}>
                    <Txt variant="bodyBold" style={styles.sectionLabel}>How It Works</Txt>
                    <Card padding="md" style={styles.infoCard}>
                        <InfoRow icon="🔍" text="Your fare is calculated before you confirm" />
                        <InfoRow icon="🚗" text="Pay your driver in cash at the end of the ride" />
                        <InfoRow icon="🧾" text="View your receipt after every trip" />
                    </Card>
                </View>

                {/* Add Card Promo */}
                <Card padding="md" style={styles.promoCard}>
                    <Txt variant="bodyBold">Card payments coming soon</Txt>
                    <Txt variant="caption" color={tokens.colors.text.secondary} style={{ marginTop: 4 }}>
                        We're working on bringing debit and credit card payments to Trinidad & Tobago. Stay tuned!
                    </Txt>
                </Card>
            </ScrollView>
        </View>
    );
}

const InfoRow = ({ icon, text }: { icon: string; text: string }) => (
    <View style={styles.infoRow}>
        <Txt style={{ fontSize: 18, marginRight: 12 }}>{icon}</Txt>
        <Txt variant="bodyReg" color={tokens.colors.text.secondary} style={{ flex: 1 }}>{text}</Txt>
    </View>
);

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
    infoSection: {
        marginTop: 24,
    },
    infoCard: {
        gap: 16,
    },
    infoRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    promoCard: {
        marginTop: 24,
        backgroundColor: 'rgba(255,255,255,0.03)',
    },
});
