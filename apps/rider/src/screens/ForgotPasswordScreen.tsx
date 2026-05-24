import React, { useState } from 'react';
import {
    View, StyleSheet, TextInput, TouchableOpacity,
    KeyboardAvoidingView, Platform, ActivityIndicator,
    useWindowDimensions, Text, Alert
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import Reanimated, { FadeIn } from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import { supabase } from '@gtaxi/core';
import { Ionicons } from '@expo/vector-icons';
import { SURFACE, VOICES, ANIMATION } from '@gtaxi/design-system';
import { ghostBorder, elevationGlow } from '@gtaxi/design-system/utils/style-rules';

export function ForgotPasswordScreen({ navigation }: any) {
    const { width, height } = useWindowDimensions();
    const insets = useSafeAreaInsets();
    const [email, setEmail] = useState('');
    const [loading, setLoading] = useState(false);
    const [sent, setSent] = useState(false);
    const [emailFocused, setEmailFocused] = useState(false);

    const handleReset = async () => {
        if (!email || !email.includes('@')) {
            Alert.alert('Invalid Email', 'Please enter a valid email address');
            return;
        }

        setLoading(true);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

        try {
            const { error } = await supabase.auth.resetPasswordForEmail(email, {
                redirectTo: 'gtaxi://reset-password',
            });

            if (error) {
                Alert.alert('Error', error.message);
            } else {
                setSent(true);
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            }
        } catch (err: any) {
            Alert.alert('Error', err.message || 'Failed to send reset email');
        } finally {
            setLoading(false);
        }
    };

    return (
        <View style={s.root}>
            <StatusBar style="light" />

            <LinearGradient
                colors={['#1A0533', '#0D1B4B']}
                style={StyleSheet.absoluteFillObject}
                start={{ x: 0, y: 0 }}
                end={{ x: 0, y: 1 }}
            />

            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                style={s.container}
            >
                <Reanimated.View entering={FadeIn.springify().mass(ANIMATION.spring.mass).stiffness(ANIMATION.spring.stiffness).damping(ANIMATION.spring.damping)} style={[s.content, { paddingTop: height * 0.12 }]}>

                    {/* Back Button */}
                    <TouchableOpacity
                        style={[s.backBtn, { top: insets.top + 12 }]}
                        onPress={() => navigation.goBack()}
                    >
                        <Ionicons name="chevron-back" size={28} color="#FFF" />
                    </TouchableOpacity>

                    {/* Header Section */}
                    <View style={s.headerSection}>
                        <View style={s.iconCircle}>
                            <Ionicons name="lock-open-outline" size={32} color={VOICES.rider.accent} />
                        </View>
                        <Text style={s.title}>Reset Password</Text>
                        <Text style={s.subtitle}>
                            Enter your email and we'll send you a link to reset your password
                        </Text>
                    </View>

                    {/* Glass Card */}
                    <View style={s.cardContainer}>
                        <BlurView intensity={20} tint="dark" style={s.blurBacking}>
                            <View style={s.glassCard}>
                                {sent ? (
                                    <View style={s.successContainer}>
                                        <View style={s.successIcon}>
                                            <Ionicons name="mail-outline" size={40} color={'#00FF94'} />
                                        </View>
                                        <Text style={s.successTitle}>Check Your Email</Text>
                                        <Text style={s.successText}>
                                            We've sent a password reset link to{'\n'}
                                            <Text style={s.emailHighlight}>{email}</Text>
                                        </Text>
                                        <TouchableOpacity
                                            style={s.backToLoginBtn}
                                            onPress={() => navigation.navigate('Login')}
                                        >
                                            <LinearGradient
                                                colors={[VOICES.rider.accent, VOICES.rider.accentDark]}
                                                style={s.buttonGradient}
                                                start={{ x: 0, y: 0 }}
                                                end={{ x: 1, y: 1 }}
                                            >
                                                <Text style={s.buttonText}>Back to Login</Text>
                                            </LinearGradient>
                                        </TouchableOpacity>
                                    </View>
                                ) : (
                                    <>
                                        {/* Email Input */}
                                        <View style={s.inputWrapper}>
                                            <Text style={s.label}>EMAIL</Text>
                                            <View style={[
                                                s.inputContainer,
                                                emailFocused && s.inputContainerFocused
                                            ]}>
                                                <TextInput
                                                    style={s.input}
                                                    placeholder="you@email.com"
                                                    placeholderTextColor={'rgba(255,255,255,0.6)'}
                                                    value={email}
                                                    onChangeText={setEmail}
                                                    autoCapitalize="none"
                                                    keyboardType="email-address"
                                                    onFocus={() => setEmailFocused(true)}
                                                    onBlur={() => setEmailFocused(false)}
                                                    autoFocus
                                                />
                                            </View>
                                        </View>

                                        {/* Reset Button */}
                                        <TouchableOpacity
                                            style={s.primaryButton}
                                            onPress={handleReset}
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
                                                    <ActivityIndicator color="#FFF" />
                                                ) : (
                                                    <Text style={s.buttonText}>Send Reset Link</Text>
                                                )}
                                            </LinearGradient>
                                        </TouchableOpacity>

                                        {/* Back Link */}
                                        <TouchableOpacity
                                            style={s.linkContainer}
                                            onPress={() => navigation.goBack()}
                                        >
                                            <Text style={s.linkText}>
                                                Remember your password? <Text style={s.linkTextAccent}>Sign In</Text>
                                            </Text>
                                        </TouchableOpacity>
                                    </>
                                )}
                            </View>
                        </BlurView>
                    </View>

                </Reanimated.View>
            </KeyboardAvoidingView>
        </View>
    );
}

