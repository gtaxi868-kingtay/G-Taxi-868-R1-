import React, { useState } from 'react';
import { Image, Linking, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useAuth } from '../context/AuthContext';
import { Button, Card, Field, LinkText, Screen, SPACE, Txt } from '../ui/kit';

export function LoginScreen({ navigation }: any) {
    const { signIn } = useAuth();

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [unverified, setUnverified] = useState(false);

    const handleLogin = async () => {
        if (!email || !password) {
            setError('Enter your email and password');
            return;
        }
        setLoading(true);
        setError('');
        setUnverified(false);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

        try {
            const { data, error: signInError } = await signIn(email.trim(), password);
            if (signInError) {
                setError(signInError.message);
            } else if (data?.user && !data.user.email_confirmed_at) {
                setError('Your email is not confirmed yet. Check your inbox for the link.');
                setUnverified(true);
            }
        } catch (err: any) {
            setError(err.message || 'Sign in failed');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Screen
            hero={
                <View style={{ paddingTop: SPACE.xxl }}>
                    <Image source={require('../../assets/logo.png')} style={{ width: 64, height: 64, marginBottom: SPACE.xl }} resizeMode="contain" />
                    <Txt variant="hero">Welcome to G 868</Txt>
                    <Txt variant="body" tone="dim" style={{ marginTop: SPACE.xs }}>Sign in to book your ride.</Txt>
                </View>
            }
            footer={
                <View>
                    <Button title="Sign in" onPress={handleLogin} loading={loading} />
                    <LinkText onPress={() => navigation.navigate('Signup')} accent="Create one">New to G 868?</LinkText>
                </View>
            }
        >
            {error ? (
                <Card style={{ marginBottom: SPACE.lg, borderColor: '#E5484D' }}>
                    <Txt variant="bodyStrong" tone="danger">{error}</Txt>
                    {unverified ? (
                        <Txt
                            variant="bodyStrong" tone="accent" style={{ marginTop: SPACE.sm }}
                            onPress={() => Linking.openURL('https://wa.me/18687031000?text=VERIFY_ACCOUNT_' + encodeURIComponent(email.trim()))}
                        >
                            Verify on WhatsApp instead
                        </Txt>
                    ) : null}
                </Card>
            ) : null}

            <Field label="Email" placeholder="you@email.com" value={email} onChangeText={setEmail}
                keyboardType="email-address" autoCapitalize="none" textContentType="emailAddress" autoComplete="email" />
            <Field label="Password" placeholder="Your password" value={password} onChangeText={setPassword}
                secureTextEntry textContentType="password" autoComplete="password" onSubmitEditing={handleLogin} />

            <View style={{ alignItems: 'flex-end' }}>
                <Txt variant="bodyStrong" tone="accent" onPress={() => navigation.navigate('ForgotPassword')} accessibilityRole="button">
                    Forgot password?
                </Txt>
            </View>
        </Screen>
    );
}
