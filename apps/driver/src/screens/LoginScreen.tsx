import React, { useState, useEffect } from 'react';
import {
    View, Text, StyleSheet, TextInput, TouchableOpacity,
    KeyboardAvoidingView, Platform, ActivityIndicator,
    Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import Reanimated, {
    useSharedValue, withSpring, withTiming,
    useAnimatedStyle,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '../context/AuthContext';
import { RegisterScreen } from './RegisterScreen';
import { JoinWithCodeScreen } from './JoinWithCodeScreen';
import { supabase } from '@gtaxi/core';
import { SURFACE, VOICES, ANIMATION } from '@gtaxi/design-system';
import { LiquidGlass } from '@gtaxi/design-system/native';
import { ghostBorder } from '@gtaxi/design-system/utils/style-rules';

export function LoginScreen() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [registrationActive, setRegistrationActive] = useState(false);
    const [showRegister, setShowRegister] = useState(false);
    const [showJoinCode, setShowJoinCode] = useState(false);
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
        contentScale.value = withSpring(1, ANIMATION.spring);
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

    if (showJoinCode) {
        return <JoinWithCodeScreen onBack={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            setShowJoinCode(false);
        }} />;
    }

    return (
        <View style={s.root}>
            <StatusBar style="light" />

            <LinearGradient
                colors={['#1A1200', SURFACE.base]}
                style={StyleSheet.absoluteFillObject}
                start={{ x: 0.5, y: 0 }}
                end={{ x: 0.5, y: 1 }}
            />

            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                style={{ flex: 1 }}
            >
                <Reanimated.View style={[s.content, animatedStyle]}>
                    <View style={s.header}>
                        <Text style={s.logoText}>G-TAXI DRIVER</Text>
                    </View>

                    <LiquidGlass voice="driver" style={s.form}>
                        <View style={s.inputContainer}>
                            <Text style={[s.inputLabel, { marginBottom: 8, marginLeft: 4 }]}>
                                EMAIL IDENTIFIER
                            </Text>
                            <View style={s.inputWrap}>
                                <TextInput
                                    style={s.input}
                                    placeholder="driver@gtaxi.com"
                                    placeholderTextColor="rgba(255,255,255,0.2)"
                                    value={email}
                                    onChangeText={setEmail}
                                    autoCapitalize="none"
                                    keyboardType="email-address"
                                />
                            </View>
                        </View>

                        <View style={[s.inputContainer, { marginTop: 24 }]}>
                            <Text style={[s.inputLabel, { marginBottom: 8, marginLeft: 4 }]}>
                                SECURITY ACCESS
                            </Text>
                            <View style={[s.inputWrap, s.passwordWrap]}>
                                <TextInput
                                    style={s.input}
                                    placeholder="••••••••"
                                    placeholderTextColor="rgba(255,255,255,0.2)"
                                    value={password}
                                    onChangeText={setPassword}
                                    secureTextEntry={!showPassword}
                                />
                                <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={{ padding: 8 }}>
                                    <Ionicons
                                        name={showPassword ? "eye-off-outline" : "eye-outline"}
                                        size={20}
                                        color={VOICES.driver.accent}
                                    />
                                </TouchableOpacity>
                            </View>
                        </View>

                        <TouchableOpacity
                            style={[s.loginBtn, loading && s.disabled]}
                            onPress={handleLogin}
                            disabled={loading}
                        >
                            {loading ? (
                                <ActivityIndicator color={SURFACE.base} />
                            ) : (
                                <Text style={s.loginBtnText}>AUTHORIZE DEVICE</Text>
                            )}
                        </TouchableOpacity>
                    </LiquidGlass>

                    {registrationActive && (
                        <TouchableOpacity
                            style={s.registerLink}
                            onPress={() => {
                                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                setShowRegister(true);
                            }}
                        >
                            <Text style={s.registerText}>
                                NEW OPERATOR? <Text style={s.registerHighlight}>JOIN FLEET</Text>
                            </Text>
                        </TouchableOpacity>
                    )}

                    <TouchableOpacity
                        style={s.registerLink}
                        onPress={() => {
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                            setShowJoinCode(true);
                        }}
                    >
                        <Text style={s.registerText}>
                            HAVE A G-LEAD CODE? <Text style={s.registerHighlight}>JOIN HERE</Text>
                        </Text>
                    </TouchableOpacity>
                </Reanimated.View>
            </KeyboardAvoidingView>
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: SURFACE.base },
    content: { flex: 1, paddingHorizontal: 24, justifyContent: 'center' },
    header: { alignItems: 'center', marginBottom: 48 },
    logoText: { fontSize: 28, fontWeight: '900', color: VOICES.driver.accent, letterSpacing: 3, fontFamily: 'SpaceGrotesk-Bold' },
    form: { width: '100%', padding: 24, marginBottom: 16 },
    inputContainer: { width: '100%' },
    inputLabel: { fontSize: 12, fontWeight: '800', color: 'rgba(255,255,255,0.6)', letterSpacing: 1, fontFamily: 'SpaceGrotesk-Bold' },
    inputWrap: {
        height: 60,
        backgroundColor: 'rgba(255,255,255,0.03)',
        borderRadius: 16,
        paddingHorizontal: 20,
        justifyContent: 'center',
        ...ghostBorder(0.15),
    },
    passwordWrap: { flexDirection: 'row', alignItems: 'center' },
    input: { flex: 1, color: '#FFF', fontSize: 16, fontWeight: '600', fontFamily: 'Manrope-Medium' },
    loginBtn: {
        height: 60,
        backgroundColor: VOICES.driver.accent,
        borderRadius: 30,
        marginTop: 32,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: VOICES.driver.accent,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.4,
        shadowRadius: 12,
        elevation: 8,
    },
    loginBtnText: { fontSize: 18, fontWeight: '900', color: SURFACE.base, letterSpacing: 1, fontFamily: 'SpaceGrotesk-Bold' },
    disabled: { opacity: 0.5 },
    registerLink: { marginTop: 40, alignSelf: 'center', padding: 10 },
    registerText: { fontSize: 14, fontWeight: '500', color: 'rgba(255,255,255,0.6)', fontFamily: 'Manrope-Medium' },
    registerHighlight: { fontSize: 14, fontWeight: '800', color: VOICES.driver.accent, fontFamily: 'Manrope-Bold' },
});
