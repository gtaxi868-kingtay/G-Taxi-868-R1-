import React, { useState } from 'react';
import {
    View, StyleSheet, TextInput, TouchableOpacity,
    KeyboardAvoidingView, Platform, ActivityIndicator,
    Alert, ScrollView, Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../../shared/supabase';
import { Txt } from '../design-system/primitives';

const { width } = Dimensions.get('window');

// ── Driver-only tokens ────────────────────────────────────────────────────────
const C = {
    bg: '#07050F',
    surface: '#110E22',
    surfaceHigh: '#1A1530',
    purple: '#7C3AED',
    purpleLight: '#A78BFA',
    white: '#FFFFFF',
    muted: 'rgba(255,255,255,0.45)',
    faint: 'rgba(255,255,255,0.06)',
};

export function RegisterScreen({ navigation }: any) {
    const insets = useSafeAreaInsets();
    const [loading, setLoading] = useState(false);
    const [step, setStep] = useState<1 | 2>(1);

    // Personal Info
    const [fullName, setFullName] = useState('');
    const [phone, setPhone] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');

    // Vehicle Info
    const [vehicleModel, setVehicleModel] = useState('');
    const [licensePlate, setLicensePlate] = useState('');
    const [vehicleType, setVehicleType] = useState('Standard'); // Standard, XL, Premium

    const handleNext = () => {
        if (!fullName || !phone || !email || !password) {
            Alert.alert('Missing Info', 'Please fill in all personal details');
            return;
        }
        if (password.length < 6) {
            Alert.alert('Weak Password', 'Password must be 6+ chars');
            return;
        }
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        setStep(2);
    };

    const handleRegister = async () => {
        if (!vehicleModel || !licensePlate) {
            Alert.alert('Missing Info', 'Please fill in vehicle details');
            return;
        }

        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        setLoading(true);
        try {
            const { data: authData, error: authError } = await supabase.auth.signUp({
                email: email.trim().toLowerCase(),
                password,
            });

            if (authError) throw authError;
            if (!authData.user) throw new Error('Signup failed');

            // BUG_VERIFY: name, phone_number, plate_number, vehicle_model, vehicle_type, status: "pending", is_online: false
            const { error: driverError } = await supabase.from('drivers').insert({
                user_id: authData.user.id,
                name: fullName.trim(),
                phone_number: phone.trim(),
                vehicle_model: vehicleModel.trim(),
                plate_number: licensePlate.trim().toUpperCase(),
                vehicle_type: vehicleType,
                status: 'pending',
                is_online: false,
            });

            if (driverError) throw driverError;

            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            Alert.alert(
                'Application Submitted',
                'Your application is under review. You will be notified once approved.',
                [{ text: 'OK', onPress: () => navigation.goBack() }]
            );
        } catch (err: any) {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            if (err?.message?.includes("already registered as a rider") ||
                err?.message?.includes("already registered as a driver")) {
                Alert.alert(
                    "Phone Already Registered",
                    "This phone number is already linked to a G-Taxi account. " +
                    "Each phone number can only be used for one account."
                );
            } else {
                Alert.alert('Error', err.message);
            }
        } finally {
            setLoading(false);
        }
    };

    const renderInput = (placeholder: string, value: string, setter: (t: string) => void, opts: any = {}) => (
        <View style={s.inputWrap}>
            <TextInput
                style={s.input}
                placeholder={placeholder}
                placeholderTextColor={C.muted}
                value={value}
                onChangeText={setter}
                selectionColor={C.purpleLight}
                {...opts}
            />
        </View>
    );

    return (
        <View style={s.root}>
            <StatusBar style="light" />
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
                <ScrollView contentContainerStyle={[s.scroll, { paddingTop: insets.top + 20 }]} showsVerticalScrollIndicator={false}>

                    {/* Header: [← back] | ["Become a Driver" centered] | step indicator (1 of 2) */}
                    <View style={s.headerRow}>
                        <TouchableOpacity style={s.backBtn} onPress={step === 2 ? () => setStep(1) : () => navigation.goBack()}>
                            <Ionicons name="chevron-back" size={24} color={C.white} />
                        </TouchableOpacity>
                        <Txt variant="headingM" weight="bold" color={C.white}>Become a Driver</Txt>
                        <Txt variant="bodyBold" color={C.purpleLight}>{step} of 2</Txt>
                    </View>

                    {step === 1 ? (
                        <View style={s.container}>
                            <Txt variant="headingL" weight="heavy" color={C.white} style={s.title}>Account Info</Txt>
                            {renderInput('Full Name', fullName, setFullName)}
                            {renderInput('Phone Number', phone, setPhone, { keyboardType: 'phone-pad' })}
                            {renderInput('Email Address', email, setEmail, { keyboardType: 'email-address', autoCapitalize: 'none' })}
                            {renderInput('Password', password, setPassword, { secureTextEntry: true })}

                            <TouchableOpacity style={s.primaryBtn} onPress={handleNext}>
                                <Txt variant="headingM" weight="bold" color={C.white}>Next →</Txt>
                            </TouchableOpacity>
                        </View>
                    ) : (
                        <View style={s.container}>
                            <Txt variant="headingL" weight="heavy" color={C.white} style={s.title}>Vehicle Info</Txt>
                            {renderInput('Vehicle Model (e.g. 2022 Toyota Aqua)', vehicleModel, setVehicleModel)}
                            {renderInput('Plate Number', licensePlate, setLicensePlate, { autoCapitalize: 'characters' })}

                            {/* Vehicle type selector: 3 pill options [Standard] [XL] [Premium] */}
                            <Txt variant="caption" weight="bold" color={C.muted} style={s.label}>VEHICLE CLASS</Txt>
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
                                        <Txt variant="bodyBold" color={vehicleType === type ? C.white : C.muted}>{type}</Txt>
                                    </TouchableOpacity>
                                ))}
                            </View>

                            <TouchableOpacity style={[s.primaryBtn, loading && s.disabled]} onPress={handleRegister} disabled={loading}>
                                {loading ? <ActivityIndicator color={C.white} /> : <Txt variant="headingM" weight="bold" color={C.white}>Submit Application</Txt>}
                            </TouchableOpacity>
                        </View>
                    )}

                </ScrollView>
            </KeyboardAvoidingView>
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: C.bg },
    scroll: { paddingHorizontal: 24, paddingBottom: 40 },
    headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 40 },
    backBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' },
    container: { width: '100%' },
    title: { marginBottom: 32, letterSpacing: -1 },

    inputWrap: { height: 64, backgroundColor: C.surface, borderRadius: 20, paddingHorizontal: 20, justifyContent: 'center', marginBottom: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
    input: { flex: 1, color: C.white, fontSize: 16 },

    label: { marginTop: 16, marginBottom: 12, marginLeft: 4, letterSpacing: 1 },
    typeSelector: { flexDirection: 'row', gap: 10, marginBottom: 40 },
    typePill: { flex: 1, height: 50, borderRadius: 15, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
    typePillActive: { backgroundColor: C.purple, borderColor: C.purple },

    primaryBtn: { height: 64, backgroundColor: C.purple, borderRadius: 32, alignItems: 'center', justifyContent: 'center', shadowColor: C.purple, shadowRadius: 15, shadowOpacity: 0.3, elevation: 8, marginTop: 10 },
    disabled: { opacity: 0.7 },
});
