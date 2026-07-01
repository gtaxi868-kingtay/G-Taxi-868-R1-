import React, { useState } from 'react';
import {
    View, Text, StyleSheet, TextInput, TouchableOpacity,
    KeyboardAvoidingView, Platform, ActivityIndicator, Alert, ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@gtaxi/core';
import { VOICES } from '@gtaxi/design-system';
import { ghostBorder } from '@gtaxi/design-system/utils/style-rules';

interface NavigationProp {
    navigate: (screen: string, params?: object) => void;
    goBack: () => void;
}

// Lightweight driver onboarding for commander-recruited drivers.
// Creates an account, then calls register_driver_with_code which links the
// new driver to the commander's territory with verified_status 'pending'.
// The commander approves them from the Command Center driver queue.
export function JoinWithCodeScreen({ navigation, onBack }: { navigation?: NavigationProp; onBack?: () => void }) {
    const insets = useSafeAreaInsets();
    const [loading, setLoading] = useState(false);

    const [commanderCode, setCommanderCode] = useState('');
    const [fullName, setFullName] = useState('');
    const [phone, setPhone] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [vehicleModel, setVehicleModel] = useState('');
    const [licensePlate, setLicensePlate] = useState('');
    const [vehicleType, setVehicleType] = useState('Standard');

    const goBack = () => { onBack?.(); navigation?.goBack(); };

    const handleJoin = async () => {
        if (!commanderCode.trim() || !fullName.trim() || !email.trim() || !password) {
            Alert.alert('Missing Info', 'G-Lead code, name, email and password are required.');
            return;
        }
        if (password.length < 6) {
            Alert.alert('Weak Password', 'Password must be 6+ characters.');
            return;
        }

        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        setLoading(true);
        try {
            // 1. Create the account (needed: register_driver_with_code is auth-gated).
            const { data: authData, error: authError } = await supabase.auth.signUp({
                email: email.trim().toLowerCase(),
                password,
                options: { data: { role: 'driver' } },
            });
            if (authError) throw authError;
            if (!authData.user) throw new Error('Signup failed');

            // If the project requires email confirmation there is no session yet,
            // so the auth-gated function call would fail. Tell them to confirm + sign in.
            if (!authData.session) {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                Alert.alert(
                    'Confirm Your Email',
                    'Your account was created. Please verify your email, then sign in to finish joining your G-Lead\'s territory.',
                    [{ text: 'OK', onPress: goBack }]
                );
                return;
            }

            // 2. Link to the commander's territory.
            const { data, error } = await supabase.functions.invoke('register_driver_with_code', {
                body: {
                    commander_code: commanderCode.trim().toUpperCase(),
                    name: fullName.trim(),
                    phone_number: phone.trim() || null,
                    vehicle_model: vehicleModel.trim() || null,
                    plate_number: licensePlate.trim().toUpperCase() || null,
                    vehicle_type: vehicleType.toLowerCase(),
                },
            });
            if (error || !data?.success) {
                throw new Error(data?.error || error?.message || 'Could not join with that code');
            }

            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            Alert.alert(
                'Welcome Aboard!',
                'You\'ve joined your G-Lead\'s territory. They\'ll review and approve your account shortly.',
                [{ text: 'OK', onPress: goBack }]
            );
        } catch (err) {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            Alert.alert('Could Not Join', err instanceof Error ? err.message : String(err));
        } finally {
            setLoading(false);
        }
    };

    const renderInput = (placeholder: string, value: string, setter: (t: string) => void, opts: object = {}) => (
        <View style={s.inputWrap}>
            <TextInput
                style={s.input}
                placeholder={placeholder}
                placeholderTextColor="rgba(255,255,255,0.6)"
                value={value}
                onChangeText={setter}
                selectionColor={VOICES.driver.accent}
                {...opts}
            />
        </View>
    );

    return (
        <View style={s.root}>
            <StatusBar style="light" />
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
                <ScrollView contentContainerStyle={[s.scroll, { paddingTop: insets.top + 20 }]} showsVerticalScrollIndicator={false}>
                    <View style={s.headerRow}>
                        <TouchableOpacity style={s.backBtn} onPress={goBack}>
                            <Ionicons name="chevron-back" size={24} color="#EAF3F6" />
                        </TouchableOpacity>
                        <Text style={{ fontSize: 16, fontWeight: '700', color: '#EAF3F6' }}>Join with a Code</Text>
                        <View style={{ width: 44 }} />
                    </View>

                    <View style={s.container}>
                        <View style={s.badge}>
                            <Ionicons name="shield-checkmark" size={20} color={VOICES.driver.accent} />
                            <Text style={s.badgeText}>G-LEAD RECRUIT</Text>
                        </View>
                        <Text style={[s.title, { fontSize: 22, fontWeight: '800', color: '#EAF3F6' }]}>
                            Join your local territory
                        </Text>
                        <Text style={s.subtitle}>
                            Enter the code your G-Lead gave you. You can complete document
                            verification after they approve you.
                        </Text>

                        {renderInput('G-Lead Code', commanderCode, setCommanderCode, { autoCapitalize: 'characters' })}
                        {renderInput('Full Name', fullName, setFullName)}
                        {renderInput('Phone Number', phone, setPhone, { keyboardType: 'phone-pad' })}
                        {renderInput('Email Address', email, setEmail, { keyboardType: 'email-address', autoCapitalize: 'none' })}
                        {renderInput('Password', password, setPassword, { secureTextEntry: true })}
                        {renderInput('Vehicle Model (e.g. 2022 Toyota Aqua)', vehicleModel, setVehicleModel)}
                        {renderInput('Plate Number', licensePlate, setLicensePlate, { autoCapitalize: 'characters' })}

                        <Text style={s.label}>VEHICLE CLASS</Text>
                        <View style={s.typeSelector}>
                            {['Standard', 'XL', 'Premium'].map(type => (
                                <TouchableOpacity
                                    key={type}
                                    style={[s.typePill, vehicleType === type && s.typePillActive]}
                                    onPress={() => {
                                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                        setVehicleType(type);
                                    }}
                                >
                                    <Text style={{ fontSize: 14, fontWeight: '600', color: vehicleType === type ? '#EAF3F6' : 'rgba(255,255,255,0.6)' }}>{type}</Text>
                                </TouchableOpacity>
                            ))}
                        </View>

                        <TouchableOpacity style={[s.primaryBtn, loading && s.disabled]} onPress={handleJoin} disabled={loading}>
                            {loading ? <ActivityIndicator color="#EAF3F6" /> : <Text style={{ fontSize: 16, fontWeight: '700', color: '#EAF3F6' }}>Join Territory</Text>}
                        </TouchableOpacity>
                    </View>
                </ScrollView>
            </KeyboardAvoidingView>
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: '#0F0D16' },
    scroll: { paddingHorizontal: 24, paddingBottom: 40 },
    headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32 },
    backBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' },
    container: { width: '100%' },
    badge: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
    badgeText: { fontSize: 11, fontWeight: '700', letterSpacing: 2, color: VOICES.driver.accent },
    title: { marginBottom: 10, letterSpacing: -1 },
    subtitle: { fontSize: 14, color: 'rgba(255,255,255,0.6)', lineHeight: 20, marginBottom: 28 },
    inputWrap: { height: 64, backgroundColor: 'rgba(26, 21, 48, 0.4)', borderRadius: 20, paddingHorizontal: 20, justifyContent: 'center', marginBottom: 16, ...ghostBorder(0.15) },
    input: { flex: 1, color: '#EAF3F6', fontSize: 16 },
    label: { marginTop: 8, marginBottom: 12, marginLeft: 4, letterSpacing: 1, fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.6)' },
    typeSelector: { flexDirection: 'row', gap: 10, marginBottom: 32 },
    typePill: { flex: 1, height: 50, borderRadius: 15, ...ghostBorder(0.15), alignItems: 'center', justifyContent: 'center' },
    typePillActive: { backgroundColor: VOICES.driver.accent, borderColor: VOICES.driver.accent },
    primaryBtn: { height: 64, backgroundColor: VOICES.driver.accent, borderRadius: 32, alignItems: 'center', justifyContent: 'center', shadowColor: VOICES.driver.accent, shadowRadius: 15, shadowOpacity: 0.3, elevation: 8, marginTop: 4 },
    disabled: { opacity: 0.7 },
});
