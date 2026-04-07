import React, { useState, useEffect } from 'react';
import {
    View, StyleSheet, TextInput, TouchableOpacity,
    KeyboardAvoidingView, Platform, ActivityIndicator,
    Dimensions, ScrollView, Alert
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import Reanimated, {
    useSharedValue, useAnimatedStyle, withTiming,
    FadeIn, FadeOut, Layout
} from 'react-native-reanimated';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../../../../shared/supabase';
import { Txt } from '../design-system/primitives';
import { Ionicons } from '@expo/vector-icons';

import { tokens } from '../design-system/tokens';

const { width, height } = Dimensions.get('window');

// --- Rider Design Tokens (Deprecated local, using tokens) ---
const R = {
    bg: tokens.colors.background.base,
    surface: tokens.colors.background.surface,
    border: tokens.colors.glass.stroke,
    purple: tokens.colors.primary.purple,
    purpleLight: tokens.colors.primary.cyan,
    gold: '#F59E0B',
    white: tokens.colors.text.primary,
    muted: tokens.colors.text.secondary,
};

export function SignupScreen({ navigation }: any) {
    const { signUp, verifyPhoneOTP } = useAuth();
    const insets = useSafeAreaInsets();

    const [step, setStep] = useState(1); // 1: Info, 2: OTP
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const [formData, setFormData] = useState({
        name: '', email: '', phone: '', password: '',
        emergencyName: '', emergencyPhone: '',
        aiEnabled: true // Default to enabled for premium experience
    });
    const [otp, setOtp] = useState('');

    const handleNext = async () => {
        if (!formData.name || !formData.email || !formData.phone || !formData.password) {
            setError('Please fill all required fields');
            return;
        }
        setLoading(true);
        setError('');
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

        try {
            const { data: authData, error: signUpError } = await signUp(
                formData.email, formData.password, formData.name, formData.phone
            );

            if (signUpError) {
                setError(signUpError.message);
                return;
            }

            if (authData?.user) {
                // BUG_FIX: Ensure profiles insert includes full_name
                const { error: profileError } = await supabase.from('profiles').upsert({
                    id: authData.user.id,
                    full_name: formData.name.trim(), // Correct mapping
                    phone_number: formData.phone.trim(),
                    emergency_contact_name: formData.emergencyName.trim() || 'N/A',
                    emergency_contact_phone: formData.emergencyPhone.trim() || 'N/A',
                    updated_at: new Date().toISOString()
                });
                if (profileError) console.error("Profile update failed:", profileError);
            }

            setStep(2);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } catch (err: any) {
            if (err?.message?.includes("already registered as a rider") ||
                err?.message?.includes("already registered as a driver")) {
                Alert.alert(
                    "Phone Already Registered",
                    "This phone number is already linked to a G-Taxi account. " +
                    "Each phone number can only be used for one account."
                );
            } else {
                setError(err.message || 'Signup failed');
            }
        } finally {
            setLoading(false);
        }
    };

    const handleVerify = async () => {
        if (!otp) return;
        setLoading(true);
        setError('');
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

        try {
            await verifyPhoneOTP(formData.phone, otp);
            Alert.alert("Welcome!", "Your account has been verified. Welcome to G-Taxi.");
        } catch (err: any) {
            setError(err.message || 'Verification failed');
        } finally {
            setLoading(false);
        }
    };

    return (
        <View style={s.root}>
            <StatusBar style="light" />

            {/* Background: Vibrant Gradient DNA */}
            <LinearGradient
                colors={['#1A1A4A', R.bg]}
                style={StyleSheet.absoluteFill}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
            />

            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={s.container}>
                <ScrollView contentContainerStyle={[s.scroll, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 40 }]}>

                    <TouchableOpacity style={s.backBtn} onPress={() => step === 2 ? setStep(1) : navigation.goBack()}>
                        <Ionicons name="chevron-back" size={24} color="#FFF" />
                    </TouchableOpacity>

                    <View style={s.header}>
                        <Txt variant="displayXL" weight="heavy" color="#FFF">Join Us</Txt>
                        <Txt variant="bodyReg" color={R.muted} style={{ marginTop: 8 }}>Experience the future of mobility</Txt>
                    </View>

                    {step === 1 ? (
                        <Reanimated.View entering={FadeIn} exiting={FadeOut} layout={Layout} style={s.form}>
                            {error ? <Txt variant="small" color="#EF4444" style={s.error}>{error}</Txt> : null}

                            <Input label="FULL NAME" placeholder="John Doe" value={formData.name} onChange={(v: string) => setFormData({ ...formData, name: v })} />
                            <Input label="EMAIL" placeholder="john@example.com" value={formData.email} onChange={(v: string) => setFormData({ ...formData, email: v })} />
                            <Input label="PHONE" placeholder="+1 868 000 0000" value={formData.phone} onChange={(v: string) => setFormData({ ...formData, phone: v })} keyboardType="phone-pad" />
                            <Input label="PASSWORD" placeholder="••••••••" value={formData.password} onChange={(v: string) => setFormData({ ...formData, password: v })} secure />

                            <View style={s.emergency}>
                                <Txt variant="caption" weight="heavy" color={R.muted} style={{ marginBottom: 16 }}>EMERGENCY CONTACT (OPTIONAL)</Txt>
                                <Input label="CONTACT NAME" placeholder="Name" value={formData.emergencyName} onChange={(v: string) => setFormData({ ...formData, emergencyName: v })} />
                                <Input label="CONTACT PHONE" placeholder="+1 868..." value={formData.emergencyPhone} onChange={(v: string) => setFormData({ ...formData, emergencyPhone: v })} keyboardType="phone-pad" />
                            </View>

                            <View style={s.aiOptIn}>
                                <View style={{ flex: 1 }}>
                                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                        <Ionicons name="sparkles" size={16} color={R.purpleLight} />
                                        <Txt variant="small" weight="heavy" color="#FFF" style={{ marginLeft: 8 }}>AI CONCIERGE</Txt>
                                    </View>
                                    <Txt variant="caption" color={R.muted} style={{ marginTop: 4 }}>Allow G-Taxi AI to learn your music and route preferences for a premium experience.</Txt>
                                </View>
                                <TouchableOpacity 
                                    style={[s.toggle, { backgroundColor: formData.aiEnabled ? R.purple : 'rgba(255,255,255,0.1)' }]}
                                    onPress={() => {
                                        setFormData({ ...formData, aiEnabled: !formData.aiEnabled });
                                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                    }}
                                >
                                    <View style={[s.toggleDot, { marginLeft: formData.aiEnabled ? 22 : 2 }]} />
                                </TouchableOpacity>
                            </View>

                            <TouchableOpacity style={s.btn} onPress={handleNext} disabled={loading}>
                                <LinearGradient 
                                    colors={[tokens.colors.primary.purple, tokens.colors.primary.cyan]} 
                                    start={{x: 0, y: 0}} 
                                    end={{x: 1, y: 0}}
                                    style={s.btnGradient}
                                >
                                    {loading ? <ActivityIndicator color="#FFF" /> : <Txt variant="bodyBold" color="#FFF">INITIALIZE ACCOUNT</Txt>}
                                </LinearGradient>
                            </TouchableOpacity>
                        </Reanimated.View>
                    ) : (
                        <Reanimated.View entering={FadeIn} exiting={FadeOut} layout={Layout} style={s.form}>
                            <View style={s.otpHeader}>
                                <Ionicons name="chatbubble-ellipses-outline" size={48} color={R.purpleLight} />
                                <Txt variant="headingM" weight="heavy" color="#FFF" style={{ marginTop: 24 }}>Enter OTP</Txt>
                                <Txt variant="bodyReg" color={R.muted} style={{ marginTop: 8, textAlign: 'center' }}>We sent a 6-digit code to {formData.phone}</Txt>
                            </View>

                            <Input label="VERIFICATION CODE" placeholder="123456" value={otp} onChange={(v: string) => setOtp(v)} keyboardType="number-pad" />

                            <TouchableOpacity style={s.btn} onPress={handleVerify} disabled={loading}>
                                <LinearGradient colors={[R.purple, '#4C1D95']} style={s.btnGradient}>
                                    {loading ? <ActivityIndicator color="#FFF" /> : <Txt variant="bodyBold" color="#FFF">Verify Account</Txt>}
                                </LinearGradient>
                            </TouchableOpacity>
                        </Reanimated.View>
                    )}

                </ScrollView>
            </KeyboardAvoidingView>
        </View>
    );
}

