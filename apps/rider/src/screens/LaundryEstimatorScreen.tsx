import React, { useState, useCallback } from 'react';
import {
    View, Text, TouchableOpacity, StyleSheet,
    Alert, Dimensions,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import Slider from '@react-native-community/slider';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { supabase } from '../../../../shared/supabase';
import { useAuth } from '../context/AuthContext';

interface ServiceType {
    id: string;
    label: string;
    icon: string;
    baseRate: number; // cents per lb
}

export function LaundryEstimatorScreen({ navigation, route }: any) {
    const { service } = route.params as { service: ServiceType };
    const insets = useSafeAreaInsets();
    const { user } = useAuth();

    const [weight, setWeight] = useState(5); // lbs
    const [loading, setLoading] = useState(false);

    const priceCents = Math.round(service.baseRate * weight);

    const handleSchedule = useCallback(async () => {
        if (!user?.id) { Alert.alert('Error', 'Please log in.'); return; }
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        setLoading(true);

        try {
            const { data: order, error } = await supabase
                .from('orders')
                .insert({
                    rider_id: user.id,
                    total_cents: priceCents,
                    status: 'pending',
                    delivery_method: 'laundry_pickup',
                    // Metadata stored in merchant note for now
                    merchant_id: null,
                })
                .select('id')
                .single();

            if (error) throw error;

            Alert.alert(
                '✅ Laundry Scheduled!',
                `${service.label} for ~${weight} lbs.\nTotal: $${(priceCents / 100).toFixed(2)} TTD\nOrder: ${order.id.slice(0, 8).toUpperCase()}`,
                [
                    {
                        text: 'Track Order',
                        onPress: () => navigation.navigate('LaundryOrderStatus', { orderId: order.id, service, weight, priceCents }),
                    },
                    { text: 'Done', onPress: () => navigation.navigate('Home') },
                ]
            );
        } catch (err: any) {
            Alert.alert('Booking Failed', err.message || 'Please try again.');
        } finally {
            setLoading(false);
        }
    }, [user, priceCents, service, weight, navigation]);

    return (
        <LinearGradient colors={['#0A0A1F', '#12122A']} style={s.container}>
            <View style={[s.header, { paddingTop: insets.top + 8 }]}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
                    <Ionicons name="arrow-back" size={22} color="#FFF" />
                </TouchableOpacity>
                <Text style={s.headerTitle}>{service.label}</Text>
                <View style={{ width: 38 }} />
            </View>

            <View style={s.content}>
                {/* Visual scale */}
                <View style={s.scaleBox}>
                    <BlurView intensity={25} style={StyleSheet.absoluteFillObject} tint="dark" />
                    <Text style={s.scaleEmoji}>⚖️</Text>
                    <Text style={s.weightDisplay}>{weight} lbs</Text>
                    <Text style={s.weightSub}>Estimated weight</Text>

                    {/* Slider */}
                    <View style={s.sliderContainer}>
                        {Slider && (
                            <Slider
                                style={s.slider}
                                minimumValue={1}
                                maximumValue={30}
                                step={1}
                                value={weight}
                                onValueChange={(val: any) => {
                                    setWeight(val as number);
                                    Haptics.selectionAsync();
                                }}
                                minimumTrackTintColor="#7B61FF"
                                maximumTrackTintColor="rgba(255,255,255,0.15)"
                                thumbTintColor="#00FFFF"
                            />
                        )}
                        <View style={s.sliderLabels}>
                            <Text style={s.sliderLabel}>1 lb</Text>
                            <Text style={s.sliderLabel}>30 lbs</Text>
                        </View>
                    </View>
                </View>

                {/* Price card */}
                <View style={s.priceCard}>
                    <BlurView intensity={25} style={StyleSheet.absoluteFillObject} tint="dark" />
                    <Text style={s.priceBreakdown}>
                        {weight} lbs  ×  ${(service.baseRate / 100).toFixed(2)}/lb
                    </Text>
                    <Text style={s.priceTotal}>${(priceCents / 100).toFixed(2)} TTD</Text>
                    <Text style={s.priceNote}>Including express handling</Text>
                </View>

                {/* Features */}
                <View style={s.features}>
                    {['Same-day pickup', 'Hypoallergenic detergent', 'Sealed & returned fresh'].map(f => (
                        <View key={f} style={s.featureRow}>
                            <Ionicons name="checkmark-circle" size={18} color="#4ADE80" />
                            <Text style={s.featureText}>{f}</Text>
                        </View>
                    ))}
                </View>
            </View>

            <View style={[s.ctaContainer, { paddingBottom: insets.bottom + 20 }]}>
                <TouchableOpacity style={s.ctaButton} onPress={handleSchedule} disabled={loading} activeOpacity={0.88}>
                    <LinearGradient
                        colors={['#7B61FF', '#5A2DDE']}
                        start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                        style={s.ctaGradient}
                    >
                        <Ionicons name="calendar-outline" size={22} color="#FFF" style={{ marginRight: 8 }} />
                        <Text style={s.ctaText}>{loading ? 'Scheduling...' : `Schedule Pickup  ·  $${(priceCents / 100).toFixed(2)} TTD`}</Text>
                    </LinearGradient>
                </TouchableOpacity>
            </View>
        </LinearGradient>
    );
}

const s = StyleSheet.create({
    container: { flex: 1 },
    header: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 20, paddingBottom: 12,
    },
    backBtn: {
        width: 38, height: 38, borderRadius: 19,
        backgroundColor: 'rgba(255,255,255,0.1)',
        alignItems: 'center', justifyContent: 'center',
    },
    headerTitle: { fontSize: 20, fontWeight: '700', color: '#FFF' },
    content: { flex: 1, padding: 20, gap: 16 },
    scaleBox: {
        borderRadius: 28, overflow: 'hidden', padding: 28, alignItems: 'center',
        borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
        backgroundColor: 'rgba(255,255,255,0.04)',
    },
    scaleEmoji: { fontSize: 72, marginBottom: 12 },
    weightDisplay: { fontSize: 56, fontWeight: '900', color: '#7B61FF' },
    weightSub: { fontSize: 14, color: 'rgba(255,255,255,0.4)', marginTop: 4, marginBottom: 24 },
    sliderContainer: { width: '100%' },
    slider: { width: '100%', height: 40 },
    sliderLabels: { flexDirection: 'row', justifyContent: 'space-between' },
    sliderLabel: { fontSize: 11, color: 'rgba(255,255,255,0.35)' },
    priceCard: {
        borderRadius: 24, overflow: 'hidden', padding: 22, alignItems: 'center', gap: 4,
        borderWidth: 1, borderColor: 'rgba(0,255,255,0.2)',
        backgroundColor: 'rgba(0,255,255,0.04)',
    },
    priceBreakdown: { fontSize: 14, color: 'rgba(255,255,255,0.5)' },
    priceTotal: { fontSize: 36, fontWeight: '900', color: '#00FFFF' },
    priceNote: { fontSize: 12, color: 'rgba(255,255,255,0.3)', marginTop: 4 },
    features: { gap: 12, paddingVertical: 8 },
    featureRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    featureText: { fontSize: 14, color: 'rgba(255,255,255,0.7)' },
    ctaContainer: { paddingHorizontal: 20, paddingTop: 12 },
    ctaButton: { borderRadius: 20, overflow: 'hidden' },
    ctaGradient: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 18,
    },
    ctaText: { fontSize: 16, fontWeight: '800', color: '#FFF' },
});
