import React, { useState } from 'react';
import { View, StyleSheet, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, ActivityIndicator, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import { tokens } from '../design-system/tokens';
import { Txt, Surface } from '../design-system/primitives';

export function LoginScreen({ navigation }: any) {
    const { signIn, sendPhoneOTP, verifyPhoneOTP } = useAuth();
    const insets = useSafeAreaInsets();

    const [loginMode, setLoginMode] = useState<'email' | 'phone'>('email');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [phone, setPhone] = useState('');
    const [otp, setOtp] = useState('');
    const [otpSent, setOtpSent] = useState(false);

    const [loading, setLoading] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');

    const handleEmailLogin = async () => {
        if (!email || !password) {
            setErrorMsg('Please enter both email and password.');
            return;
        }
        setLoading(true);
        setErrorMsg('');
        try {
            const { error } = await signIn(email, password);
            if (error) setErrorMsg(error.message);
        } catch (err: any) {
            setErrorMsg(err.message || 'An error occurred during login.');
        } finally {
            setLoading(false);
        }
    };

    const handleSendOTP = async () => {
        if (!phone) {
            setErrorMsg('Please enter your phone number.');
            return;
        }
        setLoading(true);
        setErrorMsg('');
        try {
            await sendPhoneOTP(phone);
            setOtpSent(true);
            Alert.alert('Code Sent', 'Please check your messages for the 6-digit code.');
        } catch (err: any) {
            setErrorMsg(err.message || 'Failed to send OTP.');
        } finally {
            setLoading(false);
        }
    };

    const handleVerifyOTP = async () => {
        if (!otp) {
            setErrorMsg('Please enter the verification code.');
            return;
        }
        setLoading(true);
        setErrorMsg('');
        try {
            await verifyPhoneOTP(phone, otp);
        } catch (err: any) {
            setErrorMsg(err.message || 'Invalid code.');
        } finally {
            setLoading(false);
        }
    };

    const toggleMode = () => {
        setLoginMode(loginMode === 'email' ? 'phone' : 'email');
        setErrorMsg('');
        setOtpSent(false);
    };

    return (
        <View style={styles.container}>
            {/* Background Orbs */}
            <View style={[styles.orb, styles.orb1]} />
            <View style={[styles.orb, styles.orb2]} />

            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.keyboardView}>
                <View style={[styles.content, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 20 }]}>

                    <View style={styles.header}>
                        <Txt variant="displayXL" weight="bold" color={tokens.colors.text.primary} style={{ letterSpacing: -1 }}>
                            G-Taxi
                        </Txt>
                        <Txt variant="bodyReg" color={tokens.colors.text.secondary} style={{ marginTop: 8 }}>
                            Premium rides. Transparent pricing.
                        </Txt>
                    </View>

                    <Surface intensity={40} style={styles.formCard}>
                        {errorMsg ? (
                            <View style={styles.errorBox}>
                                <Txt variant="caption" color={tokens.colors.status.error}>{errorMsg}</Txt>
                            </View>
                        ) : null}

                        {loginMode === 'email' ? (
                            <>
                                <View style={styles.inputContainer}>
                                    <Txt variant="caption" weight="bold" color={tokens.colors.text.tertiary} style={styles.label}>EMAIL ADDRESS</Txt>
                                    <TextInput
                                        style={styles.input}
                                        placeholder="name@example.com"
                                        placeholderTextColor={tokens.colors.text.tertiary}
                                        value={email}
                                        onChangeText={setEmail}
                                        keyboardType="email-address"
                                        autoCapitalize="none"
                                        autoCorrect={false}
                                    />
                                </View>

                                <View style={styles.inputContainer}>
                                    <Txt variant="caption" weight="bold" color={tokens.colors.text.tertiary} style={styles.label}>PASSWORD</Txt>
                                    <TextInput
                                        style={[styles.input, { borderBottomWidth: 0 }]}
                                        placeholder="••••••••"
                                        placeholderTextColor={tokens.colors.text.tertiary}
                                        value={password}
                                        onChangeText={setPassword}
                                        secureTextEntry
                                    />
                                </View>
                            </>
                        ) : (
                            <>
                                {otpSent ? (
                                    <View style={styles.inputContainer}>
                                        <Txt variant="caption" weight="bold" color={tokens.colors.text.tertiary} style={styles.label}>6-DIGIT CODE</Txt>
                                        <TextInput
                                            style={[styles.input, { borderBottomWidth: 0 }]}
                                            placeholder="123456"
                                            placeholderTextColor={tokens.colors.text.tertiary}
                                            value={otp}
                                            onChangeText={setOtp}
                                            keyboardType="number-pad"
                                            maxLength={6}
                                        />
                                    </View>
                                ) : (
                                    <View style={styles.inputContainer}>
                                        <Txt variant="caption" weight="bold" color={tokens.colors.text.tertiary} style={styles.label}>PHONE NUMBER</Txt>
                                        <TextInput
                                            style={[styles.input, { borderBottomWidth: 0 }]}
                                            placeholder="+1 868 555 1234"
                                            placeholderTextColor={tokens.colors.text.tertiary}
                                            value={phone}
                                            onChangeText={setPhone}
                                            keyboardType="phone-pad"
                                        />
                                    </View>
                                )}
                            </>
                        )}
                    </Surface>

                    <TouchableOpacity
                        style={styles.primaryBtn}
                        onPress={
                            loginMode === 'email'
                                ? handleEmailLogin
                                : (otpSent ? handleVerifyOTP : handleSendOTP)
                        }
                        disabled={loading}
                    >
                        {loading ? (
                            <ActivityIndicator color="#000" />
                        ) : (
                            <Txt variant="headingM" weight="bold" color={tokens.colors.background.base}>
                                {loginMode === 'email' ? 'Log In' : (otpSent ? 'Verify Code' : 'Send Code')}
                            </Txt>
                        )}
                    </TouchableOpacity>

                    <TouchableOpacity style={styles.toggleBtn} onPress={toggleMode}>
                        <Txt variant="bodyBold" color={tokens.colors.text.secondary}>
                            {loginMode === 'email' ? 'Use Phone Number instead' : 'Use Email instead'}
                        </Txt>
                    </TouchableOpacity>

                    <View style={styles.footer}>
                        <Txt variant="bodyReg" color={tokens.colors.text.secondary}>New to G-Taxi? </Txt>
                        <TouchableOpacity onPress={() => navigation.navigate('Signup')}>
                            <Txt variant="bodyBold" weight="bold" color={tokens.colors.primary.cyan}>Create Account</Txt>
                        </TouchableOpacity>
                    </View>

                </View>
            </KeyboardAvoidingView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: tokens.colors.background.base },
    orb: { position: 'absolute', width: 300, height: 300, borderRadius: 150, opacity: 0.15 },
    orb1: { top: -100, left: -100, backgroundColor: tokens.colors.primary.purple },
    orb2: { bottom: '20%', right: -150, backgroundColor: tokens.colors.primary.cyan },
    keyboardView: { flex: 1 },
    content: { flex: 1, paddingHorizontal: 24, justifyContent: 'center' },
    header: { marginBottom: 40 },
    formCard: { borderRadius: 24, borderWidth: 1, borderColor: tokens.colors.border.subtle, marginBottom: 24, overflow: 'hidden' },
    errorBox: { padding: 16, backgroundColor: 'rgba(255, 69, 58, 0.1)', borderBottomWidth: 1, borderBottomColor: tokens.colors.border.subtle },
    inputContainer: {},
    label: { marginTop: 16, marginLeft: 20, marginBottom: 4 },
    input: { color: tokens.colors.text.primary, fontSize: 17, paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: tokens.colors.border.subtle },
    primaryBtn: { backgroundColor: tokens.colors.primary.cyan, paddingVertical: 18, borderRadius: 16, alignItems: 'center', shadowColor: tokens.colors.primary.cyan, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 8 },
    toggleBtn: { marginTop: 24, alignItems: 'center' },
    footer: { flexDirection: 'row', justifyContent: 'center', marginTop: 32 },
});