function Input({ label, placeholder, value, onChange, secure, keyboardType }: any) {
    return (
        <View style={s.inputContainer}>
            <Txt variant="caption" weight="heavy" color={R.muted} style={s.label}>{label}</Txt>
            <TextInput
                style={s.input}
                placeholder={placeholder}
                placeholderTextColor="rgba(255,255,255,0.15)"
                value={value}
                onChangeText={onChange}
                secureTextEntry={secure}
                keyboardType={keyboardType}
                autoCapitalize="none"
            />
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: R.bg },
    container: { flex: 1 },
    scroll: { paddingHorizontal: 32 },
    backBtn: { width: 44, height: 44, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center', marginBottom: 20 },

    header: { marginBottom: 32 },
    form: { gap: 24 },
    error: { textAlign: 'center', marginBottom: 12 },

    inputContainer: { gap: 10 },
    label: { marginLeft: 8, opacity: 0.8 },
    input: { height: 60, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 20, paddingHorizontal: 24, color: '#FFF', fontSize: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },

    emergency: { marginTop: 12, padding: 24, backgroundColor: 'rgba(255,255,255,0.02)', borderRadius: 32, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },

    btn: { height: 64, borderRadius: 24, overflow: 'hidden', marginTop: 24, shadowColor: '#00FFFF', shadowRadius: 15, shadowOpacity: 0.3 },
    btnGradient: { flex: 1, alignItems: 'center', justifyContent: 'center' },

    otpHeader: { alignItems: 'center', marginVertical: 40 },
    
    aiOptIn: { 
        flexDirection: 'row', alignItems: 'center', padding: 20, 
        backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 24,
        borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)', marginTop: 8 
    },
    toggle: { width: 44, height: 24, borderRadius: 12, justifyContent: 'center', padding: 2 },
    toggleDot: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#FFF' },
});
