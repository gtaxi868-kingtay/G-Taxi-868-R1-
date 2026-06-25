import React, { useState, useEffect } from 'react';
import {
    View, StyleSheet, TouchableOpacity, ScrollView,
    ActivityIndicator, Alert, useWindowDimensions, Platform
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@gtaxi/core';
import { Txt } from '@/design-system/primitives';
import { LiquidGlass } from '@gtaxi/design-system/native';
import { SURFACE, VOICES } from '@gtaxi/design-system';
import { formatTTDDollars } from '../utils/currency';
import { ghostBorder, elevationGlow } from '@gtaxi/design-system/utils/style-rules';
import type { AppScreenProps } from '../navigation/types';

const CYAN = '#1DE0E6';

interface Service {
    id: string;
    name: string;
    description: string;
    price_cents: number;
    duration_minutes: number;
}

export function ServiceBookingScreen({ navigation, route }: AppScreenProps<'ServiceBooking'>) {
    const { width } = useWindowDimensions();
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
            const { data, error } = await supabase.functions.invoke('merchant', {
                body: {
                    action: 'create_appointment',
                    merchant_id: merchantId,
                    service_id: selectedService.id,
                    scheduled_at: selectedTime.toISOString(),
                    ride_requested: true,
                    pickup_address: pickup?.address,
                    pickup_lat: pickup?.latitude,
                    pickup_lng: pickup?.longitude,
                }
            });

            if (error || !data?.success) {
                throw new Error(error?.message || data?.error || "Booking failed");
            }

            Alert.alert(
                "Booking Sent!",
                "Your request has been sent to " + merchantName + ". We'll notify you once they approve the ride.",
                [{ text: "OK", onPress: () => navigation.navigate('Home', {}) }]
            );
        } catch (err: any) {
            Alert.alert("Booking Failed", err.message);
        } finally {
            setSubmitting(false);
        }
    };

    const timeSlots = [];
    let now = new Date();
    now.setMinutes(0, 0, 0);
    for (let i = 1; i <= 6; i++) {
        let slot = new Date(now.getTime() + i * 60 * 60 * 1000);
        timeSlots.push(slot);
    }

    return (
        <View style={s.root}>
            
            <View style={[s.header, { paddingTop: insets.top + 10 }]}>
                <LiquidGlass tier="chrome" voice="rider" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flex: 1, paddingVertical: 8, paddingHorizontal: 12 }}>
                    <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
                        <Ionicons name="close" size={24} color="#FFF" />
                    </TouchableOpacity>
                    <View>
                        <Txt variant="bodyBold" weight="heavy" color="#FFF">{merchantName}</Txt>
                        <Txt variant="caption" weight="regular" color="rgba(255,255,255,0.5)">Select Service & Time</Txt>
                    </View>
                    <View style={{ width: 44 }} />
                </LiquidGlass>
            </View>

            <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 100 }}>
                <Txt variant="caption" weight="heavy" color={VOICES.rider.accent} style={s.sectionTitle}>SELECT SERVICE</Txt>
                {loading ? (
                    <ActivityIndicator color={VOICES.rider.accent} style={{ marginTop: 20 }} />
                ) : (
                    services.map(svc => (
                        <LiquidGlass key={svc.id} tier="inlay" voice="rider" style={[s.serviceCard, selectedService?.id === svc.id && s.activeCard]}>
                            <TouchableOpacity 
                                style={{ flexDirection: 'row', alignItems: 'center', padding: 20 }}
                                onPress={() => setSelectedService(svc)}
                            >
                                <View style={{ flex: 1 }}>
                                    <Txt variant="bodyBold" weight="heavy" color="#FFF">{svc.name}</Txt>
                                    <Txt variant="caption" weight="regular" color="rgba(255,255,255,0.5)">{svc.duration_minutes} mins</Txt>
                                </View>
                                <Txt variant="bodyReg" weight="heavy" color={CYAN}>{formatTTDDollars(svc.price_cents / 100)}</Txt>
                            </TouchableOpacity>
                        </LiquidGlass>
                    ))
                )}

                <Txt variant="caption" weight="heavy" color={VOICES.rider.accent} style={[s.sectionTitle, { marginTop: 32 }]}>SELECT TIME</Txt>
                <View style={s.timeGrid}>
                    {timeSlots.map(time => {
                        const isSelected = selectedTime?.getTime() === time.getTime();
                        return (
                            <TouchableOpacity 
                                key={time.getTime()} 
                                style={[s.timeSlot, { width: (width - 60) / 3 }, isSelected && s.activeTime]}
                                onPress={() => setSelectedTime(time)}
                            >
                                <Txt variant="bodyReg" weight="heavy" color={isSelected ? "#FFF" : "rgba(255,255,255,0.6)"}>
                                    {time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </Txt>
                            </TouchableOpacity>
                        );
                    })}
                </View>

                <LiquidGlass tier="inlay" voice="rider" style={s.logisticsCard}>
                    <Ionicons name="car" size={24} color={VOICES.rider.accent} />
                    <View style={{ flex: 1, marginLeft: 16 }}>
                        <Txt variant="bodyBold" weight="heavy" color="#FFF">Include G-Taxi Ride</Txt>
                        <Txt variant="caption" weight="regular" color="rgba(255,255,255,0.5)">Coordinated pickup 15m before</Txt>
                    </View>
                    <Ionicons name="checkbox" size={24} color={CYAN} />
                </LiquidGlass>
            </ScrollView>

            <View style={[s.footer, { paddingBottom: insets.bottom + 20 }]}>
                <TouchableOpacity 
                    style={[s.submitBtn, (!selectedService || !selectedTime || submitting) && { opacity: 0.5 }]}
                    onPress={handleConfirmBooking}
                    disabled={!selectedService || !selectedTime || submitting}
                >
                    <LinearGradient 
                        colors={[VOICES.rider.accent, VOICES.rider.accentDark]} 
                        style={s.btnGradient}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
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
    root: { flex: 1, backgroundColor: SURFACE.base },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 20 },
    backBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' },
    sectionTitle: { letterSpacing: 1, marginBottom: 16 },
    serviceCard: { flexDirection: 'row', alignItems: 'center', padding: 20, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 28, marginBottom: 12, ...ghostBorder(0.05) },
    activeCard: { borderColor: VOICES.rider.accent, backgroundColor: 'rgba(124, 58, 237, 0.1)' },
    timeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    timeSlot: { paddingVertical: 12, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 20, ...ghostBorder(0.05) },
    activeTime: { backgroundColor: VOICES.rider.accent, borderColor: CYAN },
    logisticsCard: { marginTop: 32, flexDirection: 'row', alignItems: 'center', padding: 20 },
    footer: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 20, backgroundColor: 'rgba(10,10,31,0.8)' },
    submitBtn: { height: 60, borderRadius: 999, overflow: 'hidden' },
    btnGradient: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
