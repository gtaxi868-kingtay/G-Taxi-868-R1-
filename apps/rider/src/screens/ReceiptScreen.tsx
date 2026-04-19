import React, { useEffect, useState } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity, ScrollView,
    Dimensions, Platform, ActivityIndicator, Image
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../../shared/supabase';

const { width, height } = Dimensions.get('window');

// Blueberry Luxe Color System
const COLORS = {
    bgPrimary: '#0D0B1E',
    bgSecondary: '#160B32',
    gradientStart: '#1A0533',
    gradientEnd: '#0D1B4B',
    purple: '#7B5CF0',
    purpleDark: '#5B3FD0',
    purpleLight: '#9B7CF0',
    cyan: '#00E5FF',
    cyanDark: '#0099BB',
    white: '#FFFFFF',
    textSecondary: 'rgba(255,255,255,0.6)',
    textMuted: 'rgba(255,255,255,0.5)',
    glassBg: 'rgba(255,255,255,0.06)',
    glassBorder: 'rgba(123,92,240,0.3)',
    success: '#00FF94',
    warning: '#F59E0B',
};

interface RideData {
    id: string;
    created_at: string;
    total_fare_cents: number;
    wait_fare_cents?: number;
    distance_meters: number;
    duration_seconds: number;
    pickup_address: string;
    dropoff_address: string;
    wallet_deduction_cents?: number;
    cash_payment_cents?: number;
}