const s = StyleSheet.create({
    root: {
        flex: 1,
        backgroundColor: SURFACE.base,
    },
    container: {
        flex: 1,
    },
    content: {
        flex: 1,
        paddingHorizontal: 28,
        paddingBottom: 20,
    },
    backBtn: {
        position: 'absolute',
        left: 20,
        zIndex: 100,
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: 'rgba(255,255,255,0.1)',
        justifyContent: 'center',
        alignItems: 'center',
    },

    // Header
    headerSection: {
        alignItems: 'center',
        marginBottom: 40,
    },
    iconCircle: {
        width: 80,
        height: 80,
        borderRadius: 40,
        backgroundColor: VOICES.rider.accent + '1A',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 24,
        ...ghostBorder(0.15),
    },
    title: {
        fontSize: 28,
        fontWeight: '800',
        color: '#FFF',
        marginBottom: 12,
        letterSpacing: 0.5,
    },
    subtitle: {
        fontSize: 14,
        color: 'rgba(255,255,255,0.6)',
        textAlign: 'center',
        lineHeight: 20,
        paddingHorizontal: 20,
    },

    // Card
    cardContainer: {
        width: '100%',
    },
    blurBacking: {
        borderRadius: 20,
        overflow: 'hidden',
    },
    glassCard: {
        backgroundColor: SURFACE.containerLow,
        borderRadius: 20,
        padding: 24,
        ...ghostBorder(0.15),
    },

    // Success State
    successContainer: {
        alignItems: 'center',
        paddingVertical: 20,
    },
    successIcon: {
        width: 80,
        height: 80,
        borderRadius: 40,
        backgroundColor: 'rgba(0,255,148,0.1)',
        ...ghostBorder(0.3),
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 24,
    },
    successTitle: {
        fontSize: 22,
        fontWeight: '800',
        color: '#FFF',
        marginBottom: 12,
    },
    successText: {
        fontSize: 14,
        color: 'rgba(255,255,255,0.6)',
        textAlign: 'center',
        lineHeight: 20,
        marginBottom: 32,
    },
    emailHighlight: {
        color: VOICES.rider.accent,
        fontWeight: '700',
    },
    backToLoginBtn: {
        width: '100%',
        height: 52,
        borderRadius: 12,
        overflow: 'hidden',
    },

    // Input
    inputWrapper: {
        marginBottom: 20,
    },
    label: {
        fontSize: 11,
        fontWeight: '700',
        color: VOICES.rider.accent,
        marginBottom: 8,
        letterSpacing: 1,
    },
    inputContainer: {
        backgroundColor: 'rgba(255,255,255,0.04)',
        borderRadius: 12,
        paddingHorizontal: 16,
        height: 52,
        justifyContent: 'center',
    },
    inputContainerFocused: {
        backgroundColor: 'rgba(255,255,255,0.08)',
    },
    input: {
        color: '#FFF',
        fontSize: 15,
        fontWeight: '500',
    },

    // Button
    primaryButton: {
        width: '100%',
        height: 52,
        borderRadius: 12,
        overflow: 'hidden',
        marginTop: 8,
    },
    buttonGradient: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    buttonText: {
        color: '#FFF',
        fontSize: 15,
        fontWeight: '700',
        letterSpacing: 0.5,
    },

    // Link
    linkContainer: {
        marginTop: 20,
        alignItems: 'center',
    },
    linkText: {
        fontSize: 13,
        color: 'rgba(255,255,255,0.6)',
    },
    linkTextAccent: {
        color: VOICES.rider.accent,
        fontWeight: '700',
    },
});
