import React, { useState, useRef, useEffect } from 'react';
import {
    View,
    StyleSheet,
    Animated,
    Dimensions,
    Image,
    SafeAreaView,
    Platform,
    ScrollView,
    TouchableOpacity, // Added for Tip Buttons
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FareEstimate } from '../types/ride';
import { formatCurrency, processTip } from '../services/api'; // Keeping utility
import { tokens } from '../design-system/tokens';
import { Txt, Card, Btn, Surface } from '../design-system/primitives';

// Assets
const CHECKMARK_ASSET = require('../../assets/images/checkmark_orb.png');

interface Driver {
    name: string;
    vehicle: string;
    plate: string;
    rating: number;
    photo_url?: string;
}

interface RatingScreenProps {
    navigation: any;
    route: {
        params: {
            driver: Driver;
            fare: FareEstimate;
            rideId: string;
            paymentMethod?: 'cash' | 'card';
        };
    };
}

export function RatingScreen({ navigation, route }: RatingScreenProps) {
    const { driver, fare, rideId, paymentMethod = 'cash' } = route.params;
    const [selectedRating, setSelectedRating] = useState(5);
    const [selectedTip, setSelectedTip] = useState(0); // 0, 1, 3, 5
    const [submitting, setSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);
    const insets = useSafeAreaInsets();

    const checkmarkScale = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        Animated.spring(checkmarkScale, {
            toValue: 1,
            friction: 6,
            tension: 40,
            useNativeDriver: true,
        }).start();
    }, []);

    const handleSubmit = async () => {
        if (submitting) return;
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

        setSubmitting(true);

        // Process Tip if selected
        if (selectedTip > 0 && rideId) {
            const tipCents = selectedTip * 100;
            console.log(`[Rating] Processing Tip: $${selectedTip} for Ride ${rideId}`);
            const res = await processTip(rideId, tipCents);
            if (!res.success) {
                console.warn('[Rating] Tip failed:', res.error);
                // We don't block the flow, just log it. 
                // Maybe show alert? For UX flow we proceed.
            } else {
                console.log('[Rating] Tip Success');
            }
        }

        setSubmitted(true);
        setTimeout(() => {
            // Reset stack to Home to ensure clean state
            navigation.reset({
                index: 0,
                routes: [{ name: 'Home' }],
            });
        }, 1500);
    };

    const handleViewReceipt = () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        navigation.navigate('Receipt', {
            ride: {
                id: rideId,
                fare: {
                    amount: fare.total_fare_cents / 100,
                    currency: 'TTD',
                },
                pickup_address: 'Pickup',
                dropoff_address: 'Dropoff',
                driver_name: driver.name,
                vehicle: driver.vehicle,
                plate: driver.plate,
                payment_method: paymentMethod,
                created_at: new Date().toISOString(),
                tip: selectedTip,
            },
        });
    };

    if (submitted) {
        return (
            <View style={styles.container}>
                <View style={[styles.thankYouContainer, { paddingTop: insets.top }]}>
                    <Animated.View style={{ transform: [{ scale: checkmarkScale }], alignItems: 'center', justifyContent: 'center' }}>
                        {/* Glow Behind */}
                        <View style={{
                            position: 'absolute',
                            width: 100,
                            height: 100,
                            borderRadius: 50,
                            backgroundColor: tokens.colors.primary.purple,
                            opacity: 0.5,
                            shadowColor: tokens.colors.primary.purple,
                            shadowOpacity: 1,
                            shadowRadius: 30,
                        }} />
                        <Image source={CHECKMARK_ASSET} style={{ width: 120, height: 120 }} resizeMode="contain" />
                    </Animated.View>
                    <View style={{ height: 24 }} />
                    <Txt variant="headingL" center>Thank you!</Txt>
                    <Txt variant="bodyReg" color={tokens.colors.text.secondary} center>Your ride is complete</Txt>
                </View>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <SafeAreaView style={styles.safeArea}>
                <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

                    {/* 1. Checkmark Orb Asset with True Glow */}
                    <View style={styles.orbWrapper}>
                        {/* Glow Layer - multiple rings for softness */}
                        <View style={[styles.orbGlowRing, { width: 120, height: 120, opacity: 0.2 }]} />
                        <View style={[styles.orbGlowRing, { width: 140, height: 140, opacity: 0.1 }]} />
                        <View style={[styles.orbGlowRing, { width: 160, height: 160, opacity: 0.05 }]} />

                        <Animated.View style={{ transform: [{ scale: checkmarkScale }] }}>
                            <Image source={CHECKMARK_ASSET} style={{ width: 140, height: 140, zIndex: 10 }} resizeMode="contain" />
                        </Animated.View>
                    </View>

                    {/* 2. Text Content */}
                    <Txt variant="headingL" center style={{ marginBottom: tokens.layout.spacing.xl }}>
                        Ride Complete
                    </Txt>

                    {/* 3. Fare Card */}
                    <Surface style={styles.fareCard} intensity={30}>
                        <Txt variant="headingL" weight="bold">
                            {formatCurrency(fare.total_fare_cents)}
                        </Txt>
                        <Txt variant="bodyReg" color={tokens.colors.status.success} style={{ marginTop: 4 }}>
                            Payment: {paymentMethod === 'cash' ? 'Cash' : 'Card'} ✓
                        </Txt>
                    </Surface>

                    {/* 4. Star Rating */}
                    <View style={styles.starsRow}>
                        {[1, 2, 3, 4, 5].map((star) => (
                            <Animated.Text
                                key={star}
                                onPress={() => {
                                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                                    setSelectedRating(star);
                                }}
                                style={[
                                    styles.star,
                                    {
                                        color: star <= selectedRating ? '#FFFFFF' : 'rgba(255,255,255,0.2)',
                                        textShadowColor: star <= selectedRating ? 'rgba(255,255,255,0.5)' : 'transparent',
                                        textShadowRadius: 10,
                                    }
                                ]}
                            >
                                ★
                            </Animated.Text>
                        ))}
                    </View>

                    {/* 5. Driver Info */}
                    <Card padding="md" radius="l" style={styles.driverCard}>
                        <View style={styles.driverRow}>
                            <View style={styles.avatarRing}>
                                {driver.photo_url ? (
                                    <Image source={{ uri: driver.photo_url }} style={styles.avatar} />
                                ) : (
                                    <View style={[styles.avatar, { backgroundColor: '#333' }]} />
                                )}
                            </View>
                            <View style={{ marginLeft: 12 }}>
                                <Txt variant="bodyBold">{driver.name}</Txt>
                                <Txt variant="caption" color={tokens.colors.text.secondary}>
                                    {driver.vehicle} • {driver.plate}
                                </Txt>
                            </View>
                        </View>
                    </Card>

                    {/* 6. Tip Selector (NEW) */}
                    <View style={styles.tipContainer}>
                        <Txt variant="bodyBold" style={{ marginBottom: 12 }}>Add a Tip</Txt>
                        <View style={styles.tipRow}>
                            {[0, 1, 3, 5].map((amt) => {
                                const isSelected = selectedTip === amt;
                                return (
                                    <TouchableOpacity
                                        key={amt}
                                        onPress={() => {
                                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                            setSelectedTip(amt);
                                        }}
                                        style={[
                                            styles.tipBtn,
                                            isSelected && styles.tipBtnSelected
                                        ]}
                                    >
                                        <Txt variant="bodyBold" color={isSelected ? 'white' : tokens.colors.text.secondary}>
                                            {amt === 0 ? 'No Tip' : `$${amt}`}
                                        </Txt>
                                    </TouchableOpacity>
                                );
                            })}
                        </View>
                    </View>

                    {/* 7. Buttons - Pushed to bottom of scrollview */}
                    <View style={styles.buttonRow}>
                        <View style={{ flex: 1 }}>
                            <Btn
                                title={submitting ? "Processing..." : "Submit Review"}
                                variant="primary"
                                onPress={handleSubmit}
                                disabled={submitting}
                            />
                        </View>
                        <View style={{ width: 16 }} />
                        <View style={{ flex: 1 }}>
                            <Btn title="View Receipt" variant="glass" onPress={handleViewReceipt} disabled={submitting} />
                        </View>
                    </View>

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
    safeArea: {
        flex: 1,
    },
    scrollContent: {
        flexGrow: 1,
        alignItems: 'center',
        paddingHorizontal: tokens.layout.spacing.lg,
        paddingTop: 40,
        paddingBottom: 20, // Bottom padding for buttons
    },
    orbWrapper: {
        marginBottom: 24,
        alignItems: 'center',
        justifyContent: 'center',
        width: 160,
        height: 160,
    },
    orbGlowRing: {
        position: 'absolute',
        borderRadius: 999,
        backgroundColor: tokens.colors.primary.purple,
    },
    fareCard: {
        width: '100%',
        paddingVertical: 24,
        alignItems: 'center',
        borderRadius: tokens.layout.radius.xl,
        marginBottom: 32,
    },
    starsRow: {
        flexDirection: 'row',
        gap: 8,
        marginBottom: 32,
    },
    star: {
        fontSize: 40,
    },
    driverCard: {
        width: '100%',
        marginBottom: 24,
        backgroundColor: 'rgba(255,255,255,0.05)',
    },
    driverRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
    },
    avatarRing: {
        width: 48,
        height: 48,
        borderRadius: 24,
        padding: 2,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.2)',
    },
    avatar: {
        flex: 1,
        borderRadius: 22,
    },
    // NEW TIP STYLES
    tipContainer: {
        width: '100%',
        marginBottom: 32,
    },
    tipRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        gap: 8,
    },
    tipBtn: {
        flex: 1,
        height: 48,
        borderRadius: 24,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.1)',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(255,255,255,0.02)',
    },
    tipBtnSelected: {
        borderColor: tokens.colors.primary.purple,
        backgroundColor: tokens.colors.primary.purple,
    },
    buttonRow: {
        flexDirection: 'row',
        width: '100%',
        marginTop: 'auto', // Pushes to bottom of flex container (ScrollView content)
    },
    thankYouContainer: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
});
