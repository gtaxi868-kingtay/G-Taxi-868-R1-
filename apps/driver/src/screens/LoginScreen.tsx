import React, { useState, useEffect } from 'react';
import {
    View, StyleSheet, TextInput, TouchableOpacity,
    KeyboardAvoidingView, Platform, ActivityIndicator,
    Alert, Dimensions, Image
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import Reanimated, {
    useSharedValue, withSpring, withTiming,
    useAnimatedStyle,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '../context/AuthContext';
import { Txt } from '../design-system/primitives';
import { RegisterScreen } from './RegisterScreen';
import { supabase } from '../../../../shared/supabase';

const { width, height } = Dimensions.get('window');

// ── Driver-only tokens ────────────────────────────────────────────────────────
const C = {
    bg: '#07050F',
    surface: '#110E22',
    surfaceHigh: '#1A1530',
    purple: '#7C3AED',
    purpleLight: '#A78BFA',
    white: '#FFFFFF',
    muted: 'rgba(255,255,255,0.45)',
    faint: 'rgba(255,255,255,0.06)',
};

export function LoginScreen() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [registrationActive, setRegistrationActive] = useState(false);
    const [showRegister, setShowRegister] = useState(false);
    const { signIn } = useAuth();
    const insets = useSafeAreaInsets();

    const contentOpacity = useSharedValue(0);
    const contentScale = useSharedValue(0.95);

    useEffect(() => {
        const fetchFlag = async () => {
            const { data } = await supabase
                .from('system_feature_flags')
                .select('is_active')
                .eq('id', 'driver_registration_active')
                .single();
            if (data) setRegistrationActive(data.is_active);
        };
        fetchFlag();

        contentOpacity.value = withTiming(1, { duration: 800 });
        contentScale.value = withSpring(1);
    }, []);

    const handleLogin = async () => {
        if (!email || !password) {
            Alert.alert('Error', 'Please fill in all fields');
            return;
        }
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        setLoading(true);
        const { error } = await signIn(email, password);
        setLoading(false);

        if (error) {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            Alert.alert('Login Failed', error.message);
        }
    };

    const animatedStyle = useAnimatedStyle(() => ({
        opacity: contentOpacity.value,
        transform: [{ scale: contentScale.value }],
    }));

    if (showRegister) {
        return <RegisterScreen onBack={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            setShowRegister(false);
        }} />;
    }

    return (
        <View style={s.root}>
            <StatusBar style="light" />

            {/* Background Gradient Glow */}
            <LinearGradient
                colors={['rgba(124, 58, 237, 0.15)', 'transparent']}
                style={[StyleSheet.absoluteFill, { height: height * 0.6 }]}
                start={{ x: 0.5, y: 0.2 }}
                end={{ x: 0.5, y: 1 }}
            />

            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                style={{ flex: 1 }}
            >
                <Reanimated.View style={[s.content, animatedStyle]}>

                    {/* G-Taxi Custom Logo */}
                    <View style={s.header}>
                        <Image
                            source={require('../../assets/images/custom_logo.png')}
                            style={{ width: 140, height: 140, resizeMode: 'contain', marginBottom: 8 }}
                        />
                        <Txt variant="bodyBold" color={C.muted} style={{ letterSpacing: 2 }}>
                            DRIVER PORTAL
                        </Txt>
                    </View>

                    {/* Form Container */}
                    <View style={s.form}>
                        {/* Email input: dark surface, rounded, white text */}
                        <View style={s.inputContainer}>
                            <View style={s.inputWrap}>
                                <TextInput
                                    style={s.input}
                                    placeholder="Email Address"
                                    placeholderTextColor={C.muted}
                                    value={email}
                                    onChangeText={setEmail}
                                    autoCapitalize="none"
                                    keyboardType="email-address"
                                />
                            </View>
                        </View>

                        {/* Password input: same style, eye toggle for show/hide */}
                        <View style={[s.inputContainer, { marginTop: 16 }]}>
                            <View style={[s.inputWrap, s.passwordWrap]}>
                                <TextInput
                                    style={s.input}
                                    placeholder="Password"
                                    placeholderTextColor={C.muted}
                                    value={password}
                                    onChangeText={setPassword}
                                    secureTextEntry={!showPassword}
                                />
                                <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
                                    <Ionicons
                                        name={showPassword ? "eye-off-outline" : "eye-outline"}
                                        size={20}
                                        color={C.muted}
                                    />
                                </TouchableOpacity>
                            </View>
                        </View>

                        {/* Login button: full width purple pill, loading spinner when pending */}
                        <TouchableOpacity
                            style={[s.loginBtn, loading && s.disabled]}
                            onPress={handleLogin}
                            disabled={loading}
                        >
                            {loading ? (
                                <ActivityIndicator color={C.white} />
                            ) : (
                                <Txt variant="headingM" weight="bold" color={C.white}>Login</Txt>
                            )}
                        </TouchableOpacity>
                    </View>

                    {/* "New driver? Register here" link text bottom */}
                    {registrationActive && (
                        <TouchableOpacity
                            style={s.registerLink}
                            onPress={() => {
                                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                setShowRegister(true);
                            }}
                        >
                            <Txt variant="bodyReg" color={C.muted}>
                                New driver? <Txt weight="bold" color={C.purpleLight}>Register here</Txt>
                            </Txt>
                        </TouchableOpacity>
                    )}

                </Reanimated.View>
            </KeyboardAvoidingView>
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: C.bg },
    content: { flex: 1, paddingHorizontal: 32, justifyContent: 'center', alignItems: 'center' },
    header: { alignItems: 'center', marginBottom: 60 },
    wordmark: { fontSize: 48, letterSpacing: -2 },

    form: { width: '100%', maxWidth: 400 },
    inputContainer: { width: '100%' },
    inputWrap: {
        height: 60,
        backgroundColor: C.surface,
        borderRadius: 20,
        paddingHorizontal: 20,
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.05)',
    },
    passwordWrap: { flexDirection: 'row', alignItems: 'center' },
    input: { flex: 1, color: C.white, fontSize: 16 },

    loginBtn: {
        height: 60,
        backgroundColor: C.purple,
        borderRadius: 30,
        marginTop: 32,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: C.purple,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 12,
        elevation: 5,
    },
    disabled: { opacity: 0.7 },

    registerLink: { marginTop: 40, padding: 10 },
});
