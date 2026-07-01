import React, { useState } from 'react';
import {
    View, Text, TextInput, TouchableOpacity, ScrollView,
    Alert, ActivityIndicator, StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@gtaxi/core';
import { useAuth } from '../context/AuthContext';
import { SURFACE, VOICES } from '@gtaxi/design-system';
import { LiquidGlass } from '@gtaxi/design-system/native';
import { ghostBorder, elevationGlow } from '@gtaxi/design-system/utils/style-rules';

export function BecomeCommanderScreen({ navigation }: any) {
    const insets = useSafeAreaInsets();
    const { user } = useAuth();

    const [loading, setLoading] = useState(false);
    const [submitted, setSubmitted] = useState(false);
    const [form, setForm] = useState({
        fullName: '',
        phone: '',
        whatsapp: '',
        area: '',
        currentRole: '',
        reasoning: '',
        referralCode: '',
    });

    const handleSubmit = async () => {
        if (!form.fullName || !form.phone || !form.area || !form.reasoning) {
            Alert.alert('Required Fields', 'Please fill in all required fields (Name, Phone, Area, and Why).');
            return;
        }
        if (!user?.id) {
            Alert.alert('Auth Error', 'You must be logged in to apply.');
            return;
        }
        setLoading(true);
        try {
            const { error } = await supabase.from('commander_applications').insert({
                user_id: user.id,
                full_name: form.fullName,
                phone: form.phone,
                whatsapp: form.whatsapp || null,
                area: form.area,
                current_role: form.currentRole || null,
                reasoning: form.reasoning,
                referral_code: form.referralCode || null,
                status: 'pending',
            });
            if (error) {
                if (error.code === '23505') {
                    Alert.alert('Already Applied', 'You already have an application under review.');
                    return;
                }
                throw error;
            }
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            setSubmitted(true);
        } catch (err: any) {
            Alert.alert('Application Failed', err.message || 'Could not submit application.');
        } finally {
            setLoading(false);
        }
    };

    if (submitted) {
        return (
            <View style={s.root}>
                <StatusBar style="light" />
                <View style={[s.header, { paddingTop: insets.top + 10 }]}>
                    <LiquidGlass tier="chrome" voice="driver" style={{ flexDirection: 'row', alignItems: 'center', flex: 1, paddingVertical: 8, paddingHorizontal: 12 }}>
                        <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()}>
                            <Ionicons name="chevron-back" size={24} color="#FFF" />
                        </TouchableOpacity>
                        <Text style={s.headerTitle}>G-LEAD</Text>
                    </LiquidGlass>
                </View>
                <View style={s.center}>
                    <View style={s.successIconWrap}>
                        <Ionicons name="checkmark-circle" size={64} color={VOICES.driver.gold} />
                    </View>
                    <Text style={s.successTitle}>Application Received</Text>
                    <Text style={s.successText}>
                        Your application has been sent to HQ. Our team will review your profile and contact you within 48 hours.
                    </Text>
                    <TouchableOpacity style={s.doneBtn} onPress={() => navigation.goBack()}>
                        <Text style={s.doneBtnText}>RETURN TO BASE</Text>
                    </TouchableOpacity>
                </View>
            </View>
        );
    }

    return (
        <View style={s.root}>
            <StatusBar style="light" />
            <View style={[s.header, { paddingTop: insets.top + 10 }]}>
                <LiquidGlass tier="chrome" voice="driver" style={{ flexDirection: 'row', alignItems: 'center', flex: 1, paddingVertical: 8, paddingHorizontal: 12 }}>
                    <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()}>
                        <Ionicons name="chevron-back" size={24} color="#FFF" />
                    </TouchableOpacity>
                    <Ionicons name="shield-checkmark" size={20} color={VOICES.driver.accent} style={{ marginLeft: 8 }} />
                    <Text style={[s.headerTitle, { marginLeft: 8 }]}>G-LEAD</Text>
                </LiquidGlass>
            </View>

            <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
                <Text style={s.title}>Lead Your Territory</Text>
                <Text style={s.subtitle}>
                    G-Leads manage local fleets, recruit drivers, and earn overrides on all volume in their designated area.
                </Text>

                <LiquidGlass tier="panel" voice="driver" style={s.formCard}>
                    <View style={s.field}>
                        <Text style={s.label}>FULL NAME *</Text>
                        <TextInput
                            style={s.input}
                            placeholder="John Doe"
                            placeholderTextColor="rgba(255,255,255,0.3)"
                            value={form.fullName}
                            onChangeText={(t) => setForm({ ...form, fullName: t })}
                        />
                    </View>

                    <View style={s.row}>
                        <View style={[s.field, { flex: 1, marginRight: 8 }]}>
                            <Text style={s.label}>PHONE *</Text>
                            <TextInput
                                style={s.input}
                                placeholder="868-..."
                                placeholderTextColor="rgba(255,255,255,0.3)"
                                keyboardType="phone-pad"
                                value={form.phone}
                                onChangeText={(t) => setForm({ ...form, phone: t })}
                            />
                        </View>
                        <View style={[s.field, { flex: 1, marginLeft: 8 }]}>
                            <Text style={s.label}>WHATSAPP</Text>
                            <TextInput
                                style={s.input}
                                placeholder="Optional"
                                placeholderTextColor="rgba(255,255,255,0.3)"
                                keyboardType="phone-pad"
                                value={form.whatsapp}
                                onChangeText={(t) => setForm({ ...form, whatsapp: t })}
                            />
                        </View>
                    </View>

                    <View style={s.field}>
                        <Text style={s.label}>TARGET AREA IN T&T *</Text>
                        <TextInput
                            style={s.input}
                            placeholder="e.g. San Fernando, Port of Spain, Arima"
                            placeholderTextColor="rgba(255,255,255,0.3)"
                            value={form.area}
                            onChangeText={(t) => setForm({ ...form, area: t })}
                        />
                    </View>

                    <View style={s.field}>
                        <Text style={s.label}>CURRENT ROLE</Text>
                        <TextInput
                            style={s.input}
                            placeholder="e.g. Driver, Fleet Manager"
                            placeholderTextColor="rgba(255,255,255,0.3)"
                            value={form.currentRole}
                            onChangeText={(t) => setForm({ ...form, currentRole: t })}
                        />
                    </View>

                    <View style={s.field}>
                        <Text style={s.label}>WHY DO YOU WANT TO BE A COMMANDER? *</Text>
                        <TextInput
                            style={[s.input, s.textArea]}
                            placeholder="Tell us about your local network and experience..."
                            placeholderTextColor="rgba(255,255,255,0.3)"
                            multiline
                            numberOfLines={4}
                            textAlignVertical="top"
                            value={form.reasoning}
                            onChangeText={(t) => setForm({ ...form, reasoning: t })}
                        />
                    </View>

                    <View style={s.field}>
                        <Text style={s.label}>REFERRAL CODE</Text>
                        <TextInput
                            style={s.input}
                            placeholder="If referred by another Commander"
                            placeholderTextColor="rgba(255,255,255,0.3)"
                            autoCapitalize="characters"
                            value={form.referralCode}
                            onChangeText={(t) => setForm({ ...form, referralCode: t })}
                        />
                    </View>
                </LiquidGlass>

                <TouchableOpacity
                    style={[s.submitBtn, loading && { opacity: 0.7 }]}
                    onPress={handleSubmit}
                    disabled={loading}
                >
                    {loading ? (
                        <ActivityIndicator color={SURFACE.base} />
                    ) : (
                        <>
                            <Ionicons name="send" size={20} color={SURFACE.base} />
                            <Text style={s.submitBtnText}>SUBMIT APPLICATION</Text>
                        </>
                    )}
                </TouchableOpacity>

                <View style={{ height: 40 }} />
            </ScrollView>
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: SURFACE.base },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, marginBottom: 16 },
    backBtn: { width: 44, height: 44, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center', ...ghostBorder(0.15) },
    headerTitle: { fontSize: 20, fontWeight: '800', color: '#FFF', fontFamily: 'SpaceGrotesk-Bold' },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
    scroll: { padding: 24 },
    title: { fontSize: 28, fontWeight: '900', color: '#FFF', fontFamily: 'SpaceGrotesk-Bold', marginBottom: 8 },
    subtitle: { fontSize: 15, color: 'rgba(242,245,248,0.68)', fontFamily: 'Manrope-Regular', lineHeight: 22, marginBottom: 32 },
    formCard: { padding: 20, borderRadius: 24, marginBottom: 20, overflow: 'hidden' },
    field: { marginBottom: 20 },
    label: { fontSize: 11, fontWeight: '700', color: 'rgba(242,245,248,0.6)', letterSpacing: 1.5, marginBottom: 8, fontFamily: 'SpaceGrotesk-Bold' },
    input: { height: 56, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 14, paddingHorizontal: 16, color: '#FFF', fontSize: 16, fontWeight: '600', ...ghostBorder(0.15) },
    textArea: { minHeight: 120, paddingTop: 16, textAlignVertical: 'top' },
    row: { flexDirection: 'row' },
    submitBtn: { backgroundColor: VOICES.driver.accent, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 18, borderRadius: 16, gap: 12 },
    submitBtnText: { fontSize: 15, fontWeight: '800', color: SURFACE.base, fontFamily: 'SpaceGrotesk-Bold', letterSpacing: 0.5 },
    successIconWrap: { width: 120, height: 120, borderRadius: 60, backgroundColor: 'rgba(251,191,36,0.1)', alignItems: 'center', justifyContent: 'center', marginBottom: 24, ...elevationGlow(0.12) },
    successTitle: { fontSize: 24, fontWeight: '900', color: '#FFF', fontFamily: 'SpaceGrotesk-Bold', marginBottom: 12, textAlign: 'center' },
    successText: { fontSize: 15, color: 'rgba(242,245,248,0.68)', fontFamily: 'Manrope-Regular', lineHeight: 24, textAlign: 'center', marginBottom: 40 },
    doneBtn: { paddingVertical: 16, paddingHorizontal: 32, borderRadius: 100, backgroundColor: 'rgba(255,255,255,0.05)', ...ghostBorder(0.15) },
    doneBtnText: { fontSize: 13, fontWeight: '800', color: '#FFF', fontFamily: 'SpaceGrotesk-Bold', letterSpacing: 2 },
});
