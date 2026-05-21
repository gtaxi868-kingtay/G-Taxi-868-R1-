import React, { useEffect, useState, useCallback } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity, TextInput,
    useWindowDimensions, ActivityIndicator, Alert,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { routeNfcTag, RoutedNode } from '@gtaxi/core';
import { supabase } from '@gtaxi/core';

const COLORS = {
    bg: '#0D0B1E',
    purple: '#7B5CF0',
    cyan: '#00E5FF',
    white: '#FFFFFF',
    textSecondary: 'rgba(255,255,255,0.6)',
    glassBg: 'rgba(255,255,255,0.06)',
    glassBorder: 'rgba(123,92,240,0.3)',
    success: '#00FF94',
    error: '#FF4D6D',
};

export function NfcScanScreen({ navigation, route }: any) {
    const { width } = useWindowDimensions();
    const insets = useSafeAreaInsets();
    const [mode, setMode] = useState<'scan' | 'manual'>('scan');
    const [manualToken, setManualToken] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }, []);

    const handleRoute = useCallback(async (token: string) => {
        setLoading(true);
        setError(null);
        try {
            const node: RoutedNode = await routeNfcTag(supabase, token);

            if (node.type === 'merchant') {
                navigation.replace('ServiceBooking', {
                    merchantId: node.merchant_id,
                    merchantName: node.merchant_name,
                    kioskNodeId: node.node_id,
                    tagUid: node.tag_uid,
                    pickup: {
                        latitude: node.lat,
                        longitude: node.lng,
                        address: node.location_name || node.merchant_name || 'Merchant Location',
                    },
                });
            } else if (node.type === 'taxi_stand') {
                navigation.replace('DestinationSearch', {
                    currentLocation: {
                        latitude: node.lat,
                        longitude: node.lng,
                        address: node.location_name || 'G-Taxi Stand',
                    },
                    source: 'nfc_kiosk',
                    kioskId: node.node_id,
                    sourceMetadata: {
                        kioskId: node.node_id,
                        locationName: node.location_name,
                        tagUid: node.tag_uid,
                    },
                });
            } else if (node.type === 'blank') {
                navigation.replace('TagMarker', {
                    tagUid: node.tag_uid,
                });
            } else {
                Alert.alert('Personal Tag', 'This tag is linked to a personal profile.');
                navigation.goBack();
            }
        } catch (err: any) {
            setError(err?.message || 'Failed to read tag. Please try again.');
        } finally {
            setLoading(false);
        }
    }, [navigation]);

    const scanNfc = async () => {
        try {
            const { NfcTechnology } = require('expo-nfc');
            const tag = await NfcTechnology.requestTechnologyAsync();
            if (tag?.id) {
                await handleRoute(tag.id);
            }
        } catch {
            Alert.alert(
                'NFC Unavailable',
                'NFC hardware is not available on this device. You can enter a tag code manually instead.',
                [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Enter Code', onPress: () => setMode('manual') },
                ]
            );
        }
    };

    const submitManual = () => {
        const trimmed = manualToken.trim();
        if (!trimmed) {
            setError('Please enter a tag code.');
            return;
        }
        handleRoute(trimmed);
    };

    const handleQrDeepLink = async () => {
        const { token } = route?.params || {};
        if (token) {
            await handleRoute(token);
        }
    };

    useEffect(() => {
        handleQrDeepLink();
    }, [route?.params?.token]);

    return (
        <View style={[s.container, { paddingTop: insets.top }]}>
            <LinearGradient colors={['#1A0533', '#0D1B4B']} style={StyleSheet.absoluteFillObject} />

            <TouchableOpacity style={[s.backBtn, { top: insets.top + 8 }]} onPress={() => navigation.goBack()}>
                <Ionicons name="close" size={28} color={COLORS.white} />
            </TouchableOpacity>

            <View style={s.content}>
                {loading ? (
                    <View style={s.centerContent}>
                        <ActivityIndicator size="large" color={COLORS.purple} />
                        <Text style={s.loadingText}>Reading tag...</Text>
                    </View>
                ) : mode === 'scan' ? (
                    <View style={s.centerContent}>
                        <BlurView intensity={40} tint="dark" style={s.scanCard}>
                            <View style={s.scanIconContainer}>
                                <Ionicons name="radio-outline" size={64} color={COLORS.purple} />
                            </View>
                            <Text style={s.scanTitle}>Tap or Scan</Text>
                            <Text style={s.scanSubtitle}>
                                Hold your phone near a G-Taxi NFC tag{'\n'}or scan a QR code
                            </Text>

                            <TouchableOpacity style={s.scanBtn} onPress={scanNfc}>
                                <Ionicons name="scan" size={22} color={COLORS.white} />
                                <Text style={s.scanBtnText}>Scan NFC Tag</Text>
                            </TouchableOpacity>

                            <TouchableOpacity style={s.manualBtn} onPress={() => setMode('manual')}>
                                <Text style={s.manualBtnText}>Enter code manually</Text>
                            </TouchableOpacity>
                        </BlurView>
                    </View>
                ) : (
                    <View style={s.centerContent}>
                        <BlurView intensity={40} tint="dark" style={s.scanCard}>
                            <Text style={s.scanTitle}>Enter Tag Code</Text>
                            <Text style={s.scanSubtitle}>
                                Type the code printed on the NFC tag
                            </Text>

                            <TextInput
                                style={s.input}
                                value={manualToken}
                                onChangeText={setManualToken}
                                placeholder="e.g. GTX-A7F3"
                                placeholderTextColor="rgba(255,255,255,0.3)"
                                autoCapitalize="characters"
                                autoCorrect={false}
                            />

                            {error && <Text style={s.errorText}>{error}</Text>}

                            <TouchableOpacity style={s.scanBtn} onPress={submitManual}>
                                <Ionicons name="arrow-forward" size={22} color={COLORS.white} />
                                <Text style={s.scanBtnText}>Look Up</Text>
                            </TouchableOpacity>

                            <TouchableOpacity style={s.manualBtn} onPress={() => setMode('scan')}>
                                <Ionicons name="radio-outline" size={18} color={COLORS.purple} />
                                <Text style={s.manualBtnText}>Scan instead</Text>
                            </TouchableOpacity>
                        </BlurView>
                    </View>
                )}
            </View>
        </View>
    );
}

