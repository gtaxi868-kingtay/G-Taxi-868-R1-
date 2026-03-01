import React, { useState, useRef } from 'react';
import { View, StyleSheet, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, ActivityIndicator, Animated, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import { tokens } from '../design-system/tokens';
import { Txt, Surface } from '../design-system/primitives';

export function SignupScreen({ navigation }: any) {
    const { signUp } = useAuth();
    const insets = useSafeAreaInsets();

    const [formData, setFormData] = useState({ name: '', email: '', phone: '', password: '' });
    const [loading, setLoading] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');

    const fadeAnim = useRef(new Animated.Value(0)).current;

    React.useEffect(() => {
        Animated.timing(fadeAnim, { toValue: 1, duration: 800, useNativeDriver: true }).start();
    }, []);

    const handleSignup = async () => {
        if (!formData.name || !formData.email || !formData.phone || !formData.password) {
            setErrorMsg('All fields are required.');
            return;
        }
        setLoading(true);
        setErrorMsg('');
        try {
            const { error } = await signUp(formData.email, formData.password, formData.name);
            if (error) setErrorMsg(error.message);
            else {
                Alert.alert("Success", "Account created successfully. Please log in.");
                navigation.navigate('Login');
            }
        } catch (err: any) {
            setErrorMsg(err.message || 'An error occurred.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <View style={styles.container}>
            <View style={[styles.orb, styles.orb1]} />
            <View style={[styles.orb, styles.orb2]} />

            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.keyboardView}>
                <Animated.ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20, opacity: fadeAnim }]}>

                    <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
                        <Txt variant="bodyBold" color={tokens.colors.primary.cyan}>← Back</Txt>
                    </TouchableOpacity>

                    <View style={styles.header}>
                        <Txt variant="headingL" weight="bold" color={tokens.colors.text.primary}>Create Account</Txt>
                        <Txt variant="bodyReg" color={tokens.colors.text.secondary} style={{ marginTop: 8 }}>Join G-Taxi and ride premium.</Txt>
                    </View>

                    <Surface intensity={40} style={styles.formCard}>
                        {errorMsg ? (
                            <View style={styles.errorBox}>
                                <Txt variant="caption" color={tokens.colors.status.error}>{errorMsg}</Txt>
                            </View>
                        ) : null}

                        <View style={styles.inputContainer}>
                            <Txt variant="caption" weight="bold" color={tokens.colors.text.tertiary} style={styles.label}>FULL NAME</Txt>
                            <TextInput
                                style={styles.input}
                                placeholder="John Doe"
                                placeholderTextColor={tokens.colors.text.tertiary}
                                value={formData.name}
                                onChangeText={v => setFormData({ ...formData, name: v })}
                            />
                        </View>

                        <View style={styles.inputContainer}>
                            <Txt variant="caption" weight="bold" color={tokens.colors.text.tertiary} style={styles.label}>PHONE NUMBER</Txt>
                            <TextInput
                                style={styles.input}
                                placeholder="18685551234"
                                placeholderTextColor={tokens.colors.text.tertiary}
                                value={formData.phone}
                                onChangeText={v => setFormData({ ...formData, phone: v })}
                                keyboardType="phone-pad"
                            />
                        </View>

                        <View style={styles.inputContainer}>
                            <Txt variant="caption" weight="bold" color={tokens.colors.text.tertiary} style={styles.label}>EMAIL ADDRESS</Txt>
                            <TextInput
                                style={styles.input}
                                placeholder="name@example.com"
                                placeholderTextColor={tokens.colors.text.tertiary}
                                value={formData.email}
                                onChangeText={v => setFormData({ ...formData, email: v })}
                                keyboardType="email-address"
                                autoCapitalize="none"
                            />
                        </View>

                        <View style={styles.inputContainer}>
                            <Txt variant="caption" weight="bold" color={tokens.colors.text.tertiary} style={styles.label}>PASSWORD</Txt>
                            <TextInput
                                style={[styles.input, { borderBottomWidth: 0 }]}
                                placeholder="••••••••"
                                placeholderTextColor={tokens.colors.text.tertiary}
                                value={formData.password}
                                onChangeText={v => setFormData({ ...formData, password: v })}
                                secureTextEntry
                            />
                        </View>
                    </Surface>

                    <TouchableOpacity style={styles.primaryBtn} onPress={handleSignup} disabled={loading}>
                        {loading ? <ActivityIndicator color="#000" /> : <Txt variant="headingM" weight="bold" color={tokens.colors.background.base}>Sign Up</Txt>}
                    </TouchableOpacity>

                </Animated.ScrollView>
            </KeyboardAvoidingView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: tokens.colors.background.base },
    orb: { position: 'absolute', width: 300, height: 300, borderRadius: 150, opacity: 0.15 },
    orb1: { top: -100, right: -100, backgroundColor: tokens.colors.primary.cyan },
    orb2: { bottom: '10%', left: -150, backgroundColor: tokens.colors.primary.purple },
    keyboardView: { flex: 1 },
    content: { paddingHorizontal: 24, justifyContent: 'center' },
    backBtn: { marginBottom: 24 },
    header: { marginBottom: 32 },
    formCard: { borderRadius: 24, borderWidth: 1, borderColor: tokens.colors.border.subtle, marginBottom: 32, overflow: 'hidden' },
    errorBox: { padding: 16, backgroundColor: 'rgba(255, 69, 58, 0.1)', borderBottomWidth: 1, borderBottomColor: tokens.colors.border.subtle },
    inputContainer: {},
    label: { marginTop: 16, marginLeft: 20, marginBottom: 4 },
    input: { color: tokens.colors.text.primary, fontSize: 17, paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: tokens.colors.border.subtle },
    primaryBtn: { backgroundColor: tokens.colors.primary.cyan, paddingVertical: 18, borderRadius: 16, alignItems: 'center', shadowColor: tokens.colors.primary.cyan, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 8 },
});
