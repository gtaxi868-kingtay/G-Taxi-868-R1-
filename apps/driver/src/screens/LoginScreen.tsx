import React, { useState, useEffect } from 'react';
import {
    View, Text, StyleSheet, TextInput, TouchableOpacity,
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
import { RegisterScreen } from './RegisterScreen';
import { supabase } from '../../../../shared/supabase';

const { width, height } = Dimensions.get('window');

// Blueberry Luxe — Gold Edition (Driver)
const COLORS = {
    bgPrimary: '#0D0B1E',
    bgSecondary: '#1A1508',
    gradientStart: '#1A1200',
    gradientEnd: '#0D0B1E',
    gold: '#FFD700',
    goldDark: '#B8860B',
    goldLight: '#FFEC8B',
    amber: '#FFB000',
    amberSoft: 'rgba(255,176,0,0.1)',
    purple: '#7B5CF0',
    purpleDark: '#5B3FD0',
    white: '#FFFFFF',
    textSecondary: 'rgba(255,255,255,0.6)',
    textMuted: 'rgba(255,255,255,0.4)',
    glassBg: 'rgba(255,215,0,0.06)',
    glassBorder: 'rgba(255,176,0,0.3)',
    error: '#EF4444',
};

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
                colors={[COLORS.gradientStart, COLORS.bgPrimary]}
                style={StyleSheet.absoluteFillObject}
                start={{ x: 0.5, y: 0 }}
                end={{ x: 0.5, y: 1 }}
            />

            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                style={{ flex: 1 }}
            >
                <Reanimated.View style={[s.content, animatedStyle]}>
                    <View style={s.header}>
                        <Text style={s.logoText}>G-TAXI DRIVER</Text>
                    </View>

                    <View style={s.form}>
                        <BlurView intensity={30} style={StyleSheet.absoluteFillObject} tint="dark" />
                        <View style={s.inputContainer}>
                            <Text style={[s.inputLabel, { marginBottom: 8, marginLeft: 4 }]}>
                                EMAIL IDENTIFIER
                            </Text>
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
                            <Text style={[s.inputLabel, { marginBottom: 8, marginLeft: 4 }]}>
                                SECURITY ACCESS
                            </Text>
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
                                        color={COLORS.gold}
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
                                <ActivityIndicator color={COLORS.bgPrimary} />
                            ) : (
                                <Text style={s.loginBtnText}>AUTHORIZE DEVICE</Text>
                            )}
                        </TouchableOpacity>
                    </View>

                    {registrationActive && (
                        <TouchableOpacity
                            style={s.registerLink}
                            onPress={() => {
                                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                setShowRegister(true);
                            }}
                        >
                            <Text style={s.registerText}>
                                NEW OPERATOR? <Text style={s.registerHighlight}>JOIN FLEET</Text>
                            </Text>
                        </TouchableOpacity>
                    )}
                </Reanimated.View>
            </KeyboardAvoidingView>
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: COLORS.bgPrimary },
    content: { flex: 1, paddingHorizontal: 24, justifyContent: 'center' },
    header: { alignItems: 'center', marginBottom: 48 },
    logoText: { fontSize: 28, fontWeight: '900', color: COLORS.gold, letterSpacing: 3 },
    form: { width: '100%', padding: 24, borderRadius: 24, overflow: 'hidden', backgroundColor: COLORS.glassBg, borderWidth: 1, borderColor: COLORS.glassBorder },
    inputContainer: { width: '100%' },
    inputLabel: { fontSize: 12, fontWeight: '800', color: COLORS.textMuted, letterSpacing: 1 },
    inputWrap: {
        height: 60,
        backgroundColor: 'rgba(255,255,255,0.03)',
        borderRadius: 16,
        paddingHorizontal: 20,
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: COLORS.glassBorder,
    },
    passwordWrap: { flexDirection: 'row', alignItems: 'center' },
    input: { flex: 1, color: COLORS.white, fontSize: 16, fontWeight: '600' },
    loginBtn: {
        height: 60,
        backgroundColor: COLORS.gold,
        borderRadius: 30,
        marginTop: 32,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: COLORS.gold,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.4,
        shadowRadius: 12,
        elevation: 8,
    },
    loginBtnText: { fontSize: 18, fontWeight: '900', color: COLORS.bgPrimary, letterSpacing: 1 },
    disabled: { opacity: 0.5 },
    registerLink: { marginTop: 40, alignSelf: 'center', padding: 10 },
    registerText: { fontSize: 14, fontWeight: '500', color: COLORS.textMuted },
    registerHighlight: { fontSize: 14, fontWeight: '800', color: COLORS.gold },
});
