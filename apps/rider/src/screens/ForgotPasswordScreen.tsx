import React, { useState } from 'react';
import { authErrorMessage } from '../utils/authMessages';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { supabase } from '@gtaxi/core';
import { RainLogin, CrystalInput, CrystalButton } from '@gtaxi/design-system/native';
import { VOICES } from '@gtaxi/design-system';

// Same crystal "rain" scaffold as the sign-in screen.
export function ForgotPasswordScreen({ navigation }: any) {
    const [email, setEmail] = useState('');
    const [loading, setLoading] = useState(false);
    const [sent, setSent] = useState(false);
    const [error, setError] = useState('');

    const handleReset = async () => {
        if (!email || !email.includes('@')) {
            setError('Enter a valid email address.');
            return;
        }
        setError('');
        setLoading(true);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        try {
            const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
                redirectTo: 'gtaxi://reset-password',
            });
            if (resetError) {
                setError(authErrorMessage(resetError, 'reset'));
            } else {
                setSent(true);
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            }
        } catch (err: any) {
            setError(authErrorMessage(err, 'reset'));
        } finally {
            setLoading(false);
        }
    };

    const back = (
        <Pressable accessibilityRole="button" onPress={() => navigation.navigate('Login')} style={{ alignItems: 'center', paddingVertical: 8 }}>
            <Text style={s.linkText}>Remembered it? <Text style={s.linkAccent}>Sign in</Text></Text>
        </Pressable>
    );

    return (
        <View style={{ flex: 1 }}>
            <StatusBar style="light" />
            <RainLogin voice="rider" logoSource={require('../../assets/logo.png')} footer={back}>
                {sent ? (
                    <>
                        <Text style={s.title}>Check your email</Text>
                        <Text style={s.body}>We sent a reset link to {email.trim()}. Open it on this phone to choose a new password.</Text>
                        <CrystalButton title="Back to sign in" voice="rider" onPress={() => navigation.navigate('Login')} />
                    </>
                ) : (
                    <>
                        <Text style={s.title}>Reset your password</Text>
                        <Text style={s.body}>Enter your email and we will send you a link.</Text>
                        {error ? <Text style={s.error}>{error}</Text> : null}
                        <CrystalInput label="Email" voice="rider" placeholder="you@email.com" value={email} onChangeText={setEmail} keyboardType="email-address" />
                        <CrystalButton title="Send reset link" voice="rider" onPress={handleReset} loading={loading} />
                    </>
                )}
            </RainLogin>
        </View>
    );
}

const s = StyleSheet.create({
    title: { color: '#EAF3F6', fontSize: 22, fontWeight: '800', textAlign: 'center' },
    body: { color: 'rgba(234,243,246,0.7)', fontSize: 15, lineHeight: 21, textAlign: 'center', marginBottom: 4 },
    error: { color: '#FF6B6B', fontSize: 13, fontWeight: '600', textAlign: 'center' },
    linkText: { color: 'rgba(234,243,246,0.55)', fontSize: 14, fontWeight: '500' },
    linkAccent: { color: VOICES.rider.accent, fontWeight: '700' },
});