export function ReceiptScreen({ navigation, route }: any) {
    const { ride: initialRide, rideId } = route.params;
    const insets = useSafeAreaInsets();
    const [ride, setRide] = useState<RideData | null>(initialRide || null);
    const [loading, setLoading] = useState(!initialRide);
    const [error, setError] = useState<string | null>(null);

    // Fetch ride data if only rideId provided (from restoration handler)
    useEffect(() => {
        if (initialRide) return;

        const fetchRideData = async () => {
            try {
                const { data, error: fetchError } = await supabase
                    .from('rides')
                    .select('id, created_at, total_fare_cents, wait_fare_cents, distance_meters, duration_seconds, pickup_address, dropoff_address, wallet_deduction_cents, cash_payment_cents')
                    .eq('id', rideId)
                    .single();

                if (fetchError || !data) {
                    console.error('Failed to fetch ride data:', fetchError);
                    setError('Unable to load ride details');
                    setLoading(false);
                    return;
                }

                setRide(data);
                setLoading(false);
            } catch (err) {
                console.error('Error fetching ride:', err);
                setError('Unable to load ride details');
                setLoading(false);
            }
        };

        fetchRideData();
    }, [rideId, initialRide]);

    const handleDone = () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
    };

    // Loading state
    if (loading) {
        return (
            <View style={[s.root, { justifyContent: 'center', alignItems: 'center' }]}>
                <StatusBar style="light" />
                <LinearGradient
                    colors={[COLORS.gradientStart, COLORS.gradientEnd]}
                    style={StyleSheet.absoluteFillObject}
                />
                <ActivityIndicator size="large" color={COLORS.cyan} />
                <Text style={{ marginTop: 16, color: COLORS.textMuted, fontSize: 15 }}>Loading receipt...</Text>
            </View>
        );
    }

    // Error state
    if (error || !ride) {
        return (
            <View style={[s.root, { justifyContent: 'center', alignItems: 'center', padding: 40 }]}>
                <StatusBar style="light" />
                <LinearGradient
                    colors={[COLORS.gradientStart, COLORS.gradientEnd]}
                    style={StyleSheet.absoluteFillObject}
                />
                <View style={s.errorIcon}>
                    <Ionicons name="receipt-outline" size={48} color={COLORS.textMuted} />
                </View>
                <Text style={{ marginTop: 20, textAlign: 'center', color: COLORS.textMuted, fontSize: 15 }}>
                    {error || 'Receipt not found'}
                </Text>
                <TouchableOpacity style={[s.doneBtnFull, { marginTop: 32 }]} onPress={handleDone}>
                    <Text style={s.doneBtnText}>BACK TO HOME</Text>
                </TouchableOpacity>
            </View>
        );
    }

    const date = new Date(ride.created_at);
    const dateStr = date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    const timeStr = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

    const totalFare = ((ride.total_fare_cents || 0) / 100).toFixed(2);
    const distanceKm = ride.distance_meters ? (ride.distance_meters / 1000).toFixed(1) : '—';
    const durationMin = ride.duration_seconds ? Math.round(ride.duration_seconds / 60) : '—';

    return (
        <View style={s.root}>
            <StatusBar style="light" />
            
            {/* Deep Gradient Background */}
            <LinearGradient
                colors={[COLORS.gradientStart, COLORS.gradientEnd]}
                style={StyleSheet.absoluteFillObject}
            />

            <ScrollView contentContainerStyle={[s.scroll, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 40 }]}>

                {/* Header: Logo */}
                <View style={s.header}>
                    <Image 
                        source={require('../../assets/logo.png')} 
                        style={s.headerLogo}
                        resizeMode="contain"
                    />
                </View>

                {/* Central Card with Dashed Divider */}
                <View style={s.receiptWrapper}>
                    <BlurView intensity={20} tint="dark" style={s.cardBlur}>
                        <View style={s.cardInner}>

                            {/* Success Header */}
                            <View style={s.statusHeader}>
                                <View style={s.checkCircle}>
                                    <Ionicons name="checkmark" size={32} color={COLORS.white} />
                                </View>
                                <Text style={s.paidText}>PAID SUCCESS</Text>
                                <Text style={s.dateText}>{dateStr} · {timeStr}</Text>
                            </View>

                            <View style={s.dashDivider} />

                            {/* Stats Row */}
                            <View style={s.statsRow}>
                                <View style={s.stat}>
                                    <Text style={s.statValue}>{distanceKm}</Text>
                                    <Text style={s.statLabel}>KILOMETERS</Text>
                                </View>
                                <View style={s.statVerticalLine} />
                                <View style={s.stat}>
                                    <Text style={s.statValue}>{durationMin}</Text>
                                    <Text style={s.statLabel}>MINUTES</Text>
                                </View>
                            </View>

                            <View style={s.dashDivider} />

                            {/* Fare Breakdown */}
                            <View style={s.breakdown}>
                                <View style={s.row}>
                                    <Text style={s.rowLabel}>Base Fare</Text>
                                    <Text style={s.rowValue}>${totalFare}</Text>
                                </View>
                                
                                {(ride.wait_fare_cents ?? 0) > 0 && (
                                    <View style={s.row}>
                                        <Text style={s.rowLabelWarning}>Wait Time Surcharge</Text>
                                        <Text style={s.rowValueWarning}>+${((ride.wait_fare_cents ?? 0) / 100).toFixed(2)}</Text>
                                    </View>
                                )}
                                
                                {/* Split Payment Breakdown */}
                                {(ride.wallet_deduction_cents ?? 0) > 0 && (
                                    <View style={s.splitItem}>
                                        <View style={s.row}>
                                            <Text style={s.splitLabel}>Wallet Deduction</Text>
                                            <Text style={s.splitValue}>-${((ride.wallet_deduction_cents ?? 0) / 100).toFixed(2)}</Text>
                                        </View>
                                    </View>
                                )}
                                {(ride.cash_payment_cents ?? 0) > 0 && (
                                    <View style={s.splitItem}>
                                        <View style={s.row}>
                                            <Text style={s.splitLabelWarning}>Cash Paid</Text>
                                            <Text style={s.splitValueWarning}>${((ride.cash_payment_cents ?? 0) / 100).toFixed(2)}</Text>
                                        </View>
                                    </View>
                                )}

                                <View style={s.row}>
                                    <Text style={s.rowLabel}>Tip</Text>
                                    <Text style={s.rowValue}>$0.00</Text>
                                </View>
                                <View style={s.totalRow}>
                                    <Text style={s.totalLabel}>Total</Text>
                                    <Text style={s.totalValue}>${(( (ride.total_fare_cents || 0) + (ride.wait_fare_cents || 0) ) / 100).toFixed(2)}</Text>
                                </View>
                            </View>

                            <View style={s.dashDivider} />

                            {/* Address Summary */}
                            <View style={s.addresses}>
                                <View style={s.addrRow}>
                                    <View style={[s.marker, { backgroundColor: COLORS.purple }]} />
                                    <Text style={s.addrText} numberOfLines={1}>{ride.pickup_address}</Text>
                                </View>
                                <View style={s.addrRow}>
                                    <View style={[s.marker, { backgroundColor: COLORS.cyan }]} />
                                    <Text style={s.addrText} numberOfLines={1}>{ride.dropoff_address}</Text>
                                </View>
                            </View>

                            <View style={s.footer}>
                                <Text style={s.footerText}>Thanks for riding with G-Taxi</Text>
                            </View>

                        </View>
                    </BlurView>
                </View>

                {/* Done Button */}
                <TouchableOpacity style={s.doneBtnFull} onPress={handleDone}>
                    <LinearGradient
                        colors={[COLORS.purple, COLORS.purpleDark]}
                        style={s.doneBtnGradient}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                    >
                        <Text style={s.doneBtnText}>BACK TO HOME</Text>
                    </LinearGradient>
                </TouchableOpacity>

            </ScrollView>
        </View>
    );
}

