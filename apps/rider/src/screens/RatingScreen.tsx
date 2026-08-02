import React, { useState, useEffect } from 'react';
import {
    View, StyleSheet, TouchableOpacity, TextInput,
    ScrollView, useWindowDimensions, ActivityIndicator, Alert,
    KeyboardAvoidingView, Platform
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@gtaxi/core';
import { processTip, formatCurrency } from '../services/api';
import { Txt } from '@/design-system/primitives';
import { ghostBorder, elevationGlow } from '@gtaxi/design-system/utils/style-rules';
import { SURFACE, VOICES } from '@gtaxi/design-system';

const CYAN = '#06B6D4';

const R = {
    bg: SURFACE.base,
    surface: 'rgba(255,255,255,0.08)',
    border: 'rgba(191,64,255,0.2)',
    purple: VOICES.rider.accent,
    purpleLight: CYAN,
    gold: '#F59E0B',
    white: '#EAF3F6',
    muted: '#AEA9B5',
};

export function RatingScreen({ navigation, route }: any) {
    const { width } = useWindowDimensions();
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
            // Pass only the id. ReceiptScreen loads the real row itself —
            // a receipt must show what the database actually recorded, not a
            // client-side reconstruction with placeholder addresses and no
            // payment_status.
            navigation.navigate('Receipt', { rideId });
        } catch (err) {
            console.error(err);
        } finally {
            setSubmitting(false);
        }
    };

    const handleViewReceipt = async () => {
        try {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            // Same rule as handleSubmit: hand over the id and let the receipt
            // read the authoritative row. This previously fetched a partial
            // row, then overrode total_fare_cents with the client's own `fare`
            // state and never read payment_status at all.
            navigation.navigate('Receipt', { rideId });
        } catch (err) {
            console.error("View Receipt failed:", err);
            Alert.alert("Error", "Could not load receipt details.");
        }
    };

    return (
        <View style={s.root}>
            <StatusBar style="light" />

            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                style={{ flex: 1 }}
            >
            <ScrollView contentContainerStyle={[s.scroll, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 40 }]}>
                <View style={s.hero}>
                    <View style={[s.avatar, { backgroundColor: VOICES.rider.accent }]}>
                        <Txt variant="headingM" color="#EAF3F6" weight="heavy">{driver?.name?.charAt(0)}</Txt>
                    </View>
                    <Txt variant="headingM" weight="heavy" color="#EAF3F6" style={{ marginTop: 24 }}>{driver?.name}</Txt>
                    <Txt variant="bodyReg" color={R.muted} style={{ marginTop: 8, letterSpacing: 1 }}>HOW WAS YOUR ENGAGEMENT?</Txt>
                </View>

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

                <View style={s.tipSection}>
                    <Txt variant="bodyBold" color="#EAF3F6" style={{ marginBottom: 16 }}>Add a Tip</Txt>
                    <View style={s.tipRow}>
                        {[1, 3, 5].map(amt => (
                            <TouchableOpacity
                                key={amt}
                                style={[s.tipBtn, selectedTip === amt && s.tipBtnActive]}
                                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setSelectedTip(selectedTip === amt ? 0 : amt); }}
                            >
                                <Txt variant="bodyBold" color={selectedTip === amt ? "#EAF3F6" : R.white}>${amt}</Txt>
                            </TouchableOpacity>
                        ))}
                    </View>
                </View>

                <View style={{ flex: 1 }} />

                <TouchableOpacity style={s.submitBtn} onPress={handleSubmit} disabled={submitting}>
                    <LinearGradient 
                        colors={[VOICES.rider.accent, CYAN]} 
                        start={{x: 0, y: 0}} 
                        end={{x: 1, y: 0}}
                        style={s.btnGradient}
                    >
                        {submitting ? <ActivityIndicator color="#EAF3F6" /> : (
                            <Txt variant="headingM" weight="heavy" color="#EAF3F6">COMPLETE ENGAGEMENT</Txt>
                        )}
                    </LinearGradient>
                </TouchableOpacity>

                <TouchableOpacity style={s.receiptBtn} onPress={handleViewReceipt}>
                    <Txt variant="bodyBold" color={R.muted}>View Receipt</Txt>
                </TouchableOpacity>

            </ScrollView>
            </KeyboardAvoidingView>
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: R.bg },
    scroll: { flexGrow: 1, paddingHorizontal: 20 },

    hero: { alignItems: 'center', marginBottom: 40 },
    avatar: { width: 96, height: 96, borderRadius: 32, alignItems: 'center', justifyContent: 'center', ...elevationGlow() },

    starsRow: { flexDirection: 'row', justifyContent: 'center', gap: 16, marginBottom: 48 },
    star: { shadowColor: R.gold, shadowRadius: 15, shadowOpacity: 0.4 },

    inputBox: { height: 140, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 32, padding: 20, marginBottom: 32, ...ghostBorder(0.05) },
    textInput: { flex: 1, color: '#EAF3F6', fontSize: 16, textAlignVertical: 'top' },

    tipSection: { marginBottom: 48 },
    tipRow: { flexDirection: 'row', gap: 12 },
    tipBtn: { flex: 1, height: 56, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.03)', alignItems: 'center', justifyContent: 'center', ...ghostBorder(0.05) },
    tipBtnActive: { backgroundColor: VOICES.rider.accent, borderColor: CYAN },

    submitBtn: { height: 64, borderRadius: 24, overflow: 'hidden', marginTop: 20 },
    btnGradient: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    receiptBtn: { alignSelf: 'center', marginTop: 32, padding: 20 },
});
