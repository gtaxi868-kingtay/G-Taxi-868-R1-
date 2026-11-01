import React, { useState } from 'react';

import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@gtaxi/core';
import { toast } from '../components/Toast';
import { Button, Card, Field, Row, Screen, Section, SPACE, Txt, useTheme } from '../ui/kit';

const CATEGORIES = [
    { id: 'refund_request', label: 'Request a Refund', icon: 'cash-outline' as const },
    { id: 'overcharge', label: 'I Was Overcharged', icon: 'card-outline' as const },
    { id: 'driver_behavior', label: 'Driver Behavior', icon: 'person-outline' as const },
    { id: 'lost_item', label: 'Lost Item', icon: 'bag-outline' as const },
    { id: 'safety', label: 'Safety Concern', icon: 'shield-outline' as const },
    { id: 'app_issue', label: 'App Problem', icon: 'phone-portrait-outline' as const },
    { id: 'other', label: 'Something Else', icon: 'help-circle-outline' as const },
];

export function ReportProblemScreen({ navigation, route }: any) {
    const ride = route?.params?.ride ?? null;

    const [category, setCategory] = useState<string | null>(null);
    const [description, setDescription] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [formError, setFormError] = useState('');

    const handleSubmit = async () => {
        if (!category) {
            setFormError('Choose what went wrong first.');
            return;
        }
        if (description.trim().length < 5) {
            setFormError('Tell us what happened in a few words.');
            return;
        }

        setFormError('');
        setSubmitting(true);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

        const { data, error } = await supabase.functions.invoke('merchant', {
            body: {
                action: 'submit_dispute',
                ride_id: ride?.id ?? null,
                category,
                description: description.trim(),
            },
        });

        setSubmitting(false);

        if (error || data?.error) {
            toast(data?.error || 'Could not send your report. Please try again or email support@gtaxi.tt.', 'error');
        } else {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            toast('Report sent. Our team will follow up with you.', 'success');
            navigation.goBack();
        }
    };

    const m = useTheme();
    return (
        <Screen title="Report a problem" onBack={() => navigation.goBack()} footer={<Button title="Send report" loading={submitting} onPress={handleSubmit} />}>
            {ride && (
                <Card style={{ marginTop: SPACE.sm }}>
                    <Txt variant="caption" tone="dim" numberOfLines={2}>{ride.pickup_address} → {ride.dropoff_address}</Txt>
                    <Txt variant="bodyStrong" style={{ marginTop: 2 }}>${((ride.total_fare_cents || 0) / 100).toFixed(2)} TTD</Txt>
                </Card>
            )}

            <Section title="What went wrong?">
                <Card style={{ paddingVertical: SPACE.xs }}>
                    {CATEGORIES.map((cat, i) => {
                        const on = category === cat.id;
                        return (
                            <Row key={cat.id} icon={cat.icon} title={cat.label} last={i === CATEGORIES.length - 1}
                                onPress={() => { Haptics.selectionAsync(); setCategory(cat.id); }}
                                right={<Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={22} color={on ? m.accent : m.faint} />} />
                        );
                    })}
                </Card>
            </Section>

            <Section title="Tell us more">
                <Field placeholder="What happened?" value={description} onChangeText={setDescription} multiline maxLength={2000} error={formError || null} />
            </Section>
        </Screen>
    );
}
