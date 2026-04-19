import React, { useState, useEffect } from 'react';
import {
    View, StyleSheet, TouchableOpacity, ScrollView,
    ActivityIndicator, Alert, Dimensions, Platform
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../../shared/supabase';
import { Txt } from '../design-system/primitives';
import { GlassCard, BRAND, VOICES, RADIUS, GRADIENTS } from '../design-system';
import { formatTTDDollars } from '../utils/currency';

const { width } = Dimensions.get('window');

interface Service {
    id: string;
    name: string;
    description: string;
    price_cents: number;
    duration_minutes: number;
}

export function ServiceBookingScreen({ navigation, route }: any) {
    const { merchantId, merchantName, pickup, destination } = route.params;
    const insets = useSafeAreaInsets();

    const [loading, setLoading] = useState(true);
    const [services, setServices] = useState<Service[]>([]);
    const [selectedService, setSelectedService] = useState<Service | null>(null);
    const [selectedTime, setSelectedTime] = useState<Date | null>(null);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        fetchServices();
    }, []);

    const fetchServices = async () => {
        try {
            const { data, error } = await supabase
                .from('merchant_services')
                .select('*')
                .eq('merchant_id', merchantId);
            
            if (error) throw error;
            setServices(data || []);
        } catch (err) {
            Alert.alert("Error", "Could not load services for this merchant.");
        } finally {
            setLoading(false);
        }
    };

    const handleConfirmBooking = async () => {
        if (!selectedService || !selectedTime) {
            Alert.alert("Missing Info", "Please select a service and a time.");
            return;
        }

        setSubmitting(true);
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error("Auth required");

            const { data, error } = await supabase
                .from('merchant_appointments')
                .insert({
                    rider_id: user.id,
                    merchant_id: merchantId,
                    service_id: selectedService.id,
                    scheduled_at: selectedTime.toISOString(),
                    ride_requested: true,
                    pickup_address: pickup.address,
                    pickup_lat: pickup.latitude,
                    pickup_lng: pickup.longitude,
                    merchant_consent_status: 'pending'
                })
                .select()
                .single();

            if (error) throw error;

            Alert.alert(
                "Booking Sent!",
                "Your request has been sent to " + merchantName + ". We'll notify you once they approve the ride.",
                [{ text: "OK", onPress: () => navigation.navigate('Home') }]
            );
        } catch (err: any) {
            Alert.alert("Booking Failed", err.message);
        } finally {
            setSubmitting(false);
        }
    };

    // Generate upcoming time slots (simple 1-hr increments)
    const timeSlots = [];
    let now = new Date();
    now.setMinutes(0, 0, 0);
    for (let i = 1; i <= 6; i++) {
        let slot = new Date(now.getTime() + i * 60 * 60 * 1000);
        timeSlots.push(slot);
    }

    return (
        <View style={s.root}>
            <LinearGradient colors={['#0A0A1F', '#12122A']} style={StyleSheet.absoluteFillObject} />
            
            <View style={[s.header, { paddingTop: insets.top + 10 }]}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
                    <Ionicons name="close" size={24} color="#FFF" />
                </TouchableOpacity>
                <View>
                    <Txt variant="bodyBold" weight="heavy" color="#FFF">{merchantName}</Txt>
                    <Txt variant="caption" weight="regular" color="rgba(255,255,255,0.5)">Select Service & Time</Txt>
                </View>
                <View style={{ width: 44 }} />
            </View>

            <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 100 }}>
                <Txt variant="caption" weight="heavy" color={BRAND.purple} style={s.sectionTitle}>SELECT SERVICE</Txt>
                {loading ? (
                    <ActivityIndicator color={BRAND.purple} style={{ marginTop: 20 }} />
                ) : (
                    services.map(svc => (
                        <TouchableOpacity 
                            key={svc.id} 
                            style={[s.serviceCard, selectedService?.id === svc.id && s.activeCard]}
                            onPress={() => setSelectedService(svc)}
                        >
                            <View style={{ flex: 1 }}>
                                <Txt variant="bodyBold" weight="heavy" color="#FFF">{svc.name}</Txt>
                                <Txt variant="caption" weight="regular" color="rgba(255,255,255,0.5)">{svc.duration_minutes} mins</Txt>
                            </View>
                            <Txt variant="bodyReg" weight="heavy" color={BRAND.cyan}>{formatTTDDollars(svc.price_cents / 100)}</Txt>
                        </TouchableOpacity>
                    ))
                )}

                <Txt variant="caption" weight="heavy" color={BRAND.purple} style={[s.sectionTitle, { marginTop: 32 }]}>SELECT TIME</Txt>
                <View style={s.timeGrid}>
                    {timeSlots.map(time => {
                        const isSelected = selectedTime?.getTime() === time.getTime();
                        return (
                            <TouchableOpacity 
                                key={time.getTime()} 
                                style={[s.timeSlot, isSelected && s.activeTime]}
                                onPress={() => setSelectedTime(time)}
                            >
                                <Txt variant="bodyReg" weight="heavy" color={isSelected ? "#FFF" : "rgba(255,255,255,0.6)"}>
                                    {time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </Txt>
                            </TouchableOpacity>
                        );
                    })}
                </View>

                <GlassCard variant="rider" style={s.logisticsCard}>
                    <Ionicons name="car" size={24} color={BRAND.purple} />
                    <View style={{ flex: 1, marginLeft: 16 }}>
                        <Txt variant="bodyBold" weight="heavy" color="#FFF">Include G-Taxi Ride</Txt>
                        <Txt variant="caption" weight="regular" color="rgba(255,255,255,0.5)">Coordinated pickup 15m before</Txt>
                    </View>
                    <Ionicons name="checkbox" size={24} color={BRAND.cyan} />
                </GlassCard>
            </ScrollView>

            <View style={[s.footer, { paddingBottom: insets.bottom + 20 }]}>
                <TouchableOpacity 
                    style={[s.submitBtn, (!selectedService || !selectedTime || submitting) && { opacity: 0.5 }]}
                    onPress={handleConfirmBooking}
                    disabled={!selectedService || !selectedTime || submitting}
                >
                    <LinearGradient 
                        colors={[BRAND.purple, BRAND.purpleDark]} 
                        style={s.btnGradient}
                        start={GRADIENTS.primaryStart}
                        end={GRADIENTS.primaryEnd}
                    >
                        {submitting ? <ActivityIndicator color="#FFF" /> : (
                            <Txt variant="bodyReg" weight="heavy" color="#FFF">REQUEST APPOINTMENT</Txt>
                        )}
                    </LinearGradient>
                </TouchableOpacity>
            </View>
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: '#0A0A1F' },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 20 },
    backBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' },
    sectionTitle: { letterSpacing: 1, marginBottom: 16 },
    serviceCard: { flexDirection: 'row', alignItems: 'center', padding: 20, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: RADIUS.lg, marginBottom: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
    activeCard: { borderColor: BRAND.purple, backgroundColor: 'rgba(124, 58, 237, 0.1)' },
    timeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    timeSlot: { width: (width - 60) / 3, paddingVertical: 12, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: RADIUS.md, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
    activeTime: { backgroundColor: BRAND.purple, borderColor: BRAND.purpleLight },
    logisticsCard: { marginTop: 32, flexDirection: 'row', alignItems: 'center', padding: 20 },
    footer: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 20, backgroundColor: 'rgba(10,10,31,0.8)' },
    submitBtn: { height: 60, borderRadius: RADIUS.pill, overflow: 'hidden' },
    btnGradient: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