const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: COLORS.bg },
    backBtn: { position: 'absolute', left: 16, zIndex: 10, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.1)', justifyContent: 'center', alignItems: 'center' },
    content: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 },
    centerContent: { width: '100%', alignItems: 'center' },
    loadingText: { color: COLORS.textSecondary, marginTop: 16, fontSize: 16 },
    scanCard: { width: '100%', borderRadius: 32, padding: 32, alignItems: 'center', overflow: 'hidden', borderWidth: 1, borderColor: COLORS.glassBorder },
    scanIconContainer: { width: 96, height: 96, borderRadius: 48, backgroundColor: COLORS.glassBg, justifyContent: 'center', alignItems: 'center', marginBottom: 24 },
    scanTitle: { fontSize: 24, fontWeight: '800', color: COLORS.white, marginBottom: 8 },
    scanSubtitle: { fontSize: 15, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 22, marginBottom: 32 },
    scanBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.purple, paddingHorizontal: 28, paddingVertical: 16, borderRadius: 16, gap: 8, marginBottom: 16 },
    scanBtnText: { color: COLORS.white, fontSize: 16, fontWeight: '700' },
    manualBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 12 },
    manualBtnText: { color: COLORS.purple, fontSize: 14, fontWeight: '600' },
    input: { width: '100%', backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 16, padding: 16, fontSize: 20, color: COLORS.white, textAlign: 'center', fontWeight: '700', letterSpacing: 4, marginBottom: 24, borderWidth: 1, borderColor: COLORS.glassBorder },
    errorText: { color: COLORS.error, fontSize: 14, marginBottom: 16 },
});
