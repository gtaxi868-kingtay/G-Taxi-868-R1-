import React, { useState, useEffect } from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@gtaxi/core';
import { toast } from '../components/Toast';
import { Button, Card, Chip, EmptyState, Loading, Row, Screen, Section, SPACE, Txt, useTheme } from '../ui/kit';
import { formatTTDDollars } from '../utils/currency';

interface Service {
    id: string;
    name: string;
    description: string;
    price_cents: number;
    duration_minutes: number;
}

export function ServiceBookingScreen({ navigation, route }: any) {
    const { merchantId, merchantName, pickup, destination } = route.params;

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
            toast('Could not load this shop\'s services.', 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleConfirmBooking = async () => {
        if (!selectedService || !selectedTime) {
            toast('Choose a service and a time first.', 'error');
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
                    pickup_address: pickup.address,
                    pickup_lat: pickup.latitude,
                    pickup_lng: pickup.longitude,
                }
            });

            if (error || !data?.success) {
                throw new Error(error?.message || data?.error || "Booking failed");
            }

            toast(`Request sent to ${merchantName}. We'll let you know when they confirm.`, 'success');
            navigation.navigate('Home');
        } catch (err: any) {
            toast(err.message || 'Booking did not go through.', 'error');
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

    const m = useTheme();
    return (
        <Screen
            title={merchantName || 'Book'}
            onBack={() => navigation.goBack()}
            footer={<Button title="Request appointment" loading={submitting} disabled={!selectedService || !selectedTime} onPress={handleConfirmBooking} />}
        >
            <Section title="Choose a service" style={{ marginTop: SPACE.sm }}>
                {loading ? <Loading /> : services.length === 0 ? (
                    <EmptyState icon="calendar-outline" title="No services listed yet" body="This shop has not added bookable services." />
                ) : (
                    <Card style={{ paddingVertical: SPACE.xs }}>
                        {services.map((svc, i) => {
                            const on = selectedService?.id === svc.id;
                            return (
                                <Row key={svc.id} title={svc.name} subtitle={`${svc.duration_minutes} min · ${formatTTDDollars(svc.price_cents / 100)}`}
                                    last={i === services.length - 1} onPress={() => setSelectedService(svc)}
                                    right={<Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={22} color={on ? m.accent : m.faint} />} />
                            );
                        })}
                    </Card>
                )}
            </Section>

            <Section title="Choose a time">
                <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                    {timeSlots.map(time => (
                        <Chip key={time.getTime()} label={time.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                            selected={selectedTime?.getTime() === time.getTime()} onPress={() => setSelectedTime(time)} />
                    ))}
                </View>
            </Section>

            <Card style={{ marginTop: SPACE.lg, flexDirection: 'row', alignItems: 'center' }}>
                <Ionicons name="car-outline" size={22} color={m.accent} />
                <View style={{ flex: 1, marginLeft: SPACE.md }}>
                    <Txt variant="bodyStrong">A G ride is included</Txt>
                    <Txt variant="caption" tone="dim">We'll pick you up in time for your appointment.</Txt>
                </View>
            </Card>
        </Screen>
    );
}
