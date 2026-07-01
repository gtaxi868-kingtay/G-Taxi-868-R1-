import React, { useEffect, useState } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity, ScrollView,
    useWindowDimensions, Platform, ActivityIndicator, Image
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@gtaxi/core';
import { SURFACE, VOICES, ANIMATION } from '@gtaxi/design-system';
import { ghostBorder, elevationGlow, glassSurface } from '@gtaxi/design-system/utils/style-rules';
import { AppScreenProps } from '../navigation/types';

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

export function ReceiptScreen({ navigation, route }: AppScreenProps<'Receipt'>) {
    const { width, height } = useWindowDimensions();
    const { ride: initialRide, rideId } = route.params;
    const insets = useSafeAreaInsets();
    const [ride, setRide] = useState<RideData | null>(initialRide || null);
    const [loading, setLoading] = useState(!initialRide);
    const [error, setError] = useState<string | null>(null);

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

    if (loading) {
        return (
            <View style={[s.root, { justifyContent: 'center', alignItems: 'center' }]}>
                <StatusBar style="light" />
                <LinearGradient
                    colors={['#1A0533', '#0D1B4B']}
                    style={StyleSheet.absoluteFillObject}
                />
                <ActivityIndicator size="large" color="#00E5FF" />
                <Text style={{ marginTop: 16, color: 'rgba(255,255,255,0.6)', fontSize: 15 }}>Loading receipt...</Text>
            </View>
        );
    }

    if (error || !ride) {
        return (
            <View style={[s.root, { justifyContent: 'center', alignItems: 'center', padding: 40 }]}>
                <StatusBar style="light" />
                <LinearGradient
                    colors={['#1A0533', '#0D1B4B']}
                    style={StyleSheet.absoluteFillObject}
                />
                <View style={s.errorIcon}>
                    <Ionicons name="receipt-outline" size={48} color="rgba(255,255,255,0.6)" />
                </View>
                <Text style={{ marginTop: 20, textAlign: 'center', color: 'rgba(255,255,255,0.6)', fontSize: 15 }}>
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
            
            <LinearGradient
                colors={['#1A0533', '#0D1B4B']}
                style={StyleSheet.absoluteFillObject}
            />

            <ScrollView contentContainerStyle={[s.scroll, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 40 }]}>

                <View style={s.header}>
                    <Image 
                        source={require('../../assets/logo.png')} 
                        style={s.headerLogo}
                        resizeMode="contain"
                    />
                </View>

                <View style={s.receiptWrapper}>
                    <View style={[glassSurface(20), s.cardBlur]}>
                        <View style={s.cardInner}>

                            <View style={s.statusHeader}>
                                <View style={s.checkCircle}>
                                    <Ionicons name="checkmark" size={32} color="#EAF3F6" />
                                </View>
                                <Text style={s.paidText}>PAID SUCCESS</Text>
                                <Text style={s.dateText}>{dateStr} · {timeStr}</Text>
                            </View>

                            <View style={s.dashDivider} />

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

                            <View style={s.addresses}>
                                <View style={s.addrRow}>
                                    <View style={[s.marker, { backgroundColor: VOICES.rider.accent }]} />
                                    <Text style={s.addrText} numberOfLines={1}>{ride.pickup_address}</Text>
                                </View>
                                <View style={s.addrRow}>
                                    <View style={[s.marker, { backgroundColor: '#00E5FF' }]} />
                                    <Text style={s.addrText} numberOfLines={1}>{ride.dropoff_address}</Text>
                                </View>
                            </View>

                            <View style={s.footer}>
                                <Text style={s.footerText}>Thanks for riding with G-Taxi</Text>
                            </View>

                        </View>
                    </View>
                </View>

                <TouchableOpacity style={s.doneBtnFull} onPress={handleDone}>
                    <LinearGradient
                        colors={[VOICES.rider.accent, VOICES.rider.accentDark]}
                        style={s.doneBtnGradient}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                    >
                        <Text style={s.doneBtnText}>BACK TO HOME</Text>
                    </LinearGradient>
                </TouchableOpacity>

                <TouchableOpacity
                    style={s.reportBtn}
                    onPress={() => navigation.navigate('ReportProblem', { ride })}
                >
                    <Text style={s.reportBtnText}>Report a problem with this trip</Text>
                </TouchableOpacity>

            </ScrollView>
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: SURFACE.base },
    scroll: { flexGrow: 1, paddingHorizontal: 24 },

    header: { 
        alignItems: 'center', 
        marginBottom: 24,
        marginTop: 8,
    },
    headerLogo: {
        width: 60,
        height: 60,
    },

    errorIcon: {
        width: 80,
        height: 80,
        borderRadius: 40,
        backgroundColor: 'rgba(255,255,255,0.03)',
        alignItems: 'center',
        justifyContent: 'center',
        ...ghostBorder(),
    },

    receiptWrapper: { 
        flex: 1, 
        justifyContent: 'center',
    },
    cardBlur: {
        borderRadius: 32,
        ...ghostBorder(),
    },
    cardInner: { 
        backgroundColor: 'rgba(22,11,50,0.6)', 
        padding: 28,
    },

    statusHeader: { 
        alignItems: 'center', 
        marginBottom: 32,
    },
    checkCircle: { 
        width: 72, 
        height: 72, 
        borderRadius: 36, 
        backgroundColor: '#00E5FF',
        alignItems: 'center', 
        justifyContent: 'center', 
        ...elevationGlow(8),
    },
    paidText: {
        fontSize: 18,
        fontWeight: '800',
        color: '#00E5FF',
        marginTop: 20,
        letterSpacing: 3,
    },
    dateText: {
        fontSize: 14,
        fontWeight: '500',
        color: 'rgba(255,255,255,0.6)',
        marginTop: 8,
    },

    dashDivider: { 
        height: 1, 
        width: '100%', 
        borderStyle: 'dashed', 
        ...ghostBorder(0.2),
        marginVertical: 24,
    },

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
        color: '#EAF3F6',
        letterSpacing: -0.5,
    },
    statLabel: {
        fontSize: 11,
        fontWeight: '700',
        color: 'rgba(255,255,255,0.6)',
        letterSpacing: 1,
        marginTop: 4,
    },
    statVerticalLine: { 
        width: 1, 
        height: 40, 
        backgroundColor: 'rgba(255,255,255,0.1)',
    },

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
        color: 'rgba(255,255,255,0.6)',
    },
    rowValue: {
        fontSize: 16,
        fontWeight: '700',
        color: '#EAF3F6',
    },
    rowLabelWarning: {
        fontSize: 15,
        fontWeight: '500',
        color: '#F59E0B',
    },
    rowValueWarning: {
        fontSize: 16,
        fontWeight: '700',
        color: '#F59E0B',
    },
    splitItem: { 
        backgroundColor: 'rgba(255,255,255,0.03)', 
        padding: 12, 
        borderRadius: 12, 
        ...ghostBorder(),
    },
    splitLabel: {
        fontSize: 13,
        fontWeight: '500',
        color: '#00E5FF',
    },
    splitValue: {
        fontSize: 13,
        fontWeight: '700',
        color: '#00E5FF',
    },
    splitLabelWarning: {
        fontSize: 13,
        fontWeight: '500',
        color: '#F59E0B',
    },
    splitValueWarning: {
        fontSize: 13,
        fontWeight: '700',
        color: '#F59E0B',
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
        color: '#EAF3F6',
    },
    totalValue: {
        fontSize: 22,
        fontWeight: '800',
        color: '#F59E0B',
        letterSpacing: 0.5,
    },

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
        color: 'rgba(255,255,255,0.6)',
        flex: 1,
        marginLeft: 12,
    },

    footer: { 
        marginTop: 28,
        paddingTop: 20,
        borderTopWidth: 1,
        borderTopColor: 'rgba(255,255,255,0.05)',
    },
    footerText: {
        fontSize: 13,
        fontWeight: '500',
        color: 'rgba(255,255,255,0.6)',
        textAlign: 'center',
        letterSpacing: 0.5,
    },

    doneBtn: { 
        alignSelf: 'center', 
        marginTop: 32,
    },
    doneBtnFull: {
        marginTop: 32,
        borderRadius: 18,
        overflow: 'hidden',
        ...elevationGlow(6),
    },
    doneBtnGradient: {
        paddingVertical: 18,
        paddingHorizontal: 48,
        alignItems: 'center',
    },
    doneBtnText: {
        fontSize: 16,
        fontWeight: '800',
        color: '#EAF3F6',
        letterSpacing: 1,
    },
    reportBtn: {
        alignItems: 'center',
        paddingVertical: 18,
        marginBottom: 24,
    },
    reportBtnText: {
        fontSize: 13,
        fontWeight: '600',
        color: 'rgba(255,255,255,0.55)',
        textDecorationLine: 'underline',
    },
});
