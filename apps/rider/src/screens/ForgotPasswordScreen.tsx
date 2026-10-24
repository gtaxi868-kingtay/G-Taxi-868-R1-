import React, { useState } from 'react';
import { View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { supabase } from '@gtaxi/core';
import { Button, EmptyState, Field, Screen, SPACE, Txt } from '../ui/kit';

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
                setError(resetError.message);
            } else {
                setSent(true);
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            }
        } catch (err: any) {
            setError(err.message || 'Could not send the reset email.');
        } finally {
            setLoading(false);
        }
    };

    if (sent) {
        return (
            <Screen onBack={() => navigation.goBack()}>
                <EmptyState
                    icon="mail-unread-outline"
                    title="Check your email"
                    body={`We sent a reset link to ${email.trim()}. Open it on this phone to choose a new password.`}
                    action={<Button title="Back to sign in" onPress={() => navigation.navigate('Login')} />}
                />
            </Screen>
        );
    }

    return (
        <Screen
            onBack={() => navigation.goBack()}
            hero={
                <View>
                    <Txt variant="hero">Reset your password</Txt>
                    <Txt variant="body" tone="dim" style={{ marginTop: SPACE.xs }}>
                        Enter your email and we will send you a link.
                    </Txt>
                </View>
            }
            footer={<Button title="Send reset link" onPress={handleReset} loading={loading} />}
        >
            <Field label="Email" placeholder="you@email.com" value={email} onChangeText={setEmail}
                keyboardType="email-address" autoCapitalize="none" textContentType="emailAddress" autoFocus
                error={error || null} onSubmitEditing={handleReset} />
        </Screen>
    );
}
