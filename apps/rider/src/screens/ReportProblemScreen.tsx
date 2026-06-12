import React, { useState } from 'react';
import {
    View, StyleSheet, TouchableOpacity, ScrollView,
    TextInput, Alert, ActivityIndicator, KeyboardAvoidingView, Platform
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@gtaxi/core';
import { Txt } from '@/design-system/primitives';
import { SURFACE, VOICES } from '@gtaxi/design-system';
import { ghostBorder, elevationGlow } from '@gtaxi/design-system/utils/style-rules';

const R = {
    bg: SURFACE.base,
    purple: VOICES.rider.accent,
    white: '#FFFFFF',
    muted: '#AEA9B5',
};

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
    const insets = useSafeAreaInsets();
    const ride = route?.params?.ride ?? null;

    const [category, setCategory] = useState<string | null>(null);
    const [description, setDescription] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const handleSubmit = async () => {
        if (!category) {
            Alert.alert('Pick a Category', 'Please select what went wrong.');
            return;
        }
        if (description.trim().length < 5) {
            Alert.alert('Add Details', 'Please describe what happened (at least a few words).');
            return;
        }

        setSubmitting(true);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

        const { data, error } = await supabase.functions.invoke('submit_dispute', {
            body: {
                ride_id: ride?.id ?? null,
                category,
                description: description.trim(),
            },
        });

        setSubmitting(false);

        if (error || data?.error) {
            Alert.alert('Could Not Submit', data?.error || 'Something went wrong. Please try again or email support@gtaxi.tt.');
        } else {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            Alert.alert(
                'Report Received',
                'Our support team will review your report and follow up. Refunds are typically resolved within 48 hours.',
                [{ text: 'OK', onPress: () => navigation.goBack() }]
            );
        }
    };

    return (
        <View style={s.root}>
            <StatusBar style="light" />

            <View style={[s.header, { paddingTop: insets.top + 10 }]}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
                    <Ionicons name="chevron-back" size={24} color="#FFF" />
                </TouchableOpacity>
                <Txt variant="headingM" weight="heavy" color="#FFF" style={{ marginLeft: 16 }}>Report a Problem</Txt>
            </View>

            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                style={{ flex: 1 }}
            >
                <ScrollView contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 40 }]}>
                    {ride && (
                        <View style={s.rideCard}>
                            <Ionicons name="car-outline" size={18} color={R.purple} />
                            <View style={{ flex: 1, marginLeft: 12 }}>
                                <Txt variant="small" color={R.muted} numberOfLines={1}>
                                    {ride.pickup_address} → {ride.dropoff_address}
                                </Txt>
                                <Txt variant="bodyBold" color="#FFF">
                                    ${((ride.total_fare_cents || 0) / 100).toFixed(2)} TTD
                                </Txt>
                            </View>
                        </View>
                    )}

                    <Txt variant="caption" weight="heavy" color={R.muted} style={s.sectionLabel}>WHAT WENT WRONG?</Txt>
                    {CATEGORIES.map((cat) => (
                        <TouchableOpacity
                            key={cat.id}
                            style={[s.catRow, category === cat.id && s.catRowActive]}
                            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setCategory(cat.id); }}
                            activeOpacity={0.8}
                        >
                            <Ionicons name={cat.icon} size={20} color={category === cat.id ? R.purple : R.muted} />
                            <Txt variant="bodyBold" color={category === cat.id ? '#FFF' : R.muted} style={{ marginLeft: 14 }}>
                                {cat.label}
                            </Txt>
                            {category === cat.id && (
                                <Ionicons name="checkmark-circle" size={20} color={R.purple} style={{ marginLeft: 'auto' }} />
                            )}
                        </TouchableOpacity>
                    ))}

                    <Txt variant="caption" weight="heavy" color={R.muted} style={s.sectionLabel}>TELL US MORE</Txt>
                    <TextInput
                        style={s.descInput}
                        placeholder="Describe what happened..."
                        placeholderTextColor={R.muted}
                        value={description}
                        onChangeText={setDescription}
                        multiline
                        maxLength={2000}
                        textAlignVertical="top"
                    />

                    <TouchableOpacity
                        style={s.submitBtn}
                        onPress={handleSubmit}
                        disabled={submitting}
                        activeOpacity={0.85}
                    >
                        {submitting ? (
                            <ActivityIndicator size="small" color="#FFF" />
                        ) : (
                            <Txt variant="bodyBold" color="#FFF">Submit Report</Txt>
                        )}
                    </TouchableOpacity>
                </ScrollView>
            </KeyboardAvoidingView>
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: R.bg },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, marginBottom: 20 },
    backBtn: { width: 44, height: 44, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' },

    scroll: { paddingHorizontal: 20 },
    sectionLabel: { marginLeft: 16, marginBottom: 12, marginTop: 28, letterSpacing: 2 },

    rideCard: {
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 20,
        padding: 16, ...ghostBorder(0.15),
    },
    catRow: {
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 18,
        paddingHorizontal: 18, paddingVertical: 16, marginBottom: 10,
        ...ghostBorder(0.1),
    },
    catRowActive: {
        backgroundColor: 'rgba(191,64,255,0.12)',
        ...ghostBorder(0.3),
    },
    descInput: {
        backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 20,
        padding: 18, minHeight: 130, fontSize: 15, color: '#FFF',
        ...ghostBorder(0.12),
    },
    submitBtn: {
        backgroundColor: VOICES.rider.accent, borderRadius: 20,
        alignItems: 'center', justifyContent: 'center', paddingVertical: 16,
        marginTop: 24, ...elevationGlow(8),
    },
});
