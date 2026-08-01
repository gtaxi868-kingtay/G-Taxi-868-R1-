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
import { RainLogin, CrystalInput, CrystalButton } from '@gtaxi/design-system/native';

export function LoginScreen() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [registrationActive, setRegistrationActive] = useState(false);
    const [showRegister, setShowRegister] = useState(false);
    const [showJoinCode, setShowJoinCode] = useState(false);
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
            Alert.alert('Login Failed', error.message);
        }
    };

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
            </RainLogin>
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1 },
    registerLink: { paddingVertical: 8 },
    registerText: { fontSize: 14, fontWeight: '500', color: 'rgba(234,243,246,0.55)' },
    registerHighlight: { fontSize: 14, fontWeight: '800', color: VOICES.driver.gold },
});
