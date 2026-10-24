import React, { useEffect, useState, useCallback } from 'react';
import { View, Alert } from 'react-native';
import * as Haptics from 'expo-haptics';
import { routeNfcTag, RoutedNode, OutboxService, supabase } from '@gtaxi/core';

const OUTBOX = OutboxService.getInstance();
import { toast } from '../components/Toast';
import { BrandBadge, Button, Field, Loading, Screen, SPACE, Txt, useTheme } from '../ui/kit';
import { AppScreenProps } from '../navigation/types';
import { describeNfcFailure, releaseNfc } from '../utils/nfcErrors';

export function NfcScanScreen({ navigation, route }: AppScreenProps<'NfcScan'>) {
    const payMode = route?.params?.mode === 'pay';
    const [inputMode, setInputMode] = useState<'scan' | 'manual'>('scan');
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
            const { data: { session } } = await supabase.auth.getSession();
            if (session) {
                await OUTBOX.enqueueProofEvent({
                    eventType: 'TAP_EVENT',
                    tagUid: token,
                    userId: session.user.id,
                    nonce: `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
                    timestamp: new Date().toISOString(),
                });
            }

            if (payMode) {
                navigation.replace('NfcPay', {
                    merchantTagUid: token,
                });
                return;
            }

            const node: RoutedNode = await routeNfcTag(supabase, token);

            if (node.type === 'merchant') {
                navigation.replace('ServiceBooking', {
                    merchantId: node.merchant_id,
                    merchantName: node.merchant_name,
                    kioskNodeId: node.node_id,
                    tagUid: node.tag_uid,
                    pickup: {
                        latitude: node.lat || 0,
                        longitude: node.lng || 0,
                        address: node.location_name || node.merchant_name || 'Merchant Location',
                    },
                });
            } else if (node.type === 'taxi_stand') {
                navigation.replace('DestinationSearch', {
                    currentLocation: {
                        latitude: node.lat || 0,
                        longitude: node.lng || 0,
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
                toast('This is a personal G tag, not a pickup point or shop.');
                navigation.goBack();
            }
        } catch (err: any) {
            setError(err?.message || 'Failed to read tag. Please try again.');
        } finally {
            setLoading(false);
        }
    }, [navigation, payMode]);

    const scanNfc = async () => {
        const mod = require('react-native-nfc-manager');
        const NfcManager = mod.default || mod;
        try {
            await NfcManager.start();
            await NfcManager.requestTechnology(NfcManager.Tech.NfcA);
            const tag = await NfcManager.getTag();
            await releaseNfc(NfcManager);
            if (tag?.id) {
                await handleRoute(tag.id);
            }
        } catch {
            await releaseNfc(NfcManager);
            const { title, message } = await describeNfcFailure(NfcManager);
            Alert.alert(title, message + ' You can also enter the tag code instead.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Enter Code', onPress: () => setInputMode('manual') },
            ]);
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

    const m = useTheme();
    return (
        <Screen onBack={() => navigation.goBack()} title={payMode ? 'Pay at a shop' : 'Tap a G point'}>
            {loading ? (
                <View style={{ paddingTop: SPACE.xxl }}><Loading /><Txt variant="body" tone="dim" style={{ textAlign: 'center' }}>Reading the tag…</Txt></View>
            ) : inputMode === 'scan' ? (
                <View style={{ alignItems: 'center', paddingTop: SPACE.xxl }}>
                    <BrandBadge icon="radio-outline" size={96} round />
                    <Txt variant="hero" style={{ textAlign: 'center', marginTop: SPACE.xl }}>{payMode ? 'Tap to pay' : 'Tap or scan'}</Txt>
                    <Txt variant="body" tone="dim" style={{ textAlign: 'center', marginTop: SPACE.sm }}>
                        {payMode ? "Hold your phone to the shop's G tag to pay with G-Coin." : 'Hold your phone near a G tag to book from where you are.'}
                    </Txt>
                    <Button title="Start scanning" icon="scan" style={{ alignSelf: 'stretch', marginTop: SPACE.xxl }} onPress={scanNfc} />
                    <Button title="Type the code instead" variant="ghost" style={{ alignSelf: 'stretch', marginTop: SPACE.md }} onPress={() => setInputMode('manual')} />
                </View>
            ) : (
                <View style={{ paddingTop: SPACE.lg }}>
                    <Txt variant="title">Enter the tag code</Txt>
                    <Txt variant="body" tone="dim" style={{ marginTop: SPACE.xs, marginBottom: SPACE.lg }}>
                        {payMode ? "It's printed on the shop's G tag." : "It's printed on the G tag."}
                    </Txt>
                    <Field placeholder="e.g. GTX-A7F3" value={manualToken} onChangeText={setManualToken} autoCapitalize="characters" autoCorrect={false} error={error} onSubmitEditing={submitManual} />
                    <Button title="Continue" onPress={submitManual} />
                    <Button title="Scan instead" variant="ghost" style={{ marginTop: SPACE.md }} onPress={() => { setError(null); setInputMode('scan'); }} />
                </View>
            )}
            {error && inputMode === 'scan' ? <Txt variant="bodyStrong" tone="danger" style={{ textAlign: 'center', marginTop: SPACE.lg }}>{error}</Txt> : null}
        </Screen>
    );
}
