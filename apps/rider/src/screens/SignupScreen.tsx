import React, { useState } from 'react';
import {
    View, StyleSheet, TextInput, TouchableOpacity,
    KeyboardAvoidingView, Platform, ActivityIndicator,
    Dimensions, ScrollView, Alert, Image, Text
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import Reanimated, { FadeIn } from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../../../../shared/supabase';

const { width, height } = Dimensions.get('window');

// Blueberry Luxe Color System
const COLORS = {
    bgPrimary: '#0D0B1E',
    bgSecondary: '#160B32',
    gradientStart: '#1A0533',
    gradientEnd: '#0D1B4B',
    purple: '#7B5CF0',
    purpleDark: '#5B3FD0',
    cyan: '#00E5FF',
    cyanDark: '#0099BB',
    white: '#FFFFFF',
    textSecondary: 'rgba(255,255,255,0.6)',
    textMuted: 'rgba(255,255,255,0.5)',
    glassBg: 'rgba(255,255,255,0.06)',
    glassBorder: 'rgba(123,92,240,0.3)',
    glassBorderFocus: 'rgba(0,229,255,0.5)',
    error: '#FF4D6D',
};

export function SignupScreen({ navigation }: any) {
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
        aiEnabled: true,
    });

    const handleSignup = async () => {
        if (!formData.name || !formData.email || !formData.password) {
            setError('PLEASE FILL IN NAME, EMAIL AND PASSWORD');
            return;
        }
        if (formData.password.length < 6) {
            setError('PASSWORD MUST BE AT LEAST 6 CHARACTERS');
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
                    },
                },
            });

            if (signUpError) throw signUpError;
            if (!authData.user) throw new Error('Signup failed — no user returned');

            // Step 2: Save phone number to profiles table (no OTP required)
            if (formData.phone) {
                await supabase
                    .from('profiles')
                    .update({ phone: formData.phone.trim() })
                    .eq('id', authData.user.id);
            }

            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            Alert.alert(
                'Account Created',
                'Your account is ready. Please log in with your email and password.',
                [{ text: 'Sign In', onPress: () => navigation.navigate('Login') }]
            );

        } catch (err: any) {
            console.error('Signup error:', err);
            setError(err.message?.toUpperCase() || 'SIGNUP FAILED — PLEASE TRY AGAIN');
        } finally {
            setLoading(false);
        }
    };

    return (
        <View style={s.root}>
            <StatusBar style="light" />

            {/* Deep Gradient Background */}
            <LinearGradient
                colors={[COLORS.gradientStart, COLORS.gradientEnd]}
                style={StyleSheet.absoluteFillObject}
                start={{ x: 0, y: 0 }}
                end={{ x: 0, y: 1 }}
            />

            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={s.container}>
                <ScrollView
                    contentContainerStyle={[s.scroll, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 40 }]}
                    showsVerticalScrollIndicator={false}
                >

                    {/* Back Button */}
                    <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()}>
                        <Ionicons name="chevron-back" size={24} color="#FFF" />
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
                                <Reanimated.View entering={FadeIn} style={s.form}>
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

                                    {/* AI Toggle */}
                                    <View style={s.aiOptIn}>
                                        <View style={{ flex: 1 }}>
                                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                                <Ionicons name="sparkles" size={16} color={COLORS.cyan} />
                                                <Text style={s.aiLabel}>AI CONCIERGE</Text>
                                            </View>
                                            <Text style={s.aiSubtext}>Enable proactive safety & comfort</Text>
                                        </View>
                                        <TouchableOpacity
                                            style={[s.toggle, { backgroundColor: formData.aiEnabled ? COLORS.cyan : 'rgba(255,255,255,0.1)' }]}
                                            onPress={() => {
                                                setFormData({ ...formData, aiEnabled: !formData.aiEnabled });
                                                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                            }}
                                        >
                                            <View style={[s.toggleDot, { marginLeft: formData.aiEnabled ? 22 : 2 }]} />
                                        </TouchableOpacity>
                                    </View>

                                    {/* CTA Button - Cyan Gradient */}
                                    <TouchableOpacity 
                                        style={s.cyanButton}
                                        onPress={handleSignup}
                                        disabled={loading}
                                        activeOpacity={0.8}
                                    >
                                        <LinearGradient
                                            colors={[COLORS.cyan, COLORS.cyanDark]}
                                            style={s.buttonGradient}
                                            start={{ x: 0, y: 0 }}
                                            end={{ x: 1, y: 1 }}
                                        >
                                            {loading ? (
                                                <ActivityIndicator color={COLORS.bgPrimary} />
                                            ) : (
                                                <Text style={s.cyanButtonText}>Create Account</Text>
                                            )}
                                        </LinearGradient>
                                    </TouchableOpacity>

                                    {/* Login Link */}
                                    <TouchableOpacity
                                        style={s.loginLink}
                                        onPress={() => navigation.navigate('Login')}
                                    >
                                        <Text style={s.loginLinkText}>
                                            Already have an account? <Text style={s.loginLinkCyan}>Sign In</Text>
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
                    placeholderTextColor={COLORS.textMuted}
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
        backgroundColor: COLORS.bgPrimary 
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
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.1)',
        alignItems: 'center', 
        justifyContent: 'center', 
        marginBottom: 16,
        alignSelf: 'flex-start',
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
        backgroundColor: 'rgba(123,92,240,0.15)',
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
        color: COLORS.textMuted,
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
        backgroundColor: COLORS.cyan,
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
        backgroundColor: COLORS.glassBg,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: COLORS.glassBorder,
        padding: 24,
        gap: 16,
        shadowColor: COLORS.purple,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 12,
        elevation: 8,
    },

    form: { 
        gap: 16 
    },
    errorText: {
        color: COLORS.error,
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
        color: COLORS.textMuted,
        fontSize: 12,
        fontWeight: '700',
        letterSpacing: 1.5,
        textTransform: 'uppercase',
    },
    optionalTag: {
        color: COLORS.textSecondary,
        fontSize: 10,
        fontWeight: '600',
    },
    inputContainer: {
        height: 54,
        backgroundColor: 'rgba(255,255,255,0.04)',
        borderRadius: 14,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.08)',
        paddingHorizontal: 16,
        justifyContent: 'center',
    },
    inputContainerFocused: {
        borderColor: COLORS.glassBorderFocus,
        shadowColor: COLORS.cyan,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.4,
        shadowRadius: 8,
    },
    input: {
        color: COLORS.white,
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
        borderWidth: 1, 
        borderColor: 'rgba(255,255,255,0.08)', 
        marginTop: 4,
    },
    aiLabel: {
        color: COLORS.white,
        fontSize: 13,
        fontWeight: '700',
        marginLeft: 8,
        letterSpacing: 0.5,
    },
    aiSubtext: {
        color: COLORS.textMuted,
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
        backgroundColor: '#FFF',
        shadowColor: 'rgba(0,0,0,0.3)',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.3,
        shadowRadius: 2,
    },

    // Cyan Button
    cyanButton: {
        height: 56,
        borderRadius: 16,
        overflow: 'hidden',
        shadowColor: COLORS.cyan,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.5,
        shadowRadius: 16,
        elevation: 10,
        marginTop: 4,
    },
    buttonGradient: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    cyanButtonText: {
        color: COLORS.bgPrimary,
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
        color: COLORS.textSecondary,
        fontSize: 14,
        fontWeight: '500',
    },
    loginLinkCyan: {
        color: COLORS.cyan,
        fontWeight: '700',
    },
});
