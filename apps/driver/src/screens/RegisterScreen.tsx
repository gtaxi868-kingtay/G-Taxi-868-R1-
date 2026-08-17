import React, { useState, useEffect } from 'react';
import {
    View, Text, StyleSheet, TextInput, TouchableOpacity,
    KeyboardAvoidingView, Platform, ActivityIndicator,
    Alert, ScrollView, Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DRIVER_CONSENT_DOCUMENTS, LEGAL_DOC_URLS } from '@g868/shared/legal';
import { savePendingSignup } from '@g868/shared/pendingSignup';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@gtaxi/core';
import * as ImagePicker from 'expo-image-picker';
import { VOICES } from '@gtaxi/design-system';
import { ghostBorder } from '@gtaxi/design-system/utils/style-rules';

interface NavigationProp {
    navigate: (screen: string, params?: object) => void;
    goBack: () => void;
}

export function RegisterScreen({ navigation, onBack }: { navigation?: NavigationProp; onBack?: () => void }) {
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
    // Canonical lowercase keys — must match vehicle_classes.key (matching is
    // done on this value; a case mismatch here once broke dispatch entirely).
    const [vehicleType, setVehicleType] = useState('standard');
    const [vehicleClasses, setVehicleClasses] = useState<Array<{ key: string; label: string }>>([
        { key: 'standard', label: 'Standard' },
        { key: 'xl', label: 'XL' },
        { key: 'premium', label: 'Premium' },
    ]);

    useEffect(() => {
        // Live class list (admin-controlled; RLS returns active rows only, so
        // heavy classes like truck/hiab/wrecker appear once admin enables them).
        // Query builders are thenables without .catch(); keep fallback on error.
        supabase
            .from('vehicle_classes')
            .select('key, label, sort_order')
            .order('sort_order')
            .then(
                ({ data }: { data: Array<{ key: string; label: string }> | null }) => {
                    if (data && data.length > 0) setVehicleClasses(data.map(d => ({ key: d.key, label: d.label })));
                },
                () => {}
            );
    }, []);

    // KYC Documents
    const [licenseFront, setLicenseFront] = useState<string | null>(null);
    const [licenseBack, setLicenseBack] = useState<string | null>(null);
    const [vehiclePhoto, setVehiclePhoto] = useState<string | null>(null);

    // Terms
    const [termsAccepted, setTermsAccepted] = useState(false);

    const handleNext = () => {
        if (!termsAccepted) {
            Alert.alert(
                'Terms Required',
                'You must accept the Terms of Service and Privacy Policy to continue.'
            );
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            return;
        }
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

        if (!result.canceled && result.assets?.[0]?.uri) {
            setter(result.assets[0].uri);
        }
    };

    const uploadImage = async (uri: string, path: string) => {
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
                options: {
                    data: {
                        role: 'driver',
                        terms_accepted: true,
                        terms_accepted_at: new Date().toISOString(),
                    },
                },
            });

            if (authError) throw authError;
            if (!authData.user) throw new Error('Signup failed');
            const requiresEmailConfirmation = !authData.session;

            // Record every document a driver is asked to accept as real
            // evidence — Terms, Driver Operator Agreement (the document that
            // actually establishes independent-contractor status), Privacy
            // Policy, Data Retention notice, Safety Policy. Was Terms-only.
            // The flags above go into raw_user_meta_data, which is
            // USER-WRITABLE — a driver can call auth.updateUser and set
            // their own terms_accepted, so it proves nothing. record_consent
            // writes the append-only user_consents ledger, taking the id
            // from auth.uid() rather than the client. Needs a session, so it
            // is queued for the first real sign-in when email confirmation
            // is pending — previously this branch simply had no `else` and
            // silently dropped consent forever for any driver who signed up
            // with email confirmation on; the rider flow already had this
            // queue-and-flush fix, this brings the driver flow to parity.
            if (authData.session) {
                for (const doc of DRIVER_CONSENT_DOCUMENTS) {
                    try {
                        await supabase.rpc('record_consent', {
                            p_document: doc.document,
                            p_version: doc.version,
                            p_user_agent: Platform.OS,
                        });
                    } catch (e) {
                        console.warn(`[Register] consent not recorded for ${doc.document}:`, e);
                    }
                }
            } else {
                await savePendingSignup(AsyncStorage, {
                    forUserId: authData.user.id,
                    consents: DRIVER_CONSENT_DOCUMENTS.map(doc => ({
                        document: doc.document,
                        version: doc.version,
                        userAgent: Platform.OS,
                    })),
                });
            }

            // 1. Upload Documents
            const ts = Date.now();
            const [frontPath, backPath, vehiclePathResult] = await Promise.all([
                uploadImage(licenseFront, `${authData.user.id}/license_front_${ts}.jpg`),
                uploadImage(licenseBack, `${authData.user.id}/license_back_${ts}.jpg`),
                uploadImage(vehiclePhoto, `${authData.user.id}/vehicle_${ts}.jpg`),
            ]);

            // 2. Create Driver Record
            // drivers.status only accepts online/offline/busy
            // (drivers_status_check) -- 'pending' violated it, so this
            // insert has always thrown and this direct-registration path
            // (as opposed to the commander-code path in
            // JoinWithCodeScreen.tsx) has never actually created a driver
            // row. verified_status is the real "pending approval" signal
            // (drivers_verified_status enum). vehicle_image_url is not a
            // real column either -- the vehicle photo is already stored
            // correctly via the driver_documents insert below.
            const { data: driverData, error: driverError } = await supabase.from('drivers').insert({
                user_id: authData.user.id,
                name: fullName.trim(),
                phone_number: phone.trim(),
                vehicle_model: vehicleModel.trim(),
                plate_number: licensePlate.trim().toUpperCase(),
                vehicle_type: vehicleType,
                status: 'offline',
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
            if (requiresEmailConfirmation) {
                Alert.alert(
                    'Check Your Email',
                    'Your application is submitted. Please verify your email to activate your account.\n\nDidn\'t get the code?',
                    [
                        { text: 'Verify via WhatsApp', onPress: () => Linking.openURL('https://wa.me/18687031000?text=VERIFY_ACCOUNT_' + encodeURIComponent(email)) },
                        { text: 'OK', onPress: () => { onBack?.(); navigation?.goBack(); } }
                    ]
                );
            } else {
                Alert.alert(
                    'Application Submitted',
                    'Your application is under review. You will be notified once approved.',
                    [{ text: 'OK', onPress: () => { onBack?.(); navigation?.goBack(); } }]
                );
            }
        } catch (err) {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            const message = err instanceof Error ? err.message : String(err);
            if (message.includes("already registered as a rider") ||
                message.includes("already registered as a driver")) {
                Alert.alert(
                    "Phone Already Registered",
                    "This phone number is already linked to a G-Taxi account. " +
                    "Each phone number can only be used for one account."
                );
            } else {
                Alert.alert('Error', message);
            }
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

                    {/* Header: [← back] | ["Become a Driver" centered] | step indicator (1 of 2) */}
                    <View style={s.headerRow}>
                        <TouchableOpacity style={s.backBtn} onPress={step === 2 ? () => setStep(1) : () => { onBack?.(); navigation?.goBack(); }}>
                            <Ionicons name="chevron-back" size={24} color="#EAF3F6" />
                        </TouchableOpacity>
                        <Text style={{fontSize: 16, fontWeight: '700', color: '#EAF3F6'}}>Become a Driver</Text>
                        <Text style={{fontSize: 14, fontWeight: '600', color: VOICES.driver.accent}}>{step} of 2</Text>
                    </View>

                    {step === 1 ? (
                        <View style={s.container}>
                            <Text style={[s.title, {fontSize: 22, fontWeight: '800', color: '#EAF3F6'}]}>Account Info</Text>
                            {renderInput('Full Name', fullName, setFullName)}
                            {renderInput('Phone Number', phone, setPhone, { keyboardType: 'phone-pad' })}
                            {renderInput('Email Address', email, setEmail, { keyboardType: 'email-address', autoCapitalize: 'none' })}
                            {renderInput('Password', password, setPassword, { secureTextEntry: true })}

                            {/* Terms Checkbox */}
                            <TouchableOpacity
                                style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 }}
                                onPress={() => {
                                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                    setTermsAccepted(!termsAccepted);
                                }}
                            >
                                <View style={{
                                    width: 24, height: 24, borderRadius: 6,
                                    borderWidth: 2,
                                    borderColor: termsAccepted ? VOICES.driver.accent : 'rgba(255,255,255,0.2)',
                                    backgroundColor: termsAccepted ? VOICES.driver.accent : 'transparent',
                                    alignItems: 'center', justifyContent: 'center',
                                }}>
                                    {termsAccepted && <Ionicons name="checkmark" size={14} color="#0F0D16" />}
                                </View>
                                <Text style={{ flex: 1, color: 'rgba(255,255,255,0.6)', fontSize: 13, fontWeight: '500' }}>
                                    I accept the{' '}
                                    <Text
                                        style={{ color: VOICES.driver.accent, fontWeight: '700' }}
                                        onPress={() => Linking.openURL(LEGAL_DOC_URLS.terms_of_service)}
                                    >
                                        Terms of Service
                                    </Text>
                                    {' '}and{' '}
                                    <Text
                                        style={{ color: VOICES.driver.accent, fontWeight: '700' }}
                                        onPress={() => Linking.openURL(LEGAL_DOC_URLS.privacy_policy)}
                                    >
                                        Privacy Policy
                                    </Text>
                                </Text>
                            </TouchableOpacity>

                            <TouchableOpacity style={s.primaryBtn} onPress={handleNext}>
                                <Text style={{fontSize: 16, fontWeight: '700', color: '#EAF3F6'}}>Next →</Text>
                            </TouchableOpacity>
                        </View>
                    ) : (
                        <View style={s.container}>
                            <Text style={[s.title, {fontSize: 22, fontWeight: '800', color: '#EAF3F6'}]}>Vehicle Info</Text>
                            {renderInput('Vehicle Model (e.g. 2022 Toyota Aqua)', vehicleModel, setVehicleModel)}
                            {renderInput('Plate Number', licensePlate, setLicensePlate, { autoCapitalize: 'characters' })}

                            {/* Vehicle class pills — live from vehicle_classes (admin-controlled) */}
                            <Text style={[s.label, {fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.6)'}]}>VEHICLE CLASS</Text>
                            <View style={s.typeSelector}>
                                {vehicleClasses.map(vc => (
                                    <TouchableOpacity
                                        key={vc.key}
                                        style={[s.typePill, vehicleType === vc.key && s.typePillActive]}
                                        onPress={() => {
                                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                            setVehicleType(vc.key);
                                        }}
                                    >
                                        <Text style={{fontSize: 14, fontWeight: '600', color: vehicleType === vc.key ? "#EAF3F6" : 'rgba(255,255,255,0.6)'}}>{vc.label}</Text>
                                    </TouchableOpacity>
                                ))}
                            </View>

                            <Text style={[s.label, {fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.6)'}]}>KYC DOCUMENTS</Text>
                                                     <View style={s.docGrid}>
                            <TouchableOpacity style={[s.docCard, licenseFront && s.docCardActive]} onPress={() => pickImage(setLicenseFront)}>
                                <Ionicons name={licenseFront ? "checkmark-circle" : "card-outline"} size={24} color={licenseFront ? VOICES.driver.accent : 'rgba(255,255,255,0.6)'} />
                                <Text style={{fontSize: 11, fontWeight: '500', color: '#EAF3F6', marginTop: 8}}>License Front</Text>
                            </TouchableOpacity>
 
                            <TouchableOpacity style={[s.docCard, licenseBack && s.docCardActive]} onPress={() => pickImage(setLicenseBack)}>
                                <Ionicons name={licenseBack ? "checkmark-circle" : "card-outline"} size={24} color={licenseBack ? VOICES.driver.accent : 'rgba(255,255,255,0.6)'} />
                                <Text style={{fontSize: 11, fontWeight: '500', color: '#EAF3F6', marginTop: 8}}>License Back</Text>
                            </TouchableOpacity>
 
                            <TouchableOpacity style={[s.docCard, vehiclePhoto && s.docCardActive]} onPress={() => pickImage(setVehiclePhoto)}>
                                <Ionicons name={vehiclePhoto ? "checkmark-circle" : "car-outline"} size={24} color={vehiclePhoto ? VOICES.driver.accent : 'rgba(255,255,255,0.6)'} />
                                <Text style={{fontSize: 11, fontWeight: '500', color: '#EAF3F6', marginTop: 8}}>Vehicle Photo</Text>
                            </TouchableOpacity>
                        </View>

                        <TouchableOpacity style={[s.primaryBtn, loading && s.disabled]} onPress={handleRegister} disabled={loading}>
                            {loading ? <ActivityIndicator color="#EAF3F6" /> : <Text style={{fontSize: 16, fontWeight: '700', color: '#EAF3F6'}}>Submit Application</Text>}
                        </TouchableOpacity>
                        </View>
                    )}

                </ScrollView>
            </KeyboardAvoidingView>
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: '#0F0D16' },
    scroll: { paddingHorizontal: 24, paddingBottom: 40 },
    headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 40 },
    backBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' },
    container: { width: '100%' },
    title: { marginBottom: 32, letterSpacing: -1 },
 
    inputWrap: { height: 64, backgroundColor: 'rgba(26, 21, 48, 0.4)', borderRadius: 20, paddingHorizontal: 20, justifyContent: 'center', marginBottom: 16, ...ghostBorder(0.15) },
    input: { flex: 1, color: '#EAF3F6', fontSize: 16 },
 
    label: { marginTop: 16, marginBottom: 12, marginLeft: 4, letterSpacing: 1 },
    typeSelector: { flexDirection: 'row', gap: 10, marginBottom: 40 },
    typePill: { flex: 1, height: 50, borderRadius: 15, ...ghostBorder(0.15), alignItems: 'center', justifyContent: 'center' },
    typePillActive: { backgroundColor: VOICES.driver.accent, borderColor: VOICES.driver.accent },
 
    primaryBtn: { height: 64, backgroundColor: VOICES.driver.accent, borderRadius: 32, alignItems: 'center', justifyContent: 'center', shadowColor: VOICES.driver.accent, shadowRadius: 15, shadowOpacity: 0.3, elevation: 8, marginTop: 10 },
    disabled: { opacity: 0.7 },
 
    docGrid: { flexDirection: 'row', gap: 10, marginBottom: 30 },
    docCard: { flex: 1, height: 90, backgroundColor: 'rgba(26, 21, 48, 0.4)', borderRadius: 15, alignItems: 'center', justifyContent: 'center', ...ghostBorder(0.15) },
    docCardActive: { borderColor: VOICES.driver.accent, backgroundColor: VOICES.driver.accent + '0D' },
});
