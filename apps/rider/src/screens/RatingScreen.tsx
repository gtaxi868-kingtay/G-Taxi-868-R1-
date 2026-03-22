import React, { useState, useEffect } from 'react';
import {
    View, StyleSheet, TouchableOpacity, TextInput,
    ScrollView, Dimensions, ActivityIndicator
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../../shared/supabase';
import { processTip, formatCurrency } from '../services/api';
import { Txt } from '../design-system/primitives';

const { width } = Dimensions.get('window');

// ── Rider Design Tokens ──────────────────────────────────────────────────────
const R = {
    bg: '#07050F',
    surface: '#110E22',
    border: 'rgba(255,255,255,0.08)',
    purple: '#7C3AED',
    purpleLight: '#A78BFA',
    gold: '#F59E0B',
    white: '#FFFFFF',
    muted: 'rgba(255,255,255,0.4)',
};

export function RatingScreen({ navigation, route }: any) {
    const { driver, fare, rideId, paymentMethod } = route.params;
    const insets = useSafeAreaInsets();

    const [rating, setRating] = useState(5);
    const [comment, setComment] = useState('');
    const [selectedTip, setSelectedTip] = useState(0);
    const [submitting, setSubmitting] = useState(false);

    const handleSubmit = async () => {
        if (submitting) return;
        setSubmitting(true);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

        try {
            const { data: { user } } = await supabase.auth.getUser();

            // WIRING_RULE: Save to ratings table AND update rides
            const ratingPromise = supabase.from('ratings').insert({
                ride_id: rideId,
                driver_id: driver.id,
                rider_id: user?.id,
                rating,
                comment,
            });

            const rideUpdatePromise = supabase.from('rides')
                .update({ rating })
                .eq('id', rideId);

            const tipPromise = selectedTip > 0 ? processTip(rideId, selectedTip * 100) : Promise.resolve({ success: true });

            await Promise.all([ratingPromise, rideUpdatePromise, tipPromise]);

            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
        } catch (err) {
            console.error(err);
        } finally {
            setSubmitting(false);
        }
    };

    const handleViewReceipt = async () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        // Fetch the real ride record so the receipt shows live addresses + distances
        const { data: rideData } = await supabase
            .from('rides')
            .select('pickup_address, dropoff_address, distance_meters, duration_seconds, created_at')
            .eq('id', rideId)
            .single();
        navigation.navigate('Receipt', {
            ride: {
                id: rideId,
                created_at: rideData?.created_at || new Date().toISOString(),
                pickup_address: rideData?.pickup_address || 'Pickup',
                dropoff_address: rideData?.dropoff_address || 'Dropoff',
                distance_meters: rideData?.distance_meters || 0,
                duration_seconds: rideData?.duration_seconds || 0,
                total_fare_cents: fare.total_fare_cents,
                payment_method: paymentMethod || 'cash',
                driver_name: driver.name,
                vehicle_model: driver.vehicle_model || driver.vehicle,
                plate_number: driver.plate_number || driver.plate,
            }
        });
    };

    return (
        <View style={s.root}>
            <StatusBar style="light" />

            <ScrollView contentContainerStyle={[s.scroll, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 40 }]}>

                {/* Hero: Driver name + "Rate your ride" */}
                <View style={s.hero}>
                    <View style={s.avatar}>
                        <Txt variant="headingM" color="#FFF">{driver?.name?.charAt(0)}</Txt>
                    </View>
                    <Txt variant="headingM" weight="heavy" color="#FFF" style={{ marginTop: 20 }}>{driver?.name}</Txt>
                    <Txt variant="bodyReg" color={R.muted} style={{ marginTop: 4 }}>How was your ride?</Txt>
                </View>

                {/* Star Rating: 5 stars (Gold when active) */}
                <View style={s.starsRow}>
                    {[1, 2, 3, 4, 5].map(sVal => (
                        <TouchableOpacity
                            key={sVal}
                            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setRating(sVal); }}
                        >
                            <Ionicons
                                name={sVal <= rating ? "star" : "star-outline"}
                                size={44}
                                color={sVal <= rating ? R.gold : R.muted}
                                style={s.star}
                            />
                        </TouchableOpacity>
                    ))}
                </View>

                {/* Input: Multiline TextInput, dark surface */}
                <View style={s.inputBox}>
                    <TextInput
                        style={s.textInput}
                        placeholder="Tell us more about your experience (optional)"
                        placeholderTextColor={R.muted}
                        multiline
                        numberOfLines={4}
                        value={comment}
                        onChangeText={setComment}
                    />
                </View>

                {/* Tip Selector */}
                <View style={s.tipSection}>
                    <Txt variant="bodyBold" color="#FFF" style={{ marginBottom: 16 }}>Add a Tip</Txt>
                    <View style={s.tipRow}>
                        {[1, 3, 5].map(amt => (
                            <TouchableOpacity
                                key={amt}
                                style={[s.tipBtn, selectedTip === amt && s.tipBtnActive]}
                                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setSelectedTip(selectedTip === amt ? 0 : amt); }}
                            >
                                <Txt variant="bodyBold" color={selectedTip === amt ? "#FFF" : R.white}>${amt}</Txt>
                            </TouchableOpacity>
                        ))}
                    </View>
                </View>

                <View style={{ flex: 1 }} />

                {/* Submit button: Large purple gradient button */}
                <TouchableOpacity style={s.submitBtn} onPress={handleSubmit} disabled={submitting}>
                    <LinearGradient colors={[R.purple, '#4C1D95']} style={s.btnGradient}>
                        {submitting ? <ActivityIndicator color="#FFF" /> : (
                            <Txt variant="headingM" weight="bold" color="#FFF">Submit Review</Txt>
                        )}
                    </LinearGradient>
                </TouchableOpacity>

                <TouchableOpacity style={s.receiptBtn} onPress={handleViewReceipt}>
                    <Txt variant="bodyBold" color={R.muted}>View Receipt</Txt>
                </TouchableOpacity>

            </ScrollView>
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: R.bg },
    scroll: { flexGrow: 1, paddingHorizontal: 24 },

    hero: { alignItems: 'center', marginBottom: 40 },
    avatar: { width: 80, height: 80, borderRadius: 40, backgroundColor: R.purple, alignItems: 'center', justifyContent: 'center', shadowColor: R.purple, shadowRadius: 20, shadowOpacity: 0.4 },

    starsRow: { flexDirection: 'row', justifyContent: 'center', gap: 12, marginBottom: 40 },
    star: { shadowColor: R.gold, shadowRadius: 10, shadowOpacity: 0.3 },

    inputBox: { height: 120, backgroundColor: R.surface, borderRadius: 20, padding: 16, marginBottom: 32, borderWidth: 1, borderColor: R.border },
    textInput: { flex: 1, color: '#FFF', fontSize: 16, textAlignVertical: 'top' },

    tipSection: { marginBottom: 40 },
    tipRow: { flexDirection: 'row', gap: 12 },
    tipBtn: { flex: 1, height: 50, borderRadius: 25, backgroundColor: R.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: R.border },
    tipBtnActive: { backgroundColor: R.purple, borderColor: R.purpleLight },

    submitBtn: { height: 64, borderRadius: 32, overflow: 'hidden', marginTop: 20 },
    btnGradient: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    receiptBtn: { alignSelf: 'center', marginTop: 20, padding: 10 },
});
