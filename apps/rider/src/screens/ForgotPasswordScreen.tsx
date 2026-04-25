import React, { useState } from 'react';
import {
    View, StyleSheet, TextInput, TouchableOpacity,
    KeyboardAvoidingView, Platform, ActivityIndicator,
    Dimensions, Image, Text, Alert
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import Reanimated, { FadeIn } from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import { supabase } from '../../../../shared/supabase';
import { Ionicons } from '@expo/vector-icons';

const { width, height } = Dimensions.get('window');

const COLORS = {
    bgPrimary: '#0D0B1E',
    bgSecondary: '#160B32',
    gradientStart: '#1A0533',
    gradientEnd: '#0D1B4B',
    purple: '#7B5CF0',
    purpleDark: '#5B3FD0',
    purpleLight: '#9B7CF0',
    cyan: '#00E5FF',
    cyanDark: '#0099BB',
    white: '#FFFFFF',
    textSecondary: 'rgba(255,255,255,0.6)',
    textMuted: 'rgba(255,255,255,0.5)',
    glassBg: 'rgba(255,255,255,0.06)',
    glassBorder: 'rgba(123,92,240,0.3)',
    glassBorderFocus: 'rgba(0,229,255,0.5)',
    success: '#00FF94',
    error: '#FF4D6D',
};

export function ForgotPasswordScreen({ navigation }: any) {
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
                colors={[COLORS.gradientStart, COLORS.gradientEnd]}
                style={StyleSheet.absoluteFillObject}
                start={{ x: 0, y: 0 }}
                end={{ x: 0, y: 1 }}
            />

            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                style={s.container}
            >
                <Reanimated.View entering={FadeIn.duration(1000)} style={s.content}>

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
                            <Ionicons name="lock-open-outline" size={32} color={COLORS.cyan} />
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
                                            <Ionicons name="mail-outline" size={40} color={COLORS.success} />
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
                                                colors={[COLORS.purple, COLORS.purpleDark]}
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
                                                    placeholderTextColor={COLORS.textMuted}
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
                                                colors={[COLORS.purple, COLORS.purpleDark]}
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
                                                Remember your password? <Text style={s.linkTextCyan}>Sign In</Text>
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
        backgroundColor: COLORS.bgPrimary,
    },
    container: {
        flex: 1,
    },
    content: {
        flex: 1,
        paddingHorizontal: 28,
        paddingTop: height * 0.12,
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
        backgroundColor: 'rgba(0,229,255,0.1)',
        borderWidth: 1,
        borderColor: 'rgba(0,229,255,0.3)',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 24,
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
        color: COLORS.textSecondary,
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
        backgroundColor: 'rgba(22,11,50,0.6)',
        borderRadius: 20,
        borderWidth: 1,
        borderColor: COLORS.glassBorder,
        padding: 24,
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
        borderWidth: 1,
        borderColor: 'rgba(0,255,148,0.3)',
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
        color: COLORS.textSecondary,
        textAlign: 'center',
        lineHeight: 20,
        marginBottom: 32,
    },
    emailHighlight: {
        color: COLORS.cyan,
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
        color: COLORS.cyan,
        marginBottom: 8,
        letterSpacing: 1,
    },
    inputContainer: {
        backgroundColor: COLORS.glassBg,
        borderWidth: 1,
        borderColor: COLORS.glassBorder,
        borderRadius: 12,
        paddingHorizontal: 16,
        height: 52,
        justifyContent: 'center',
    },
    inputContainerFocused: {
        borderColor: COLORS.glassBorderFocus,
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
        color: COLORS.textSecondary,
    },
    linkTextCyan: {
        color: COLORS.cyan,
        fontWeight: '700',
    },
});