const s = StyleSheet.create({
    // Root & Layout
    root: { flex: 1, backgroundColor: COLORS.bgPrimary },
    scroll: { flexGrow: 1, paddingHorizontal: 24 },

    // Header with Logo
    header: { 
        alignItems: 'center', 
        marginBottom: 24,
        marginTop: 8,
    },
    headerLogo: {
        width: 60,
        height: 60,
    },

    // Error State
    errorIcon: {
        width: 80,
        height: 80,
        borderRadius: 40,
        backgroundColor: COLORS.glassBg,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: COLORS.glassBorder,
    },

    // Receipt Card
    receiptWrapper: { 
        flex: 1, 
        justifyContent: 'center',
    },
    cardBlur: {
        borderRadius: 32,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: COLORS.glassBorder,
    },
    cardInner: { 
        backgroundColor: 'rgba(22,11,50,0.6)', 
        padding: 28,
    },

    // Success Header
    statusHeader: { 
        alignItems: 'center', 
        marginBottom: 32,
    },
    checkCircle: { 
        width: 72, 
        height: 72, 
        borderRadius: 36, 
        backgroundColor: COLORS.cyan,
        alignItems: 'center', 
        justifyContent: 'center', 
        shadowColor: COLORS.cyan,
        shadowOffset: { width: 0, height: 0 },
        shadowRadius: 20, 
        shadowOpacity: 0.5,
        elevation: 8,
    },
    paidText: {
        fontSize: 18,
        fontWeight: '800',
        color: COLORS.cyan,
        marginTop: 20,
        letterSpacing: 3,
    },
    dateText: {
        fontSize: 14,
        fontWeight: '500',
        color: COLORS.textMuted,
        marginTop: 8,
    },

    // Dash Divider
    dashDivider: { 
        height: 1, 
        width: '100%', 
        borderStyle: 'dashed', 
        borderWidth: 1, 
        borderColor: 'rgba(123,92,240,0.2)', 
        marginVertical: 24,
    },

    // Stats Row
    statsRow: { 
        flexDirection: 'row', 
        justifyContent: 'space-around', 
        alignItems: 'center',
        paddingVertical: 8,
    },
    stat: { 
        alignItems: 'center',
        flex: 1,
    },
    statValue: {
        fontSize: 28,
        fontWeight: '800',
        color: COLORS.white,
        letterSpacing: -0.5,
    },
    statLabel: {
        fontSize: 11,
        fontWeight: '700',
        color: COLORS.textMuted,
        letterSpacing: 1,
        marginTop: 4,
    },
    statVerticalLine: { 
        width: 1, 
        height: 40, 
        backgroundColor: 'rgba(255,255,255,0.1)',
    },

    // Breakdown
    breakdown: { 
        gap: 14,
    },
    row: { 
        flexDirection: 'row', 
        justifyContent: 'space-between', 
        alignItems: 'center',
    },
    rowLabel: {
        fontSize: 15,
        fontWeight: '500',
        color: COLORS.textMuted,
    },
    rowValue: {
        fontSize: 16,
        fontWeight: '700',
        color: COLORS.white,
    },
    rowLabelWarning: {
        fontSize: 15,
        fontWeight: '500',
        color: COLORS.warning,
    },
    rowValueWarning: {
        fontSize: 16,
        fontWeight: '700',
        color: COLORS.warning,
    },
    splitItem: { 
        backgroundColor: 'rgba(255,255,255,0.03)', 
        padding: 12, 
        borderRadius: 12, 
        borderWidth: 1, 
        borderColor: 'rgba(255,255,255,0.05)',
    },
    splitLabel: {
        fontSize: 13,
        fontWeight: '500',
        color: COLORS.cyan,
    },
    splitValue: {
        fontSize: 13,
        fontWeight: '700',
        color: COLORS.cyan,
    },
    splitLabelWarning: {
        fontSize: 13,
        fontWeight: '500',
        color: COLORS.warning,
    },
    splitValueWarning: {
        fontSize: 13,
        fontWeight: '700',
        color: COLORS.warning,
    },
    totalRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginTop: 12,
        paddingTop: 16,
        borderTopWidth: 1,
        borderTopColor: 'rgba(255,255,255,0.1)',
    },
    totalLabel: {
        fontSize: 18,
        fontWeight: '800',
        color: COLORS.white,
    },
    totalValue: {
        fontSize: 22,
        fontWeight: '800',
        color: COLORS.warning,
        letterSpacing: 0.5,
    },

    // Addresses
    addresses: { 
        gap: 14,
    },
    addrRow: { 
        flexDirection: 'row', 
        alignItems: 'center',
    },
    marker: { 
        width: 10, 
        height: 10, 
        borderRadius: 5,
    },
    addrText: {
        fontSize: 13,
        fontWeight: '500',
        color: COLORS.textMuted,
        flex: 1,
        marginLeft: 12,
    },

    // Footer
    footer: { 
        marginTop: 28,
        paddingTop: 20,
        borderTopWidth: 1,
        borderTopColor: 'rgba(255,255,255,0.05)',
    },
    footerText: {
        fontSize: 13,
        fontWeight: '500',
        color: COLORS.textMuted,
        textAlign: 'center',
        letterSpacing: 0.5,
    },

    // Done Button
    doneBtn: { 
        alignSelf: 'center', 
        marginTop: 32,
    },
    doneBtnFull: {
        marginTop: 32,
        borderRadius: 18,
        overflow: 'hidden',
        shadowColor: COLORS.purple,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 6,
    },
    doneBtnGradient: {
        paddingVertical: 18,
        paddingHorizontal: 48,
        alignItems: 'center',
    },
    doneBtnText: {
        fontSize: 16,
        fontWeight: '800',
        color: COLORS.white,
        letterSpacing: 1,
    },
});
