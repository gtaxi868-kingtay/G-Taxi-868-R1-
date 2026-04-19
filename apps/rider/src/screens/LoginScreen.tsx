import React, { useState, useEffect } from 'react';
import {
    View, StyleSheet, TextInput, TouchableOpacity,
    KeyboardAvoidingView, Platform, ActivityIndicator,
    Dimensions, Image, Text
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

export function LoginScreen({ navigation }: any) {
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
            const { error: signInError } = await signIn(email, password);
            if (signInError) setError(signInError.message);
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
                                            placeholderTextColor={COLORS.textMuted}
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
                                            placeholderTextColor={COLORS.textMuted}
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
                                            <Text style={s.buttonText}>Sign In</Text>
                                        )}
                                    </LinearGradient>
                                </TouchableOpacity>

                                {/* Create Account Link - Cyan */}
                                <TouchableOpacity 
                                    style={s.linkContainer}
                                    onPress={() => { 
                                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); 
                                        navigation.navigate('Signup'); 
                                    }}
                                >
                                    <Text style={s.linkText}>
                                        Don't have an account? <Text style={s.linkTextCyan}>Create Account</Text>
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
        backgroundColor: COLORS.bgPrimary 
    },
    container: { 
        flex: 1 
    },
    content: { 
        flex: 1, 
        paddingHorizontal: 28,
        paddingTop: height * 0.08,
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
        backgroundColor: 'rgba(123,92,240,0.15)',
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
        backgroundColor: COLORS.glassBg,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: COLORS.glassBorder,
        padding: 28,
        gap: 20,
        shadowColor: COLORS.purple,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 12,
        elevation: 8,
    },

    // Error
    errorText: {
        color: COLORS.error,
        fontSize: 14,
        fontWeight: '600',
        textAlign: 'center',
        marginBottom: 4,
    },

    // Input
    inputWrapper: {
        gap: 8,
    },
    label: {
        color: COLORS.textMuted,
        fontSize: 12,
        fontWeight: '700',
        letterSpacing: 1.5,
        textTransform: 'uppercase',
    },
    inputContainer: {
        height: 58,
        backgroundColor: 'rgba(255,255,255,0.04)',
        borderRadius: 16,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.08)',
        paddingHorizontal: 18,
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
        fontSize: 16,
        fontWeight: '500',
    },

    // Button
    primaryButton: {
        height: 58,
        borderRadius: 16,
        overflow: 'hidden',
        shadowColor: COLORS.purple,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.6,
        shadowRadius: 16,
        elevation: 10,
        marginTop: 8,
    },
    buttonGradient: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    buttonText: {
        color: COLORS.white,
        fontSize: 17,
        fontWeight: '700',
        letterSpacing: 0.5,
    },

    // Link
    linkContainer: {
        alignItems: 'center',
        marginTop: 4,
    },
    linkText: {
        color: COLORS.textSecondary,
        fontSize: 14,
        fontWeight: '500',
    },
    linkTextCyan: {
        color: COLORS.cyan,
        fontWeight: '700',
    },

    // Watermark
    watermarkContainer: {
        alignItems: 'center',
        marginTop: 'auto',
        paddingBottom: 16,
        opacity: 0.3,
    },
    watermarkText: {
        color: COLORS.white,
        fontSize: 18,
        fontWeight: '900',
        letterSpacing: 4,
    },
    watermarkSubtext: {
        color: COLORS.cyan,
        fontSize: 10,
        fontWeight: '800',
        letterSpacing: 6,
        marginTop: 2,
    },
});
