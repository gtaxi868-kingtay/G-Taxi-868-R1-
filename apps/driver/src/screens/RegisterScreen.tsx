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
import * as ImagePicker from 'expo-image-picker';
import { decode } from 'base64-arraybuffer';

const { width } = Dimensions.get('window');

import { BRAND, VOICES, RADIUS, GRADIENTS } from '../design-system';

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

    // KYC Documents
    const [licenseFront, setLicenseFront] = useState<string | null>(null);
    const [licenseBack, setLicenseBack] = useState<string | null>(null);
    const [vehiclePhoto, setVehiclePhoto] = useState<string | null>(null);

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

    const pickImage = async (setter: (uri: string) => void) => {
        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            allowsEditing: true,
            aspect: [4, 3],
            quality: 0.7,
            base64: true,
        });

        if (!result.canceled && result.assets[0].uri) {
            setter(result.assets[0].uri);
        }
    };

    const uploadImage = async (uri: string, path: string) => {
        const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            // Native fix: convert file:// uri to blob/base64 if needed, 
            // but expo-image-picker base64: true is easier if available
        });
        
        // Simpler approach for React Native with Supabase:
        const response = await fetch(uri);
        const blob = await response.blob();
        const arrayBuffer = await new Promise<ArrayBuffer>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as ArrayBuffer);
            reader.readAsArrayBuffer(blob);
        });

        const { data, error } = await supabase.storage
            .from('driver-documents')
            .upload(path, arrayBuffer, {
                contentType: 'image/jpeg',
                upsert: true
            });
        
        if (error) throw error;
        return data.path;
    };

    const handleRegister = async () => {
        if (!vehicleModel || !licensePlate) {
            Alert.alert('Missing Info', 'Please fill in vehicle details');
            return;
        }
        if (!licenseFront || !licenseBack || !vehiclePhoto) {
            Alert.alert('KYC Required', 'Please upload all required documents (License Front, Back, and Vehicle Photo)');
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

            // 1. Upload Documents
            const ts = Date.now();
            const [frontPath, backPath, vehiclePathResult] = await Promise.all([
                uploadImage(licenseFront, `${authData.user.id}/license_front_${ts}.jpg`),
                uploadImage(licenseBack, `${authData.user.id}/license_back_${ts}.jpg`),
                uploadImage(vehiclePhoto, `${authData.user.id}/vehicle_${ts}.jpg`),
            ]);

            // 2. Create Driver Record
            const { data: driverData, error: driverError } = await supabase.from('drivers').insert({
                user_id: authData.user.id,
                name: fullName.trim(),
                phone_number: phone.trim(),
                vehicle_model: vehicleModel.trim(),
                plate_number: licensePlate.trim().toUpperCase(),
                vehicle_type: vehicleType,
                vehicle_image_url: vehiclePathResult,
                status: 'pending',
                is_online: false,
                verified_status: 'pending'
            }).select().single();

            if (driverError) throw driverError;

            // 3. Create Document Records
            await supabase.from('driver_documents').insert([
                { driver_id: driverData.id, document_type: 'permit_front', storage_path: frontPath },
                { driver_id: driverData.id, document_type: 'permit_back', storage_path: backPath },
                { driver_id: driverData.id, document_type: 'vehicle_inspection', storage_path: vehiclePathResult }
            ]);

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
                placeholderTextColor={VOICES.driver.textMuted}
                value={value}
                onChangeText={setter}
                selectionColor={BRAND.purpleLight}
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
                            <Ionicons name="chevron-back" size={24} color={BRAND.white} />
                        </TouchableOpacity>
                        <Txt variant="headingM" weight="bold" color={BRAND.white}>Become a Driver</Txt>
                        <Txt variant="bodyBold" color={BRAND.purpleLight}>{step} of 2</Txt>
                    </View>

                    {step === 1 ? (
                        <View style={s.container}>
                            <Txt variant="headingL" weight="heavy" color={BRAND.white} style={s.title}>Account Info</Txt>
                            {renderInput('Full Name', fullName, setFullName)}
                            {renderInput('Phone Number', phone, setPhone, { keyboardType: 'phone-pad' })}
                            {renderInput('Email Address', email, setEmail, { keyboardType: 'email-address', autoCapitalize: 'none' })}
                            {renderInput('Password', password, setPassword, { secureTextEntry: true })}

                            <TouchableOpacity style={s.primaryBtn} onPress={handleNext}>
                                <Txt variant="headingM" weight="bold" color={BRAND.white}>Next →</Txt>
                            </TouchableOpacity>
                        </View>
                    ) : (
                        <View style={s.container}>
                            <Txt variant="headingL" weight="heavy" color={BRAND.white} style={s.title}>Vehicle Info</Txt>
                            {renderInput('Vehicle Model (e.g. 2022 Toyota Aqua)', vehicleModel, setVehicleModel)}
                            {renderInput('Plate Number', licensePlate, setLicensePlate, { autoCapitalize: 'characters' })}

                            {/* Vehicle type selector: 3 pill options [Standard] [XL] [Premium] */}
                            <Txt variant="caption" weight="bold" color={VOICES.driver.textMuted} style={s.label}>VEHICLE CLASS</Txt>
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
                                        <Txt variant="bodyBold" color={vehicleType === type ? BRAND.white : VOICES.driver.textMuted}>{type}</Txt>
                                    </TouchableOpacity>
                                ))}
                            </View>

                            <Txt variant="caption" weight="bold" color={VOICES.driver.textMuted} style={s.label}>KYC DOCUMENTS</Txt>
                            
                            <View style={s.docGrid}>
                            <TouchableOpacity style={[s.docCard, licenseFront && s.docCardActive]} onPress={() => pickImage(setLicenseFront)}>
                                <Ionicons name={licenseFront ? "checkmark-circle" : "card-outline"} size={24} color={licenseFront ? BRAND.purpleLight : VOICES.driver.textMuted} />
                                <Txt variant="small" color={BRAND.white} style={{ marginTop: 8 }}>License Front</Txt>
                            </TouchableOpacity>

                            <TouchableOpacity style={[s.docCard, licenseBack && s.docCardActive]} onPress={() => pickImage(setLicenseBack)}>
                                <Ionicons name={licenseBack ? "checkmark-circle" : "card-outline"} size={24} color={licenseBack ? BRAND.purpleLight : VOICES.driver.textMuted} />
                                <Txt variant="small" color={BRAND.white} style={{ marginTop: 8 }}>License Back</Txt>
                            </TouchableOpacity>

                            <TouchableOpacity style={[s.docCard, vehiclePhoto && s.docCardActive]} onPress={() => pickImage(setVehiclePhoto)}>
                                <Ionicons name={vehiclePhoto ? "checkmark-circle" : "car-outline"} size={24} color={vehiclePhoto ? BRAND.purpleLight : VOICES.driver.textMuted} />
                                <Txt variant="small" color={BRAND.white} style={{ marginTop: 8 }}>Vehicle Photo</Txt>
                            </TouchableOpacity>
                        </View>

                        <TouchableOpacity style={[s.primaryBtn, loading && s.disabled]} onPress={handleRegister} disabled={loading}>
                            {loading ? <ActivityIndicator color={BRAND.white} /> : <Txt variant="headingM" weight="bold" color={BRAND.white}>Submit Application</Txt>}
                        </TouchableOpacity>
                        </View>
                    )}

                </ScrollView>
            </KeyboardAvoidingView>
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: VOICES.driver.bg },
    scroll: { paddingHorizontal: 24, paddingBottom: 40 },
    headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 40 },
    backBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' },
    container: { width: '100%' },
    title: { marginBottom: 32, letterSpacing: -1 },

    inputWrap: { height: 64, backgroundColor: 'rgba(26, 21, 48, 0.8)', borderRadius: 20, paddingHorizontal: 20, justifyContent: 'center', marginBottom: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
    input: { flex: 1, color: BRAND.white, fontSize: 16 },

    label: { marginTop: 16, marginBottom: 12, marginLeft: 4, letterSpacing: 1 },
    typeSelector: { flexDirection: 'row', gap: 10, marginBottom: 40 },
    typePill: { flex: 1, height: 50, borderRadius: 15, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
    typePillActive: { backgroundColor: BRAND.purple, borderColor: BRAND.purple },

    primaryBtn: { height: 64, backgroundColor: BRAND.purple, borderRadius: 32, alignItems: 'center', justifyContent: 'center', shadowColor: BRAND.purple, shadowRadius: 15, shadowOpacity: 0.3, elevation: 8, marginTop: 10 },
    disabled: { opacity: 0.7 },

    docGrid: { flexDirection: 'row', gap: 10, marginBottom: 30 },
    docCard: { flex: 1, height: 90, backgroundColor: 'rgba(26, 21, 48, 0.8)', borderRadius: 15, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
    docCardActive: { borderColor: BRAND.purple, backgroundColor: 'rgba(124, 58, 237, 0.1)' },
});
