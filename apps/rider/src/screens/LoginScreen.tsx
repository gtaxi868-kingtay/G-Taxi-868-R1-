import React, { useState, useEffect } from 'react';
import {
    View, StyleSheet, TextInput, TouchableOpacity,
    KeyboardAvoidingView, Platform, ActivityIndicator,
    Dimensions, Image
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import Reanimated, {
    useSharedValue, useAnimatedStyle, withRepeat,
    withTiming, withSequence
} from 'react-native-reanimated';
import { useAuth } from '../context/AuthContext';
import { Txt } from '../design-system/primitives';

import { tokens } from '../design-system/tokens';

const { width, height } = Dimensions.get('window');

// --- Rider Design Tokens (Deprecated local, using tokens) ---
const R = {
    bg: tokens.colors.background.base,
    surface: tokens.colors.background.surface,
    border: tokens.colors.glass.stroke,
    purple: tokens.colors.primary.purple,
    purpleLight: tokens.colors.primary.cyan,
    white: tokens.colors.text.primary,
    muted: tokens.colors.text.secondary,
};

export function LoginScreen({ navigation }: any) {
    const { signIn } = useAuth();
    const insets = useSafeAreaInsets();

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const logoScale = useSharedValue(1);

    useEffect(() => {
        logoScale.value = withRepeat(
            withSequence(
                withTiming(1.05, { duration: 2000 }),
                withTiming(1, { duration: 2000 })
            ),
            -1, true
        );
    }, []);

    const animatedLogoStyle = useAnimatedStyle(() => ({
        transform: [{ scale: logoScale.value }]
    }));

    const handleLogin = async () => {
        if (!email || !password) {
            setError('Please enter your credentials');
            return;
        }
        setLoading(true);
        setError('');
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

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

            {/* Background: Vibrant Gradient DNA */}
            <LinearGradient
                colors={['#1A1A4A', R.bg]} // Slightly more purple-blue top
                style={StyleSheet.absoluteFill}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
            />

            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                style={s.container}
            >
                <View style={s.content}>

                    {/* Branding: Custom Logo */}
                    <Reanimated.View style={[s.branding, animatedLogoStyle]}>
                        <Image
                            source={require('../../assets/images/custom_logo.png')}
                            style={{ width: 140, height: 140, resizeMode: 'contain', marginBottom: 16 }}
                        />
                        <Txt variant="bodyReg" color={R.muted} style={s.tagline}>PREMIUM RIDER EXPERIENCE</Txt>
                    </Reanimated.View>

                    {/* Form Card */}
                    <View style={s.form}>
                        {error ? <Txt variant="small" color="#EF4444" style={s.errorText}>{error}</Txt> : null}

                        <View style={s.inputWrapper}>
                            <Txt variant="caption" weight="heavy" color={R.muted} style={s.label}>EMAIL</Txt>
                            <TextInput
                                style={s.input}
                                placeholder="rider@gtaxi.com"
                                placeholderTextColor="rgba(255,255,255,0.2)"
                                value={email}
                                onChangeText={setEmail}
                                autoCapitalize="none"
                                keyboardType="email-address"
                            />
                        </View>

                        <View style={s.inputWrapper}>
                            <Txt variant="caption" weight="heavy" color={R.muted} style={s.label}>PASSWORD</Txt>
                            <TextInput
                                style={s.input}
                                placeholder="••••••••"
                                placeholderTextColor="rgba(255,255,255,0.2)"
                                value={password}
                                onChangeText={setPassword}
                                secureTextEntry
                            />
                        </View>

                        <TouchableOpacity style={s.loginBtn} onPress={handleLogin} disabled={loading}>
                            <LinearGradient 
                                colors={[tokens.colors.primary.purple, tokens.colors.primary.cyan]} 
                                start={{x: 0, y: 0}} 
                                end={{x: 1, y: 0}} // Horizontal brand gradient
                                style={s.btnGradient}
                            >
                                {loading ? <ActivityIndicator color="#FFF" /> : (
                                    <Txt variant="bodyBold" color="#FFF" style={{ letterSpacing: 1 }}>INITIALIZE PORTAL</Txt>
                                )}
                            </LinearGradient>
                        </TouchableOpacity>
                    </View>

                    {/* Secondary Actions */}
                    <View style={s.footer}>
                        <Txt variant="bodyReg" color={R.muted}>New here?</Txt>
                        <TouchableOpacity onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); navigation.navigate('Signup'); }}>
                            <Txt variant="bodyBold" color={R.purpleLight} style={{ marginLeft: 8 }}>Create Account</Txt>
                        </TouchableOpacity>
                    </View>

                </View>
            </KeyboardAvoidingView>
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: R.bg },
    container: { flex: 1 },
    content: { flex: 1, paddingHorizontal: 32, justifyContent: 'center' },

    branding: { alignItems: 'center', marginBottom: 50 },
    logoCircle: { width: 100, height: 100, borderRadius: 32, backgroundColor: R.purple, alignItems: 'center', justifyContent: 'center', shadowColor: R.purple, shadowRadius: 30, shadowOpacity: 0.4, marginBottom: 24 },
    logoText: { fontSize: 48, letterSpacing: -2, color: '#FFF' },
    tagline: { fontSize: 13, letterSpacing: 4, marginTop: 12, fontWeight: '800' },

    form: { gap: 24 },
    errorText: { textAlign: 'center', marginBottom: 10 },
    inputWrapper: { gap: 10 },
    label: { marginLeft: 8, opacity: 0.8 },
    input: { height: 64, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 20, paddingHorizontal: 24, color: '#FFF', fontSize: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },

    loginBtn: { height: 64, borderRadius: 20, overflow: 'hidden', marginTop: 12, shadowColor: '#00FFFF', shadowRadius: 15, shadowOpacity: 0.3 },
    btnGradient: { flex: 1, alignItems: 'center', justifyContent: 'center' },

    footer: { flexDirection: 'row', justifyContent: 'center', marginTop: 48 },
});
