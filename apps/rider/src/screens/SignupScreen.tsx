import React, { useState } from 'react';
import {
    View, StyleSheet, TextInput, TouchableOpacity,
    KeyboardAvoidingView, Platform, ActivityIndicator,
    useWindowDimensions, ScrollView, Alert, Image, Text, Linking
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import Reanimated, { FadeIn } from 'react-native-reanimated';
import { TERMS_VERSION, LEGAL_DOCUMENTS } from '@gtaxi/shared/legal';
import { savePendingSignup } from '@gtaxi/shared/pendingSignup';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { supabase } from '@gtaxi/core';
import { SURFACE, VOICES, ANIMATION } from '@gtaxi/design-system';
import { ghostBorder, elevationGlow } from '@gtaxi/design-system/utils/style-rules';

export function SignupScreen({ navigation }: any) {
    const { width, height } = useWindowDimensions();
    const { signUp } = useAuth();
    const insets = useSafeAreaInsets();

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [focusedField, setFocusedField] = useState<string | null>(null);

    const [formData, setFormData] = useState({
        name: '',
        email: '',
        phone: '',
        password: '',
        referralCode: '',
        commanderCode: '',
        aiEnabled: true,
        termsAccepted: false,
    });

    const handleSignup = async () => {
        if (!formData.termsAccepted) {
            setError('Please accept the terms of service to continue.');
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            return;
        }
        if (!formData.name || !formData.email || !formData.password) {
            setError('Please fill in your name, email, and password.');
            return;
        }
        if (formData.password.length < 6) {
            setError('Password must be at least 6 characters.');
            return;
        }

        setLoading(true);
        setError('');
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

        try {
            // Step 1: Create the auth account with email + password
            const { data: authData, error: signUpError } = await supabase.auth.signUp({
                email: formData.email.trim().toLowerCase(),
                password: formData.password,
                options: {
                    data: {
                        full_name: formData.name.trim(),
                        role: 'rider',
                        terms_accepted: true,
                        terms_accepted_at: new Date().toISOString(),
                    },
                },
            });

            if (signUpError) throw signUpError;
            if (!authData.user) throw new Error('Signup failed — no user returned');

            // Step 2: Save phone number to profiles table (no OTP required)
            if (formData.phone) {
                await supabase
                    .from('profiles')
                    .update({ phone_number: formData.phone.trim() })
                    .eq('id', authData.user.id);
            }

            // Step 2b: Record the terms acceptance as real evidence.
            //
            // The flags passed into signUp's options.data land in
            // raw_user_meta_data, which is USER-WRITABLE (any rider can call
            // auth.updateUser and set their own terms_accepted). That is not
            // proof. Verified live: 0 of 10 existing users carried the flag
            // at all, so there was no record of anyone accepting anything.
            //
            // record_consent writes to the append-only user_consents ledger
            // and takes the user id from auth.uid(), never from the client.
            // Needs a session, so it is skipped when email confirmation is
            // pending — same constraint as the commander code below.
            if (authData.session) {
                try {
                    await supabase.rpc('record_consent', {
                        p_document: LEGAL_DOCUMENTS.TERMS,
                        p_version: TERMS_VERSION,
                        p_user_agent: Platform.OS,
                    });
                } catch (e) {
                    // Do not block signup on the ledger write, but make the
                    // gap visible rather than silent.
                    console.warn('[Signup] consent not recorded:', e);
                }
            } else {
                // Email confirmation is on, so there is no session yet and
                // auth.uid() is null — record_consent and apply_commander_code
                // would both be rejected. Park them; AuthContext flushes on the
                // first real sign-in. Previously both were simply dropped and
                // never retried.
                await savePendingSignup(AsyncStorage, {
                    forUserId: authData.user.id,
                    consent: {
                        document: LEGAL_DOCUMENTS.TERMS,
                        version: TERMS_VERSION,
                        userAgent: Platform.OS,
                    },
                    commanderCode: formData.commanderCode.trim() || undefined,
                });
            }

            // Step 3: Apply referral code if provided — TTD $15 credit for both parties
            if (formData.referralCode.trim()) {
                try {
                    await supabase.rpc('apply_referral_code', {
                        p_referee_id: authData.user.id,
                        p_code: formData.referralCode.trim().toUpperCase(),
                        p_type: 'rider',
                    });
                } catch { /* non-fatal — bonus is a perk, not a requirement */ }
            }

            // Step 4: Link to a G-Lead's territory if a commander code was entered.
            // Requires an active session — apply_commander_code reads auth.uid().
            // If email confirmation is required (no session yet), this is silently
            // skipped; nothing in this repo re-prompts for it post-verification.
            if (formData.commanderCode.trim() && authData.session) {
                try {
                    await supabase.rpc('apply_commander_code', {
                        p_code: formData.commanderCode.trim(),
                    });
                } catch { /* non-fatal — territory linking is a bonus, not a requirement */ }
            }

            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            if (!authData.session) {
                Alert.alert(
                    'Check Your Email',
                    'We sent a verification link. Please check your inbox.\n\nDidn\'t get the code?',
                    [
                        { text: 'Verify via WhatsApp', onPress: () => Linking.openURL('https://wa.me/18687031000?text=VERIFY_ACCOUNT_' + encodeURIComponent(formData.email)) },
                        { text: 'Sign In', onPress: () => navigation.navigate('Login') }
                    ]
                );
            } else {
                Alert.alert(
                    'Account Created',
                    'Your account is ready. Please log in with your email and password.',
                    [{ text: 'Sign In', onPress: () => navigation.navigate('Login') }]
                );
            }

        } catch (err: any) {

            setError(err.message || 'Signup failed. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <View style={s.root}>
            <StatusBar style="light" />

            {/* Deep Gradient Background */}
            <LinearGradient
                colors={['#1A0533', '#0D1B4B']}
                style={StyleSheet.absoluteFillObject}
                start={{ x: 0, y: 0 }}
                end={{ x: 0, y: 1 }}
            />

            <KeyboardAvoidingView behavior="padding" enabled={Platform.OS === 'ios'} style={s.container}>
                <ScrollView
                    contentContainerStyle={[s.scroll, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 40 }]}
                    showsVerticalScrollIndicator={false}
                >

                    {/* Back Button */}
                    <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()}>
                        <Ionicons name="chevron-back" size={24} color={'#EAF3F6'} />
                    </TouchableOpacity>

                    {/* Logo Section */}
                    <View style={s.logoSection}>
                        <View style={s.logoGlow} />
                        <Image 
                            source={require('../../assets/logo.png')} 
                            style={s.logo}
                            resizeMode="contain"
                        />
                    </View>

                    {/* Progress Indicator */}
                    <View style={s.progressContainer}>
                        <Text style={s.progressText}>Step 1 of 1</Text>
                        <View style={s.progressBar}>
                            <View style={s.progressFill} />
                        </View>
                    </View>

                    {/* Glass Card - Signup Form */}
                    <View style={s.cardContainer}>
                        <BlurView intensity={20} tint="dark" style={s.blurBacking}>
                            <View style={s.glassCard}>
                                <Reanimated.View entering={FadeIn.springify().mass(ANIMATION.spring.mass).stiffness(ANIMATION.spring.stiffness).damping(ANIMATION.spring.damping)} style={s.form}>
                                    {error ? (
                                        <Text style={s.errorText}>{error}</Text>
                                    ) : null}

                                    <Input
                                        label="FULL NAME"
                                        placeholder="John Doe"
                                        value={formData.name}
                                        onChange={(v: string) => setFormData({ ...formData, name: v })}
                                        isFocused={focusedField === 'name'}
                                        onFocus={() => setFocusedField('name')}
                                        onBlur={() => setFocusedField(null)}
                                    />
                                    <Input
                                        label="EMAIL"
                                        placeholder="you@email.com"
                                        value={formData.email}
                                        onChange={(v: string) => setFormData({ ...formData, email: v })}
                                        keyboardType="email-address"
                                        isFocused={focusedField === 'email'}
                                        onFocus={() => setFocusedField('email')}
                                        onBlur={() => setFocusedField(null)}
                                    />
                                    <Input
                                        label="PHONE"
                                        placeholder="+1 868 000 0000"
                                        value={formData.phone}
                                        onChange={(v: string) => setFormData({ ...formData, phone: v })}
                                        keyboardType="phone-pad"
                                        isFocused={focusedField === 'phone'}
                                        onFocus={() => setFocusedField('phone')}
                                        onBlur={() => setFocusedField(null)}
                                        optional
                                    />
                                    <Input
                                        label="PASSWORD"
                                        placeholder="••••••••"
                                        value={formData.password}
                                        onChange={(v: string) => setFormData({ ...formData, password: v })}
                                        secure
                                        isFocused={focusedField === 'password'}
                                        onFocus={() => setFocusedField('password')}
                                        onBlur={() => setFocusedField(null)}
                                    />
                                    <Input
                                        label="REFERRAL CODE"
                                        placeholder="e.g. ABC123"
                                        value={formData.referralCode}
                                        onChange={(v: string) => setFormData({ ...formData, referralCode: v })}
                                        isFocused={focusedField === 'referral'}
                                        onFocus={() => setFocusedField('referral')}
                                        onBlur={() => setFocusedField(null)}
                                        optional
                                    />
                                    <Input
                                        label="G-LEAD CODE"
                                        placeholder="Got a code from your G-Lead?"
                                        value={formData.commanderCode}
                                        onChange={(v: string) => setFormData({ ...formData, commanderCode: v })}
                                        isFocused={focusedField === 'commander'}
                                        onFocus={() => setFocusedField('commander')}
                                        onBlur={() => setFocusedField(null)}
                                        optional
                                    />

                                    {/* AI Toggle */}
                                    <View style={s.aiOptIn}>
                                        <View style={{ flex: 1 }}>
                                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                                <Ionicons name="star" size={16} color={VOICES.rider.accent} />
                                                <Text style={s.aiLabel}>AI assistant</Text>
                                            </View>
                                            <Text style={s.aiSubtext}>Enable proactive safety & comfort</Text>
                                        </View>
                                        <TouchableOpacity
                                            style={[s.toggle, { backgroundColor: formData.aiEnabled ? VOICES.rider.accent : 'rgba(255,255,255,0.1)' }]}
                                            onPress={() => {
                                                setFormData({ ...formData, aiEnabled: !formData.aiEnabled });
                                                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                            }}
                                        >
                                            <View style={[s.toggleDot, { marginLeft: formData.aiEnabled ? 22 : 2 }]} />
                                        </TouchableOpacity>
                                    </View>

                                    {/* Terms Checkbox */}
                                    <TouchableOpacity
                                        style={s.termsRow}
                                        onPress={() => {
                                            setFormData({ ...formData, termsAccepted: !formData.termsAccepted });
                                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                        }}
                                    >
                                        <View style={[s.checkbox, formData.termsAccepted && s.checkboxActive]}>
                                            {formData.termsAccepted && <Ionicons name="checkmark" size={14} color="#EAF3F6" />}
                                        </View>
                                        <Text style={s.termsText}>
                                            I accept the{' '}
                                            <Text style={s.termsLink} onPress={() => Linking.openURL('https://gtaxi.tt/legal/terms')}>
                                                Terms of Service
                                            </Text>
                                            {' '}and{' '}
                                            <Text style={s.termsLink} onPress={() => Linking.openURL('https://gtaxi.tt/legal/privacy')}>
                                                Privacy Policy
                                            </Text>
                                        </Text>
                                    </TouchableOpacity>

                                    {/* CTA Button */}
                                    <TouchableOpacity 
                                        style={s.primaryButton}
                                        onPress={handleSignup}
                                        disabled={loading}
                                        activeOpacity={0.8}
                                    >
                                        <LinearGradient
                                            colors={[VOICES.rider.accent, VOICES.rider.accentDark]}
                                            style={s.buttonGradient}
                                            start={{ x: 0, y: 0 }}
                                            end={{ x: 1, y: 1 }}
                                        >
                                            {loading ? (
                                                <ActivityIndicator color={SURFACE.base} />
                                            ) : (
                                                <Text style={s.primaryButtonText}>Create Account</Text>
                                            )}
                                        </LinearGradient>
                                    </TouchableOpacity>

                                    {/* Login Link */}
                                    <TouchableOpacity
                                        style={s.loginLink}
                                        onPress={() => navigation.navigate('Login')}
                                    >
                                        <Text style={s.loginLinkText}>
                                            Already have an account? <Text style={s.loginLinkAccent}>Sign In</Text>
                                        </Text>
                                    </TouchableOpacity>

                                </Reanimated.View>
                            </View>
                        </BlurView>
                    </View>

                </ScrollView>
            </KeyboardAvoidingView>
        </View>
    );
}

function Input({ label, placeholder, value, onChange, secure, keyboardType, isFocused, onFocus, onBlur, optional }: any) {
    return (
        <View style={s.inputWrapper}>
            <View style={s.labelRow}>
                <Text style={s.label}>{label}</Text>
                {optional && <Text style={s.optionalTag}>(Optional)</Text>}
            </View>
            <View style={[s.inputContainer, isFocused && s.inputContainerFocused]}>
                <TextInput
                    style={s.input}
                    placeholder={placeholder}
                    placeholderTextColor={'rgba(255,255,255,0.6)'}
                    value={value}
                    onChangeText={onChange}
                    secureTextEntry={secure}
                    keyboardType={keyboardType}
                    autoCapitalize="none"
                    onFocus={onFocus}
                    onBlur={onBlur}
                />
            </View>
        </View>
    );
}

const s = StyleSheet.create({
    root: { 
        flex: 1, 
        backgroundColor: SURFACE.base 
    },
    container: { 
        flex: 1 
    },
    scroll: { 
        paddingHorizontal: 28 
    },
    backBtn: {
        width: 44, 
        height: 44, 
        borderRadius: 14,
        backgroundColor: 'rgba(255,255,255,0.05)',
        alignItems: 'center', 
        justifyContent: 'center', 
        marginBottom: 16,
        alignSelf: 'flex-start',
        ...ghostBorder(0.15),
    },

    // Logo Section
    logoSection: {
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 20,
        height: 140,
    },
    logoGlow: {
        position: 'absolute',
        width: 200,
        height: 200,
        borderRadius: 100,
        backgroundColor: VOICES.rider.accent + '26',
    },
    logo: {
        width: 140,
        height: 140,
    },

    // Progress Indicator
    progressContainer: {
        marginBottom: 24,
        alignItems: 'center',
    },
    progressText: {
        color: 'rgba(255,255,255,0.6)',
        fontSize: 12,
        fontWeight: '700',
        letterSpacing: 1.5,
        textTransform: 'uppercase',
        marginBottom: 8,
    },
    progressBar: {
        width: 120,
        height: 4,
        backgroundColor: 'rgba(255,255,255,0.1)',
        borderRadius: 2,
        overflow: 'hidden',
    },
    progressFill: {
        width: '100%',
        height: '100%',
        backgroundColor: VOICES.rider.accent,
    },

    // Card Container
    cardContainer: {
        width: '100%',
        marginBottom: 24,
    },
    blurBacking: {
        borderRadius: 20,
        overflow: 'hidden',
    },
    glassCard: {
        backgroundColor: SURFACE.containerLow,
        borderRadius: 20,
        padding: 24,
        gap: 16,
        ...ghostBorder(0.15),
    },

    form: { 
        gap: 16 
    },
    errorText: {
        color: '#FF4D4D',
        fontSize: 14,
        fontWeight: '600',
        textAlign: 'center',
        marginBottom: 4,
    },

    // Input
    inputWrapper: {
        gap: 6,
    },
    labelRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    label: {
        color: 'rgba(255,255,255,0.6)',
        fontSize: 12,
        fontWeight: '700',
        letterSpacing: 1.5,
        textTransform: 'uppercase',
    },
    optionalTag: {
        color: 'rgba(255,255,255,0.6)',
        fontSize: 10,
        fontWeight: '600',
    },
    inputContainer: {
        height: 54,
        backgroundColor: 'rgba(255,255,255,0.04)',
        borderRadius: 14,
        paddingHorizontal: 16,
        justifyContent: 'center',
    },
    inputContainerFocused: {
        ...elevationGlow(),
    },
    input: {
        color: '#EAF3F6',
        fontSize: 15,
        fontWeight: '500',
    },

    // AI Toggle
    aiOptIn: {
        flexDirection: 'row', 
        alignItems: 'center', 
        padding: 16,
        backgroundColor: 'rgba(255,255,255,0.03)', 
        borderRadius: 16,
        marginTop: 4,
        ...ghostBorder(0.15),
    },
    aiLabel: {
        color: '#EAF3F6',
        fontSize: 13,
        fontWeight: '700',
        marginLeft: 8,
        letterSpacing: 0.5,
    },
    aiSubtext: {
        color: 'rgba(255,255,255,0.6)',
        fontSize: 12,
        fontWeight: '500',
        marginTop: 2,
        marginLeft: 24,
    },
    toggle: { 
        width: 44, 
        height: 24, 
        borderRadius: 12, 
        justifyContent: 'center', 
        padding: 2 
    },
    toggleDot: { 
        width: 20, 
        height: 20, 
        borderRadius: 10, 
        backgroundColor: '#EAF3F6',
        ...elevationGlow(),
    },

    // Cyan Button
    primaryButton: {
        height: 56,
        borderRadius: 16,
        overflow: 'hidden',
        ...elevationGlow(10),
        marginTop: 4,
    },
    buttonGradient: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    primaryButtonText: {
        color: SURFACE.base,
        fontSize: 17,
        fontWeight: '800',
        letterSpacing: 0.5,
    },

    // Login Link
    loginLink: { 
        marginTop: 8,
        alignItems: 'center',
    },
    loginLinkText: {
        color: 'rgba(255,255,255,0.6)',
        fontSize: 14,
        fontWeight: '500',
    },
    loginLinkAccent: {
        color: VOICES.rider.accent,
        fontWeight: '700',
    },

    // Terms Checkbox
    termsRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 4,
    },
    checkbox: {
        width: 24,
        height: 24,
        borderRadius: 6,
        borderWidth: 2,
        borderColor: 'rgba(255,255,255,0.6)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    checkboxActive: {
        backgroundColor: VOICES.rider.accent,
        borderColor: VOICES.rider.accent,
    },
    termsText: {
        flex: 1,
        color: 'rgba(255,255,255,0.6)',
        fontSize: 13,
        fontWeight: '500',
    },
    termsLink: {
        color: VOICES.rider.accent,
        fontWeight: '700',
    },
});
