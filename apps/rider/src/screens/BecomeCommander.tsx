import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '@gtaxi/core';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';

// Icon bridge: the apps use @expo/vector-icons (Ionicons), not lucide.
type IconProps = { color?: string; size?: number; style?: any };
const ShieldCheck = (p: IconProps) => <Ionicons name="shield-checkmark" {...p} />;
const ChevronLeft = (p: IconProps) => <Ionicons name="chevron-back" {...p} />;
const Send = (p: IconProps) => <Ionicons name="send" {...p} />;
const CheckCircle2 = (p: IconProps) => <Ionicons name="checkmark-circle" {...p} />;

// Local token bridge mapped to the real @gtaxi/design-system palette.
// (The design system does not export COLORS/TYPOGRAPHY; these mirror tokens.ts.)
const COLORS = {
    primary: '#34E6EC',
    background: '#07070F',
    borderLight: 'rgba(255,255,255,0.10)',
    textPrimary: '#EAF3F6',
    textSecondary: 'rgba(242,245,248,0.68)',
    textTertiary: 'rgba(242,245,248,0.42)',
    error: '#EF4444',
};
const SURFACE = { base: '#07070F', elevated: '#1A1F27' };
const TYPOGRAPHY = {
    h1: { fontSize: 28, fontWeight: '800' as const, color: COLORS.textPrimary },
    h3: { fontSize: 18, fontWeight: '700' as const, color: COLORS.textPrimary },
    body1: { fontSize: 15, fontWeight: '400' as const },
    button: { fontSize: 15, fontWeight: '700' as const },
    overline: { fontSize: 11, fontWeight: '600' as const },
};

