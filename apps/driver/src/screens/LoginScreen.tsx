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

import { GlassCard, BRAND, VOICES, SEMANTIC, RADIUS, GRADIENTS } from '../design-system';

const { width, height } = Dimensions.get('window');

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

            <LinearGradient
                colors={['rgba(0, 255, 194, 0.08)', 'transparent']}
                style={[StyleSheet.absoluteFill, { height: height * 0.5 }]}
                start={{ x: 0.5, y: 0 }}
                end={{ x: 0.5, y: 1 }}
            />

            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                style={{ flex: 1 }}
            >
                <Reanimated.View style={[s.content, animatedStyle]}>
                    <View style={s.header}>
                        <Image
                            source={require('../../assets/images/custom_logo.png')}
                            style={{ width: 120, height: 120, resizeMode: 'contain', marginBottom: 12 }}
                        />
                        <Txt variant="caption" weight="heavy" color={BRAND.cyan} style={{ letterSpacing: 4 }}>
                            LOGISTICS OS
                        </Txt>
                    </View>

                    <GlassCard variant="driver" style={s.form}>
                        <View style={s.inputContainer}>
                            <Txt variant="caption" weight="heavy" color={VOICES.driver.textMuted} style={{ marginBottom: 8, marginLeft: 4 }}>
                                EMAIL IDENTIFIER
                            </Txt>
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
                            <Txt variant="caption" weight="heavy" color={VOICES.driver.textMuted} style={{ marginBottom: 8, marginLeft: 4 }}>
                                SECURITY ACCESS
                            </Txt>
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
                                        color={BRAND.cyan}
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
                                <ActivityIndicator color="#0A0718" />
                            ) : (
                                <Txt variant="headingM" weight="heavy" color="#0A0718">AUTHORIZE DEVICE</Txt>
                            )}
                        </TouchableOpacity>
                    </GlassCard>

                    {registrationActive && (
                        <TouchableOpacity
                            style={s.registerLink}
                            onPress={() => {
                                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                setShowRegister(true);
                            }}
                        >
                            <Txt variant="bodyReg" color={VOICES.driver.textMuted}>
                                NEW OPERATOR? <Txt weight="heavy" color={BRAND.cyan}>JOIN FLEET</Txt>
                            </Txt>
                        </TouchableOpacity>
                    )}
                </Reanimated.View>
            </KeyboardAvoidingView>
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: '#0A0718' },
    content: { flex: 1, paddingHorizontal: 24, justifyContent: 'center' },
    header: { alignItems: 'center', marginBottom: 48 },
    form: { width: '100%', padding: 24 },
    inputContainer: { width: '100%' },
    inputWrap: {
        height: 60,
        backgroundColor: 'rgba(255,255,255,0.03)',
        borderRadius: 16,
        paddingHorizontal: 20,
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: 'rgba(0,255,194,0.1)',
    },
    passwordWrap: { flexDirection: 'row', alignItems: 'center' },
    input: { flex: 1, color: '#FFF', fontSize: 16, fontWeight: '600' },
    loginBtn: {
        height: 60,
        backgroundColor: BRAND.cyan,
        borderRadius: 30,
        marginTop: 32,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: BRAND.cyan,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 12,
        elevation: 8,
    },
    disabled: { opacity: 0.5 },
    registerLink: { marginTop: 40, alignSelf: 'center', padding: 10 },
});
