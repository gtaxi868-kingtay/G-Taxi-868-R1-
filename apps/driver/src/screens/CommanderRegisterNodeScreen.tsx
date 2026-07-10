import React, { useState } from 'react';
import {
    View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
    ActivityIndicator, Alert, Share, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@gtaxi/core';

// Local token bridge — mirrors packages/design-system/src/tokens.ts VOICES.driver,
// same convention as CommanderDashboardScreen (design-system doesn't export
// COLORS/TYPOGRAPHY directly for RN consumers).
const COLORS = {
    primary: '#34E6EC',
    gold: '#E6B450',
    background: '#08090D',
    surface: '#141821',
    borderLight: 'rgba(255,255,255,0.10)',
    textPrimary: '#EAF3F6',
    textSecondary: 'rgba(242,245,248,0.68)',
    textTertiary: 'rgba(242,245,248,0.42)',
    error: '#EF4444',
};

type Step = 'scan' | 'form' | 'success';

interface Coords { lat: number; lng: number }

export function CommanderRegisterNodeScreen() {
    const navigation = useNavigation();

    const [step, setStep] = useState<Step>('scan');
    const [scanning, setScanning] = useState(false);
    const [tagUid, setTagUid] = useState<string | null>(null);
    const [coords, setCoords] = useState<Coords | null>(null);

    const [locationName, setLocationName] = useState('');
    const [address, setAddress] = useState('');
    const [merchantName, setMerchantName] = useState('');
    const [radius, setRadius] = useState('150');
    const [submitting, setSubmitting] = useState(false);
    const [inviteUrl, setInviteUrl] = useState<string | null>(null);

    const scanTag = async () => {
        setScanning(true);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        try {
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') {
                throw new Error('Location permission is required to register a spot.');
            }
            const position = await Location.getCurrentPositionAsync({});

            const mod = require('react-native-nfc-manager');
            const NfcManager = mod.default || mod;
            NfcManager.start();
            await NfcManager.requestTechnology(NfcManager.Tech.NfcA);
            const tag = await NfcManager.getTag();
            NfcManager.cancelTechnologyRequest();

            if (!tag?.id) {
                throw new Error('Could not read the tag. Hold your phone steady against it.');
            }

            setTagUid(tag.id);
            setCoords({ lat: position.coords.latitude, lng: position.coords.longitude });
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            setStep('form');
        } catch (err: any) {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            Alert.alert('Scan Failed', err.message || 'Could not read the tag or your location.');
        } finally {
            setScanning(false);
        }
    };

    const submit = async () => {
        if (!tagUid || !coords) return;
        if (!locationName.trim() || !address.trim()) {
            Alert.alert('Missing Info', 'Give the spot a name and an address before registering.');
            return;
        }
        setSubmitting(true);
        try {
            const { data, error } = await supabase.rpc('commander_register_node', {
                p_tag_uid: tagUid,
                p_location_name: locationName.trim(),
                p_address: address.trim(),
                p_lat: coords.lat,
                p_lng: coords.lng,
                p_merchant_name: merchantName.trim() || null,
                p_geofence_radius_m: parseInt(radius, 10) || 150,
            });
            if (error) throw error;

            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            setInviteUrl(data?.invite_url || null);
            setStep('success');
        } catch (err: any) {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            Alert.alert('Registration Failed', err.message || 'Could not register this spot. Try again.');
        } finally {
            setSubmitting(false);
        }
    };

    const shareInvite = async () => {
        if (!inviteUrl) return;
        try {
            await Share.share({
                message: `You're being invited to put ${merchantName || 'your store'} on the G-Taxi grid. Tap this link to claim your spot: ${inviteUrl}`,
            });
        } catch {
            // user dismissed the share sheet
        }
    };

    const registerAnother = () => {
        setTagUid(null);
        setCoords(null);
        setLocationName('');
        setAddress('');
        setMerchantName('');
        setRadius('150');
        setInviteUrl(null);
        setStep('scan');
    };

    return (
        <SafeAreaView style={styles.container} edges={['top']}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
                    <Ionicons name="chevron-back" size={28} color={COLORS.textPrimary} />
                </TouchableOpacity>
                <View style={styles.headerTitleContainer}>
                    <Ionicons name="add-circle-outline" size={20} color={COLORS.primary} />
                    <Text style={styles.headerTitle}>REGISTER NEW SPOT</Text>
                </View>
                <View style={{ width: 40 }} />
            </View>

            <KeyboardAvoidingView
                style={{ flex: 1 }}
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            >
                <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">

                    {step === 'scan' && (
                        <View style={styles.centerBlock}>
                            <View style={styles.scanIcon}>
                                {scanning ? (
                                    <ActivityIndicator color={COLORS.primary} size="large" />
                                ) : (
                                    <Ionicons name="radio-outline" size={48} color={COLORS.primary} />
                                )}
                            </View>
                            <Text style={styles.scanTitle}>Tap the Physical Tag</Text>
                            <Text style={styles.scanSub}>
                                Hold your phone against the NFC tag at this location.{'\n'}
                                We'll capture the tag and your GPS position together.
                            </Text>
                            <TouchableOpacity
                                style={[styles.primaryBtn, scanning && { opacity: 0.6 }]}
                                onPress={scanTag}
                                disabled={scanning}
                            >
                                <Ionicons name="scan-outline" size={18} color={COLORS.background} />
                                <Text style={styles.primaryBtnText}>{scanning ? 'SCANNING…' : 'SCAN TAG'}</Text>
                            </TouchableOpacity>
                        </View>
                    )}

                    {step === 'form' && (
                        <View>
                            <View style={styles.capturedBanner}>
                                <Ionicons name="checkmark-circle" size={18} color={COLORS.primary} />
                                <Text style={styles.capturedText}>
                                    Tag captured at {coords?.lat.toFixed(5)}, {coords?.lng.toFixed(5)}
                                </Text>
                            </View>

                            <Text style={styles.label}>SPOT NAME</Text>
                            <TextInput
                                style={styles.input}
                                value={locationName}
                                onChangeText={setLocationName}
                                placeholder="e.g. Ma Mook's Corner Shop"
                                placeholderTextColor={COLORS.textTertiary}
                            />

                            <Text style={styles.label}>ADDRESS</Text>
                            <TextInput
                                style={styles.input}
                                value={address}
                                onChangeText={setAddress}
                                placeholder="e.g. 12 Main Rd, Arima"
                                placeholderTextColor={COLORS.textTertiary}
                            />

                            <Text style={styles.label}>MERCHANT NAME (OPTIONAL)</Text>
                            <TextInput
                                style={styles.input}
                                value={merchantName}
                                onChangeText={setMerchantName}
                                placeholder="Who will you send the invite to?"
                                placeholderTextColor={COLORS.textTertiary}
                            />

                            <Text style={styles.label}>GEOFENCE RADIUS (METRES)</Text>
                            <TextInput
                                style={styles.input}
                                value={radius}
                                onChangeText={setRadius}
                                keyboardType="number-pad"
                                placeholder="150"
                                placeholderTextColor={COLORS.textTertiary}
                            />
                            <Text style={styles.helpText}>
                                A tight corner needs ~50m. A large lot or warehouse can take 300–500m.
                            </Text>

                            <TouchableOpacity
                                style={[styles.primaryBtn, submitting && { opacity: 0.6 }]}
                                onPress={submit}
                                disabled={submitting}
                            >
                                {submitting ? (
                                    <ActivityIndicator color={COLORS.background} />
                                ) : (
                                    <>
                                        <Ionicons name="cloud-upload-outline" size={18} color={COLORS.background} />
                                        <Text style={styles.primaryBtnText}>SUBMIT FOR APPROVAL</Text>
                                    </>
                                )}
                            </TouchableOpacity>

                            <Text style={styles.pendingNote}>
                                This spot goes live only after HQ reviews and approves it.
                            </Text>
                        </View>
                    )}

                    {step === 'success' && (
                        <View style={styles.centerBlock}>
                            <View style={[styles.scanIcon, { backgroundColor: COLORS.gold + '15' }]}>
                                <Ionicons name="gift-outline" size={48} color={COLORS.gold} />
                            </View>
                            <Text style={styles.scanTitle}>Submitted for Review</Text>
                            <Text style={styles.scanSub}>
                                Share this invite so the merchant can claim their spot. HQ will
                                approve the node once it's confirmed.
                            </Text>

                            <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: COLORS.gold }]} onPress={shareInvite}>
                                <Ionicons name="share-outline" size={18} color={COLORS.background} />
                                <Text style={styles.primaryBtnText}>SHARE INVITE</Text>
                            </TouchableOpacity>

                            <TouchableOpacity style={styles.secondaryBtn} onPress={registerAnother}>
                                <Text style={styles.secondaryBtnText}>REGISTER ANOTHER SPOT</Text>
                            </TouchableOpacity>
                        </View>
                    )}

                </ScrollView>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: COLORS.background },
    header: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 16, paddingVertical: 12,
        borderBottomWidth: 1, borderBottomColor: COLORS.borderLight,
    },
    backButton: { padding: 4 },
    headerTitleContainer: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    headerTitle: { fontSize: 16, fontWeight: '800', color: COLORS.textPrimary, letterSpacing: 2 },
    scrollContent: { padding: 24, flexGrow: 1 },
    centerBlock: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 40 },
    scanIcon: {
        width: 96, height: 96, borderRadius: 48,
        backgroundColor: COLORS.primary + '15',
        alignItems: 'center', justifyContent: 'center', marginBottom: 24,
    },
    scanTitle: { fontSize: 22, fontWeight: '800', color: COLORS.textPrimary, marginBottom: 10, textAlign: 'center' },
    scanSub: { fontSize: 14, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 21, marginBottom: 32 },
    primaryBtn: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
        backgroundColor: COLORS.primary, paddingVertical: 16, paddingHorizontal: 32,
        borderRadius: 100, width: '100%',
    },
    primaryBtnText: { fontSize: 14, fontWeight: '800', color: COLORS.background, letterSpacing: 1 },
    secondaryBtn: { marginTop: 16, padding: 12 },
    secondaryBtnText: { fontSize: 12, fontWeight: '700', color: COLORS.textTertiary, letterSpacing: 1 },
    capturedBanner: {
        flexDirection: 'row', alignItems: 'center', gap: 8,
        backgroundColor: COLORS.primary + '10', borderWidth: 1, borderColor: COLORS.primary + '30',
        borderRadius: 14, padding: 14, marginBottom: 28,
    },
    capturedText: { fontSize: 12, color: COLORS.textSecondary, flex: 1 },
    label: { fontSize: 11, fontWeight: '700', color: COLORS.textSecondary, letterSpacing: 1.5, marginBottom: 8, marginTop: 18 },
    input: {
        backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.borderLight,
        borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14,
        fontSize: 15, color: COLORS.textPrimary,
    },
    helpText: { fontSize: 11, color: COLORS.textTertiary, marginTop: 8, lineHeight: 16 },
    pendingNote: { fontSize: 11, color: COLORS.textTertiary, textAlign: 'center', marginTop: 16, lineHeight: 16 },
});
