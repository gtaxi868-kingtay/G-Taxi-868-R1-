import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import type { AppScreenProps } from '../navigation/types';

function fmtPrice(cents: number) {
    return `TTD $${(cents / 100).toLocaleString('en-TT', { minimumFractionDigits: 0 })}`;
}
function fmtDate(iso: string) {
    return new Date(iso).toLocaleDateString('en-TT', { weekday: 'long', day: 'numeric', month: 'long' });
}
function daysUntil(iso: string) {
    const diff = new Date(iso).getTime() - Date.now();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

export function TravelBookingConfirmationScreen({ route, navigation }: AppScreenProps<'TravelBookingConfirmation'>) {
    const { bookingId, packageTitle, totalCents, travelerCount, departureAt, airportTransferRideId } = route.params;
    const insets = useSafeAreaInsets();
    const scale = useRef(new Animated.Value(0.7)).current;
    const opacity = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Animated.parallel([
            Animated.spring(scale, { toValue: 1, useNativeDriver: true, tension: 60, friction: 8 }),
            Animated.timing(opacity, { toValue: 1, duration: 300, useNativeDriver: true }),
        ]).start();
    }, []);

    const days = daysUntil(departureAt);

    return (
        <View style={[styles.root, { paddingTop: insets.top }]}>
            <StatusBar style="light" />

            <LinearGradient
                colors={['rgba(52,230,236,0.15)', 'transparent']}
                style={StyleSheet.absoluteFill}
                pointerEvents="none"
            />

            <Animated.View style={[styles.content, { opacity, transform: [{ scale }] }]}>
                {/* Check icon */}
                <View style={styles.checkCircle}>
                    <Ionicons name="checkmark" size={48} color="#EAF3F6" />
                </View>

                <Text style={styles.title}>You're going to</Text>
                <Text style={styles.packageTitle}>{packageTitle}</Text>

                {/* Countdown */}
                <View style={styles.countdownCard}>
                    <Text style={styles.countdownNum}>{days}</Text>
                    <Text style={styles.countdownLabel}>days to departure</Text>
                    <Text style={styles.countdownDate}>{fmtDate(departureAt)}</Text>
                </View>

                {/* Summary */}
                <View style={styles.summaryCard}>
                    <SummaryRow icon="receipt-outline" label="Booking ref" value={bookingId.slice(0, 8).toUpperCase()} />
                    <SummaryRow icon="people-outline" label="Travelers" value={`${travelerCount} person${travelerCount > 1 ? 's' : ''}`} />
                    <SummaryRow icon="wallet-outline" label="Total paid" value={fmtPrice(totalCents)} />
                    {airportTransferRideId && (
                        <SummaryRow icon="car-outline" label="Airport transfer" value="Pre-booked" highlight />
                    )}
                </View>

                {airportTransferRideId && (
                    <View style={styles.transferNote}>
                        <Ionicons name="information-circle-outline" size={16} color="#34E6EC" />
                        <Text style={styles.transferNoteText}>
                            Your G-Taxi to Piarco Airport is scheduled. You'll be able to update the pickup address from My Bookings.
                        </Text>
                    </View>
                )}
            </Animated.View>

            {/* Actions */}
            <View style={[styles.actions, { paddingBottom: insets.bottom + 16 }]}>
                <TouchableOpacity
                    style={styles.myBookingsBtn}
                    onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                        navigation.replace('TravelMyBookings');
                    }}
                >
                    <Text style={styles.myBookingsBtnText}>View My Bookings</Text>
                </TouchableOpacity>
                <TouchableOpacity
                    style={styles.homeBtn}
                    onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        navigation.navigate('Home', {});
                    }}
                >
                    <Text style={styles.homeBtnText}>Back to Home</Text>
                </TouchableOpacity>
            </View>
        </View>
    );
}

function SummaryRow({ icon, label, value, highlight }: { icon: string; label: string; value: string; highlight?: boolean }) {
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 20, gap: 12 }}>
            <Ionicons name={icon as any} size={18} color={highlight ? '#22C55E' : 'rgba(255,255,255,0.4)'} />
            <Text style={{ color: 'rgba(255,255,255,0.4)', flex: 1, fontSize: 14 }}>{label}</Text>
            <Text style={{ color: highlight ? '#22C55E' : '#EAF3F6', fontWeight: '700', fontSize: 14 }}>{value}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: '#07070F' },
    content: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
    checkCircle: { width: 88, height: 88, borderRadius: 44, backgroundColor: '#22C55E', alignItems: 'center', justifyContent: 'center', marginBottom: 24, shadowColor: '#22C55E', shadowOpacity: 0.4, shadowRadius: 24, shadowOffset: { width: 0, height: 8 } },
    title: { color: 'rgba(255,255,255,0.5)', fontSize: 16, marginBottom: 4 },
    packageTitle: { color: '#EAF3F6', fontWeight: '800', fontSize: 24, textAlign: 'center', marginBottom: 28 },
    countdownCard: { alignItems: 'center', backgroundColor: 'rgba(52,230,236,0.1)', borderRadius: 24, paddingVertical: 20, paddingHorizontal: 40, borderWidth: 1, borderColor: 'rgba(52,230,236,0.2)', marginBottom: 24, width: '100%' },
    countdownNum: { color: '#34E6EC', fontWeight: '900', fontSize: 48 },
    countdownLabel: { color: 'rgba(255,255,255,0.4)', fontSize: 14, marginTop: -4 },
    countdownDate: { color: '#EAF3F6', fontWeight: '600', fontSize: 14, marginTop: 6 },
    summaryCard: { backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', width: '100%', overflow: 'hidden', marginBottom: 16 },
    transferNote: { flexDirection: 'row', gap: 8, backgroundColor: 'rgba(52,230,236,0.08)', borderRadius: 16, padding: 14, borderWidth: 1, borderColor: 'rgba(52,230,236,0.15)' },
    transferNoteText: { color: 'rgba(255,255,255,0.5)', fontSize: 12, flex: 1, lineHeight: 18 },
    actions: { paddingHorizontal: 24, gap: 10 },
    myBookingsBtn: { backgroundColor: '#6D28D9', borderRadius: 20, alignItems: 'center', paddingVertical: 16 },
    myBookingsBtnText: { color: '#EAF3F6', fontWeight: '700', fontSize: 16 },
    homeBtn: { backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 20, alignItems: 'center', paddingVertical: 16 },
    homeBtnText: { color: 'rgba(255,255,255,0.5)', fontWeight: '600', fontSize: 15 },
});
