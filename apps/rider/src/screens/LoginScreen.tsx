import React, { useState } from 'react';
import { View, StyleSheet, TouchableOpacity, Text } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { useAuth } from '../context/AuthContext';
import { RainLogin, CrystalInput, CrystalButton } from '@gtaxi/design-system/native';
import { VOICES } from '@gtaxi/design-system';

export function LoginScreen({ navigation }: any) {
    const { signIn } = useAuth();

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

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
            <RainLogin
                voice="rider"
                logoSource={require('../../assets/logo.png')}
                footer={
                    <>
                        <TouchableOpacity
                            style={s.linkContainer}
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
                        <TouchableOpacity
                            style={s.linkContainer}
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
                    </>
                }
            >
                {error ? <Text style={s.errorText}>{error}</Text> : null}

                <CrystalInput
                    label="Email"
                    voice="rider"
                    placeholder="you@email.com"
                    value={email}
                    onChangeText={setEmail}
                    keyboardType="email-address"
                />
                <CrystalInput
                    label="Password"
                    voice="rider"
                    placeholder="••••••••"
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry
                />
                <CrystalButton title="Sign In" voice="rider" onPress={handleLogin} loading={loading} />
            </RainLogin>
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1 },
    errorText: {
        color: '#FF6B6B',
        fontSize: 13,
        fontWeight: '600',
        textAlign: 'center',
    },
    linkContainer: {
        alignItems: 'center',
        paddingVertical: 8,
    },
    linkText: {
        color: 'rgba(234,243,246,0.55)',
        fontSize: 14,
        fontWeight: '500',
    },
    linkTextAccent: {
        color: VOICES.rider.accent,
        fontWeight: '700',
    },
});