export function BecomeCommanderScreen() {
    const navigation = useNavigation();
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
        referralCode: ''
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
            // Single source of truth: an application is a pending row in
            // commander_applications. RLS allows an authenticated user to
            // insert their own row only. An admin approves it, which is what
            // creates the pod_commanders record — clients never write there.
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
                // A unique-violation means this user already has a pending
                // application — surface that instead of a raw DB error.
                if (error.code === '23505') {
                    Alert.alert('Already Applied', 'You already have an application under review. Our team will be in touch.');
                    return;
                }
                throw error;
            }

            setSubmitted(true);
        } catch (err: any) {
            Alert.alert('Application Failed', err.message || 'Could not submit your application at this time.');
        } finally {
            setLoading(false);
        }
    };

    if (submitted) {
        return (
            <SafeAreaView style={styles.container}>
                <View style={styles.successContainer}>
                    <View style={styles.successIconWrapper}>
                        <CheckCircle2 color={COLORS.primary} size={64} />
                    </View>
                    <Text style={styles.successTitle}>Application Received</Text>
                    <Text style={styles.successText}>
                        Your application to become a G-Lead has been securely transmitted to HQ. 
                        Our team will review your profile and contact you within 48 hours.
                    </Text>
                    <TouchableOpacity 
                        style={styles.doneButton} 
                        onPress={() => navigation.goBack()}
                    >
                        <Text style={styles.doneButtonText}>RETURN TO BASE</Text>
                    </TouchableOpacity>
                </View>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
                    <ChevronLeft color={COLORS.textPrimary} size={28} />
                </TouchableOpacity>
                <View style={styles.headerTitleContainer}>
                    <ShieldCheck color={COLORS.primary} size={20} />
                    <Text style={styles.headerTitle}>G-LEAD</Text>
                </View>
                <View style={{ width: 40 }} />
            </View>

            <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
                <Text style={styles.title}>Lead Your Territory</Text>
                <Text style={styles.subtitle}>
                    G-Leads manage local fleets, recruit drivers, and earn overrides on all volume in their designated area.
                </Text>

                <View style={styles.formGroup}>
                    <Text style={styles.label}>FULL NAME *</Text>
                    <TextInput 
                        style={styles.input}
                        placeholder="John Doe"
                        placeholderTextColor={COLORS.textTertiary}
                        value={form.fullName}
                        onChangeText={(t) => setForm({...form, fullName: t})}
                    />
                </View>

                <View style={styles.row}>
                    <View style={[styles.formGroup, { flex: 1, marginRight: 8 }]}>
                        <Text style={styles.label}>PHONE *</Text>
                        <TextInput 
                            style={styles.input}
                            placeholder="868-..."
                            placeholderTextColor={COLORS.textTertiary}
                            keyboardType="phone-pad"
                            value={form.phone}
                            onChangeText={(t) => setForm({...form, phone: t})}
                        />
                    </View>
                    <View style={[styles.formGroup, { flex: 1, marginLeft: 8 }]}>
                        <Text style={styles.label}>WHATSAPP</Text>
                        <TextInput 
                            style={styles.input}
                            placeholder="Optional"
                            placeholderTextColor={COLORS.textTertiary}
                            keyboardType="phone-pad"
                            value={form.whatsapp}
                            onChangeText={(t) => setForm({...form, whatsapp: t})}
                        />
                    </View>
                </View>

                <View style={styles.formGroup}>
                    <Text style={styles.label}>TARGET AREA IN T&T *</Text>
                    <TextInput 
                        style={styles.input}
                        placeholder="e.g. San Fernando, Port of Spain, Arima"
                        placeholderTextColor={COLORS.textTertiary}
                        value={form.area}
                        onChangeText={(t) => setForm({...form, area: t})}
                    />
                </View>

                <View style={styles.formGroup}>
                    <Text style={styles.label}>CURRENT ROLE</Text>
                    <TextInput 
                        style={styles.input}
                        placeholder="e.g. Driver, Business Owner, Fleet Manager"
                        placeholderTextColor={COLORS.textTertiary}
                        value={form.currentRole}
                        onChangeText={(t) => setForm({...form, currentRole: t})}
                    />
                </View>

                <View style={styles.formGroup}>
                    <Text style={styles.label}>WHY DO YOU WANT TO BE A COMMANDER? *</Text>
                    <TextInput 
                        style={[styles.input, styles.textArea]}
                        placeholder="Tell us about your local network and experience..."
                        placeholderTextColor={COLORS.textTertiary}
                        multiline
                        numberOfLines={4}
                        textAlignVertical="top"
                        value={form.reasoning}
                        onChangeText={(t) => setForm({...form, reasoning: t})}
                    />
                </View>

                <View style={styles.formGroup}>
                    <Text style={styles.label}>REFERRAL CODE</Text>
                    <TextInput 
                        style={styles.input}
                        placeholder="If referred by another Commander"
                        placeholderTextColor={COLORS.textTertiary}
                        autoCapitalize="characters"
                        value={form.referralCode}
                        onChangeText={(t) => setForm({...form, referralCode: t})}
                    />
                </View>

                <TouchableOpacity 
                    style={[styles.submitButton, loading && styles.submitButtonDisabled]} 
                    onPress={handleSubmit}
                    disabled={loading}
                >
                    {loading ? (
                        <ActivityIndicator color={COLORS.background} />
                    ) : (
                        <>
                            <Send color={COLORS.background} size={20} />
                            <Text style={styles.submitButtonText}>SUBMIT APPLICATION</Text>
                        </>
                    )}
                </TouchableOpacity>
                <View style={{ height: 40 }} />
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: SURFACE.base,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: COLORS.borderLight,
    },
    backButton: {
        padding: 4,
    },
    headerTitleContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    headerTitle: {
        ...TYPOGRAPHY.h3,
        fontSize: 16,
        letterSpacing: 2,
    },
    scrollContent: {
        padding: 24,
    },
    title: {
        ...TYPOGRAPHY.h1,
        fontSize: 28,
        color: COLORS.textPrimary,
        marginBottom: 8,
    },
    subtitle: {
        ...TYPOGRAPHY.body1,
        color: COLORS.textSecondary,
        marginBottom: 32,
        lineHeight: 22,
    },
    row: {
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    formGroup: {
        marginBottom: 20,
    },
    label: {
        ...TYPOGRAPHY.overline,
        color: COLORS.textSecondary,
        marginBottom: 8,
        letterSpacing: 1.5,
    },
    input: {
        backgroundColor: SURFACE.elevated,
        borderWidth: 1,
        borderColor: COLORS.borderLight,
        borderRadius: 12,
        padding: 16,
        color: COLORS.textPrimary,
        ...TYPOGRAPHY.body1,
    },
    textArea: {
        minHeight: 120,
        paddingTop: 16,
    },
    submitButton: {
        backgroundColor: COLORS.primary,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 18,
        borderRadius: 16,
        marginTop: 16,
        gap: 12,
    },
    submitButtonDisabled: {
        opacity: 0.7,
    },
    submitButtonText: {
        ...TYPOGRAPHY.button,
        color: COLORS.background,
    },
    successContainer: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 32,
    },
    successIconWrapper: {
        width: 120,
        height: 120,
        borderRadius: 60,
        backgroundColor: 'rgba(0, 229, 255, 0.1)',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 24,
    },
    successTitle: {
        ...TYPOGRAPHY.h1,
        fontSize: 24,
        marginBottom: 12,
        textAlign: 'center',
    },
    successText: {
        ...TYPOGRAPHY.body1,
        color: COLORS.textSecondary,
        textAlign: 'center',
        lineHeight: 24,
        marginBottom: 40,
    },
    doneButton: {
        backgroundColor: SURFACE.elevated,
        borderWidth: 1,
        borderColor: COLORS.borderLight,
        paddingVertical: 16,
        paddingHorizontal: 32,
        borderRadius: 100,
    },
    doneButtonText: {
        ...TYPOGRAPHY.button,
        color: COLORS.textPrimary,
        letterSpacing: 2,
    }
});
