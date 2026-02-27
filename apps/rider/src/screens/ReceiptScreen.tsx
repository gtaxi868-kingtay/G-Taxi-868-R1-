import React from 'react';
import { View, StyleSheet, SafeAreaView, ScrollView, TouchableOpacity, Share, Dimensions } from 'react-native';
import { Surface, Txt, Card, Btn } from '../design-system/primitives';
import { tokens } from '../design-system/tokens';
import { LinearGradient } from 'expo-linear-gradient';
import { formatCurrency } from '../services/api';

const { width } = Dimensions.get('window');

// ─── Locked fare structure (TTD cents) ───────────────────────────────────────
// These must exactly match estimate_fare/index.ts and complete_ride/index.ts.
// Base fare:     $16.00 TTD = 1600 cents
// Per kilometre:  $1.75 TTD =  175 cents/km
// Per minute:     $0.95 TTD =   95 cents/min
// Minimum fare:  $22.00 TTD = 2200 cents
const BASE_FARE_CENTS = 1600;
const PER_KM_CENTS = 175;
const PER_MIN_CENTS = 95;

interface ReceiptScreenProps {
    navigation: any;
    route: {
        params: {
            ride: {
                id: string;
                created_at: string;
                pickup_address?: string;
                dropoff_address?: string;
                total_fare_cents?: number;
                distance_meters?: number;
                duration_seconds?: number;
                payment_method?: 'cash' | 'wallet' | 'card';
                driver_name?: string;
                vehicle_model?: string;
                plate_number?: string;
            };
        };
    };
}

