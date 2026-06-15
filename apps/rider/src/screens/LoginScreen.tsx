import React, { useState, useEffect } from 'react';
import {
    View, StyleSheet, TextInput, TouchableOpacity,
    KeyboardAvoidingView, Platform, ActivityIndicator,
    useWindowDimensions, Image, Text
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import Reanimated, {
    useSharedValue, useAnimatedStyle, withRepeat,
    withTiming, withSequence, FadeIn
} from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import { useAuth } from '../context/AuthContext';
import { SURFACE, VOICES, ANIMATION } from '@gtaxi/design-system';
import { ghostBorder, elevationGlow } from '@gtaxi/design-system/utils/style-rules';

export function LoginScreen({ navigation }: any) {
    const { width, height } = useWindowDimensions();
    const { signIn } = useAuth();
    const insets = useSafeAreaInsets();

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [emailFocused, setEmailFocused] = useState(false);
    const [passwordFocused, setPasswordFocused] = useState(false);

    const logoScale = useSharedValue(1);
    const glowPulse = useSharedValue(0);

    useEffect(() => {
        logoScale.value = withRepeat(
            withSequence(
                withTiming(1.05, { duration: 2000 }),
                withTiming(1, { duration: 2000 })
            ),
            -1, true
        );
        
        glowPulse.value = withRepeat(
            withSequence(
                withTiming(1, { duration: 1500 }),
                withTiming(0.6, { duration: 1500 })
            ),
            -1, true
        );
    }, []);

    const animatedLogoStyle = useAnimatedStyle(() => ({
        transform: [{ scale: logoScale.value }]
    }));

    const animatedGlowStyle = useAnimatedStyle(() => ({
        opacity: glowPulse.value,
        transform: [{ scale: 1 + (1 - glowPulse.value) * 0.1 }]
    }));

    const handleLogin = async () => {
        if (!email || !password) {
            setError('Enter your email and password');
            return;
        }
        setLoading(true);
        setError('');
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

        try {
            const { data, error: signInError } = await signIn(email, password);
            if (signInError) {
                setError(signInError.message);
            } else if (data?.user && !data.user.email_confirmed_at) {
                setError('EMAIL NOT VERIFIED — Check your inbox or verify via WhatsApp below');
            }
        } catch (err: any) {
            setError(err.message || 'Login failed');
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

            <KeyboardAvoidingView
                behavior="padding"
                enabled={Platform.OS === 'ios'}
                style={s.container}
            >
                <Reanimated.View entering={FadeIn.springify().mass(ANIMATION.spring.mass).stiffness(ANIMATION.spring.stiffness).damping(ANIMATION.spring.damping)} style={[s.content, { paddingTop: height * 0.08 }]}>

                    {/* Logo Section - Top Third */}
                    <View style={s.logoSection}>
                        {/* Purple Glow Behind Logo */}
                        <Reanimated.View style={[s.logoGlow, animatedGlowStyle]} />
                        
                        {/* Logo Image */}
                        <Reanimated.View style={[s.logoContainer, animatedLogoStyle]}>
                            <Image 
                                source={require('../../assets/logo.png')} 
                                style={s.logo}
                                resizeMode="contain"
                            />
                        </Reanimated.View>
                    </View>

                    {/* Glass Card - Login Form */}
                    <View style={s.cardContainer}>
                        <BlurView intensity={20} tint="dark" style={s.blurBacking}>
                            <View style={s.glassCard}>
                                {error ? (
                                    <Text style={s.errorText}>{error}</Text>
                                ) : null}

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
                                        />
                                    </View>
                                </View>

                                {/* Password Input */}
                                <View style={s.inputWrapper}>
                                    <Text style={s.label}>PASSWORD</Text>
                                    <View style={[
                                        s.inputContainer,
                                        passwordFocused && s.inputContainerFocused
                                    ]}>
                                        <TextInput
                                            style={s.input}
                                            placeholder="••••••••"
                                            placeholderTextColor={'rgba(255,255,255,0.6)'}
                                            value={password}
                                            onChangeText={setPassword}
                                            secureTextEntry
                                            onFocus={() => setPasswordFocused(true)}
                                            onBlur={() => setPasswordFocused(false)}
                                        />
                                    </View>
                                </View>

                                {/* Primary CTA Button */}
                                <TouchableOpacity
                                    style={s.primaryButton}
                                    onPress={handleLogin}
                                    disabled={loading}
                                    activeOpacity={0.8}
                                    accessibilityLabel="Sign in"
                                    accessibilityRole="button"
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
                                            <Text style={s.buttonText}>Sign In</Text>
                                        )}
                                    </LinearGradient>
                                </TouchableOpacity>

                                {/* Forgot Password Link */}
                                <TouchableOpacity
                                    style={[s.linkContainer, { marginTop: 16 }]}
                                    onPress={() => {
                                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                        navigation.navigate('ForgotPassword');
                                    }}
                                    accessibilityLabel="Reset your password"
                                    accessibilityRole="button"
                                >
                                    <Text style={s.linkText}>
                                        Forgot password? <Text style={s.linkTextAccent}>Reset</Text>
                                    </Text>
                                </TouchableOpacity>

                                {/* Create Account Link */}
                                <TouchableOpacity
                                    style={[s.linkContainer, { marginTop: 20 }]}
                                    onPress={() => {
                                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                        navigation.navigate('Signup');
                                    }}
                                    accessibilityLabel="Create a new account"
                                    accessibilityRole="button"
                                >
                                    <Text style={s.linkText}>
                                        Don't have an account? <Text style={s.linkTextAccent}>Create Account</Text>
                                    </Text>
                                </TouchableOpacity>
                            </View>
                        </BlurView>
                    </View>

                    {/* Brand Watermark */}
                    <View style={s.watermarkContainer}>
                        <Text style={s.watermarkText}>G-TAXI</Text>
                        <Text style={s.watermarkSubtext}>EMPIRE</Text>
                    </View>

                </Reanimated.View>
            </KeyboardAvoidingView>
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
    content: { 
        flex: 1, 
        paddingHorizontal: 28,
        paddingBottom: 20
    },

    // Logo Section
    logoSection: {
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 32,
        height: 240,
    },
    logoGlow: {
        position: 'absolute',
        width: 300,
        height: 300,
        borderRadius: 150,
        backgroundColor: VOICES.rider.accent + '26',
        alignSelf: 'center',
    },
    logoContainer: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    logo: {
        width: 220,
        height: 220,
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
        padding: 28,
        gap: 20,
        ...ghostBorder(0.15),
    },

    // Error
    errorText: {
        color: '#FF4D4D',
        fontSize: 14,
        fontWeight: '600',
        textAlign: 'center',
        marginBottom: 4,
        fontFamily: 'Manrope-Medium',
    },

    // Input
    inputWrapper: {
        gap: 8,
    },
    label: {
        color: 'rgba(255,255,255,0.6)',
        fontSize: 12,
        fontWeight: '700',
        letterSpacing: 1.5,
        textTransform: 'uppercase',
        fontFamily: 'SpaceGrotesk-Bold',
    },
    inputContainer: {
        height: 58,
        backgroundColor: 'rgba(255,255,255,0.04)',
        borderRadius: 16,
        paddingHorizontal: 18,
        justifyContent: 'center',
    },
    inputContainerFocused: {
        ...elevationGlow(),
    },
    input: {
        color: '#FFF',
        fontSize: 16,
        fontWeight: '500',
        fontFamily: 'Manrope-Medium',
    },

    // Button
    primaryButton: {
        height: 58,
        borderRadius: 16,
        overflow: 'hidden',
        ...elevationGlow(10),
        marginTop: 8,
    },
    buttonGradient: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    buttonText: {
        color: '#FFF',
        fontSize: 17,
        fontWeight: '700',
        letterSpacing: 0.5,
        fontFamily: 'SpaceGrotesk-Bold',
    },

    // Link
    linkContainer: {
        alignItems: 'center',
        marginTop: 4,
    },
    linkText: {
        color: 'rgba(255,255,255,0.6)',
        fontSize: 14,
        fontWeight: '500',
        fontFamily: 'Manrope-Medium',
    },
    linkTextAccent: {
        color: VOICES.rider.accent,
        fontWeight: '700',
        fontFamily: 'Manrope-Bold',
    },

    // Watermark
    watermarkContainer: {
        alignItems: 'center',
        marginTop: 'auto',
        paddingBottom: 16,
        opacity: 0.3,
    },
    watermarkText: {
        color: '#FFF',
        fontSize: 18,
        fontWeight: '900',
        letterSpacing: 4,
        fontFamily: 'SpaceGrotesk-Bold',
    },
    watermarkSubtext: {
        color: VOICES.rider.accent,
        fontSize: 10,
        fontWeight: '800',
        letterSpacing: 6,
        marginTop: 2,
        fontFamily: 'SpaceGrotesk-Bold',
    },
});
