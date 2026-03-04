import React, { useState, useEffect } from 'react';
import { View, StyleSheet, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, ActivityIndicator, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import { tokens } from '../design-system/tokens';
import { Txt, Surface } from '../design-system/primitives';
import { supabase } from '../../../../shared/supabase';

export function LoginScreen() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [registrationActive, setRegistrationActive] = useState(false);
    const { signIn } = useAuth();
    const insets = useSafeAreaInsets();

    useEffect(() => {
        const fetchFlag = async () => {
            const { data } = await supabase
                .from('system_feature_flags')
                .select('is_enabled')
                .eq('module_name', 'driver_registration_active')
                .single();
            if (data) {
                setRegistrationActive(data.is_enabled);
            }
        };
        fetchFlag();
    }, []);

    const handleLogin = async () => {
        if (!email || !password) {
            Alert.alert('Error', 'Please fill in all fields');
            return;
        }

        setLoading(true);
        const { error } = await signIn(email, password);
        setLoading(false);

        if (error) {
            Alert.alert('Login Failed', error.message);
        }
    };

    return (
        <View style={styles.container}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
                <View style={[styles.content, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 20 }]}>

                    <View style={styles.header}>
                        <Txt variant="displayXL" weight="bold" color={tokens.colors.text.primary} style={{ letterSpacing: -1 }}>
                            G-Taxi Driver
                        </Txt>
                        <Txt variant="bodyReg" color={tokens.colors.text.secondary} style={{ marginTop: 8 }}>
                            Partner App
                        </Txt>
                    </View>

                    <Surface intensity={40} style={styles.formCard}>
                        <View style={styles.inputContainer}>
                            <Txt variant="caption" weight="bold" color={tokens.colors.text.tertiary} style={styles.label}>EMAIL ADDRESS</Txt>
                            <TextInput
                                style={styles.input}
                                placeholder="driver@gtaxi.com"
                                placeholderTextColor={tokens.colors.text.tertiary}
                                value={email}
                                onChangeText={setEmail}
                                autoCapitalize="none"
                                keyboardType="email-address"
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
                    </Surface>

                    <TouchableOpacity
                        style={[styles.primaryBtn, loading && styles.primaryBtnDisabled]}
                        onPress={handleLogin}
                        disabled={loading}
                    >
                        {loading ? (
                            <ActivityIndicator color={tokens.colors.background.base} />
                        ) : (
                            <Txt variant="headingM" weight="bold" color={tokens.colors.background.base}>Sign In</Txt>
                        )}
                    </TouchableOpacity>

                    {registrationActive && (
                        <TouchableOpacity
                            style={styles.applyBtn}
                            onPress={() => Alert.alert('Apply to Drive', 'Registration workflow coming soon.')}
                        >
                            <Txt variant="bodyBold" color={tokens.colors.primary.cyan}>Apply to Drive</Txt>
                        </TouchableOpacity>
                    )}

                </View>
            </KeyboardAvoidingView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: tokens.colors.background.base },
    content: { flex: 1, paddingHorizontal: 24, justifyContent: 'center' },
    header: { marginBottom: 40 },
    formCard: { borderRadius: 24, borderWidth: 1, borderColor: tokens.colors.border.subtle, marginBottom: 24, overflow: 'hidden' },
    inputContainer: {},
    label: { marginTop: 16, marginLeft: 20, marginBottom: 4 },
    input: { color: tokens.colors.text.primary, fontSize: 17, paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: tokens.colors.border.subtle },
    primaryBtn: { backgroundColor: tokens.colors.primary.cyan, paddingVertical: 18, borderRadius: 16, alignItems: 'center', shadowColor: tokens.colors.primary.cyan, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 8 },
    primaryBtnDisabled: { opacity: 0.7 },
    applyBtn: { marginTop: 24, alignItems: 'center', paddingVertical: 16, borderRadius: 16, borderWidth: 1, borderColor: tokens.colors.primary.cyan },
});
