import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { RegisterScreen } from './RegisterScreen';
import { JoinWithCodeScreen } from './JoinWithCodeScreen';
import { supabase } from '@gtaxi/core';
import { VOICES } from '@gtaxi/design-system';
import { RainLogin, CrystalInput, CrystalButton, ForgotPasswordFlow } from '@gtaxi/design-system/native';
import { requestPasswordReset, completePasswordReset, friendlySignInError } from '@g868/shared/passwordReset';

export function LoginScreen() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [registrationActive, setRegistrationActive] = useState(false);
    const [showRegister, setShowRegister] = useState(false);
    const [showJoinCode, setShowJoinCode] = useState(false);
    const [showForgot, setShowForgot] = useState(false);
    const { signIn } = useAuth();

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
            const f = friendlySignInError(error.message);
            Alert.alert(f.title, f.body, f.offerReset
                ? [{ text: 'Try again', style: 'cancel' }, { text: 'Reset password', onPress: () => setShowForgot(true) }]
                : [{ text: 'OK' }]);
        }
    };

    if (showRegister) {
        return <RegisterScreen onBack={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            setShowRegister(false);
        }} />;
    }

    if (showForgot) {
        // Code-based reset (works in any mail app). After a successful reset
        // the person is already signed in, so the app moves on by itself.
        return (
            <ForgotPasswordFlow
                voice="driver"
                logoSource={require('../../assets/logo.png')}
                initialEmail={email}
                onBack={() => setShowForgot(false)}
                onRequestCode={(e: string) => requestPasswordReset(supabase as any, e)}
                onSetPassword={(e: string, c: string, p: string, p2: string) => completePasswordReset(supabase as any, e, c, p, p2)}
            />
        );
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
            <RainLogin
                voice="driver"
                logoSource={require('../../assets/logo.png')}
                subtitle="Fleet Terminal"
                footer={
                    <>
                        {registrationActive && (
                            <TouchableOpacity
                                style={s.registerLink}
                                onPress={() => {
                                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                    setShowRegister(true);
                                }}
                            >
                                <Text style={s.registerText}>
                                    New operator? <Text style={s.registerHighlight}>Join Fleet</Text>
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
                                Have a G-Lead code? <Text style={s.registerHighlight}>Join here</Text>
                            </Text>
                        </TouchableOpacity>
                    </>
                }
            >
                <CrystalInput
                    label="Email Identifier"
                    voice="driver"
                    placeholder="driver@gtaxi.com"
                    value={email}
                    onChangeText={setEmail}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="email"
                />
                <CrystalInput
                    label="Security Access"
                    voice="driver"
                    placeholder="••••••••"
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry={!showPassword}
                    rightSlot={
                        <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={{ padding: 8 }}>
                            <Ionicons
                                name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                                size={20}
                                color={VOICES.driver.accent}
                            />
                        </TouchableOpacity>
                    }
                />
                <CrystalButton title="Authorize Device" voice="driver" onPress={handleLogin} loading={loading} />
                <TouchableOpacity
                    style={s.forgotLink}
                    onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setShowForgot(true); }}
                    accessibilityRole="button"
                    accessibilityLabel="Forgot password"
                >
                    <Text style={s.forgotText}>Forgot password?</Text>
                </TouchableOpacity>
            </RainLogin>
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1 },
    registerLink: { paddingVertical: 8 },
    forgotLink: { alignSelf: 'center', paddingVertical: 12, paddingHorizontal: 16 },
    forgotText: { fontSize: 14, fontWeight: '700', color: VOICES.driver.accent },
    registerText: { fontSize: 14, fontWeight: '500', color: 'rgba(234,243,246,0.55)' },
    registerHighlight: { fontSize: 14, fontWeight: '800', color: VOICES.driver.gold },
});