export function ReceiptScreen({ navigation, route }: ReceiptScreenProps) {
    const { ride } = route.params;

    const date = new Date(ride.created_at).toLocaleDateString('en-GB', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });

    const distance = ride.distance_meters ? (ride.distance_meters / 1000).toFixed(1) : '?';
    const duration = ride.duration_seconds ? Math.round(ride.duration_seconds / 60) : '?';

    // ── Fare breakdown using locked fare structure ──────────────────────────────
    // These match the edge function pricing exactly.
    const baseFare = BASE_FARE_CENTS;
    const distanceFare = ride.distance_meters
        ? Math.round((ride.distance_meters / 1000) * PER_KM_CENTS)
        : 0;
    const timeFare = ride.duration_seconds
        ? Math.round((ride.duration_seconds / 60) * PER_MIN_CENTS)
        : 0;

    // If the server gave us total_fare_cents, always prefer it over the
    // client-side recalculation (handles vehicle multipliers, etc.).
    const totalFare = ride.total_fare_cents || Math.max(
        BASE_FARE_CENTS,
        baseFare + distanceFare + timeFare
    );

    // ── Payment method display helpers ─────────────────────────────────────────
    const paymentIcon =
        ride.payment_method === 'card' ? '💳' :
            ride.payment_method === 'wallet' ? '👛' : '💵';

    const paymentLabel =
        ride.payment_method === 'card' ? 'Card Payment' :
            ride.payment_method === 'wallet' ? 'Wallet Payment' : 'Cash Payment';

    const paymentSubtitle =
        ride.payment_method === 'card' ? 'Charged to card' :
            ride.payment_method === 'wallet' ? 'Deducted from G-Taxi Wallet' : 'Paid to driver';

    const handleShare = async () => {
        try {
            await Share.share({
                message: `G-Taxi Receipt\n\nTrip: ${ride.pickup_address || 'Pickup'} → ${ride.dropoff_address || 'Destination'}\nDate: ${date}\nFare: ${formatCurrency(totalFare)}\n\nThanks for riding with G-Taxi!`,
            });
        } catch (error) {
            console.log('Share error:', error);
        }
    };

    return (
        <View style={styles.container}>
            <LinearGradient
                colors={[tokens.colors.background.base, '#1A1A24']}
                style={StyleSheet.absoluteFill}
            />

            <SafeAreaView style={{ flex: 1 }}>
                {/* Header */}
                <View style={styles.header}>
                    <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
                        <Surface style={styles.backSurf} intensity={20}>
                            <Txt variant="headingM">←</Txt>
                        </Surface>
                    </TouchableOpacity>
                    <Txt variant="headingL" weight="bold">Trip Receipt</Txt>
                </View>

                <ScrollView contentContainerStyle={styles.content}>
                    {/* Date */}
                    <Txt variant="bodyReg" color={tokens.colors.text.secondary} style={{ marginBottom: 24 }}>
                        {date}
                    </Txt>

                    {/* Route Card */}
                    <Card style={styles.card} padding="lg">
                        <View style={styles.routeRow}>
                            <View style={styles.routeIcons}>
                                <View style={[styles.dot, { backgroundColor: tokens.colors.primary.purple }]} />
                                <View style={styles.line} />
                                <View style={[styles.dot, { backgroundColor: tokens.colors.primary.cyan }]} />
                            </View>
                            <View style={styles.routeText}>
                                <Txt variant="bodyBold" numberOfLines={1}>{ride.pickup_address || 'Pickup Location'}</Txt>
                                <View style={{ height: 24 }} />
                                <Txt variant="bodyBold" numberOfLines={1}>{ride.dropoff_address || 'Destination'}</Txt>
                            </View>
                        </View>
                    </Card>

                    {/* Trip Stats */}
                    <View style={styles.statsRow}>
                        <Card style={styles.statCard} padding="md">
                            <Txt variant="headingL" weight="bold">{distance}</Txt>
                            <Txt variant="caption" color={tokens.colors.text.secondary}>km</Txt>
                        </Card>
                        <Card style={styles.statCard} padding="md">
                            <Txt variant="headingL" weight="bold">{duration}</Txt>
                            <Txt variant="caption" color={tokens.colors.text.secondary}>min</Txt>
                        </Card>
                    </View>

                    {/* Fare Breakdown — locked pricing */}
                    <Card style={styles.card} padding="lg">
                        <Txt variant="headingM" weight="bold" style={{ marginBottom: 16 }}>Fare Breakdown</Txt>

                        <View style={styles.fareRow}>
                            <Txt variant="bodyReg" color={tokens.colors.text.secondary}>Base Fare</Txt>
                            <Txt variant="bodyBold">{formatCurrency(baseFare)}</Txt>
                        </View>
                        <View style={styles.fareRow}>
                            <Txt variant="bodyReg" color={tokens.colors.text.secondary}>Distance ({distance} km)</Txt>
                            <Txt variant="bodyBold">{formatCurrency(distanceFare)}</Txt>
                        </View>
                        <View style={styles.fareRow}>
                            <Txt variant="bodyReg" color={tokens.colors.text.secondary}>Time ({duration} min)</Txt>
                            <Txt variant="bodyBold">{formatCurrency(timeFare)}</Txt>
                        </View>

                        <View style={[styles.fareRow, styles.totalRow]}>
                            <Txt variant="headingM" weight="bold">Total</Txt>
                            <Txt variant="headingM" weight="bold" color={tokens.colors.primary.purple}>
                                {formatCurrency(totalFare)}
                            </Txt>
                        </View>
                    </Card>

                    {/* Payment Method — cash | wallet | card */}
                    <Card style={styles.card} padding="md">
                        <View style={styles.paymentRow}>
                            <Txt style={{ fontSize: 24 }}>{paymentIcon}</Txt>
                            <View style={{ marginLeft: 12 }}>
                                <Txt variant="bodyBold">{paymentLabel}</Txt>
                                <Txt variant="caption" color={tokens.colors.text.secondary}>
                                    {paymentSubtitle}
                                </Txt>
                            </View>
                        </View>
                    </Card>

                    {/* Driver Info (if available) */}
                    {ride.driver_name && (
                        <Card style={styles.card} padding="md">
                            <View style={styles.driverRow}>
                                <View style={styles.driverAvatar}>
                                    <Txt style={{ fontSize: 24 }}>👤</Txt>
                                </View>
                                <View style={{ marginLeft: 12 }}>
                                    <Txt variant="bodyBold">{ride.driver_name}</Txt>
                                    <Txt variant="caption" color={tokens.colors.text.secondary}>
                                        {ride.vehicle_model} • {ride.plate_number}
                                    </Txt>
                                </View>
                            </View>
                        </Card>
                    )}

                    {/* Share Button */}
                    <Btn
                        title="Share Receipt"
                        variant="glass"
                        onPress={handleShare}
                        style={{ marginTop: 24 }}
                    />
                </ScrollView>
            </SafeAreaView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: tokens.colors.background.base,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 20,
    },
    backBtn: {
        marginRight: 16,
    },
    backSurf: {
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
    },
    content: {
        padding: 20,
    },
    card: {
        backgroundColor: 'rgba(255,255,255,0.03)',
        marginBottom: 16,
    },
    routeRow: {
        flexDirection: 'row',
    },
    routeIcons: {
        alignItems: 'center',
        marginRight: 16,
    },
    dot: {
        width: 10,
        height: 10,
        borderRadius: 5,
    },
    line: {
        width: 2,
        height: 24,
        backgroundColor: 'rgba(255,255,255,0.1)',
    },
    routeText: {
        flex: 1,
    },
    statsRow: {
        flexDirection: 'row',
        gap: 12,
        marginBottom: 16,
    },
    statCard: {
        flex: 1,
        alignItems: 'center',
        backgroundColor: 'rgba(255,255,255,0.03)',
    },
    fareRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 8,
    },
    totalRow: {
        marginTop: 16,
        paddingTop: 16,
        borderTopWidth: 1,
        borderTopColor: 'rgba(255,255,255,0.1)',
    },
    paymentRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    driverRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    driverAvatar: {
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: 'rgba(255,255,255,0.1)',
        alignItems: 'center',
        justifyContent: 'center',
    },
});
