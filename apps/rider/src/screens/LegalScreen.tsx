import React, { useState, useEffect } from 'react';
import { View, Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { Card, Row, Screen, Section, SPACE, Toggle, Txt, useTheme } from '../ui/kit';
import { LEGAL_DOC_URLS } from '@g868/shared/legal';
import { usePlatformFlags } from '../hooks/usePlatformFlags';

// Same AsyncStorage key SettingsScreen.tsx reads/writes for "AI Route
// Opt-In" — this screen used to have its own disconnected useState here,
// so toggling it did nothing real. One key, one real control, shown in
// both places.
const AI_ROUTING_KEY = '@ai_routing_opt_in';


export function LegalScreen({ navigation }: any) {
    const { flags } = usePlatformFlags();
    const [aiRouting, setAiRouting] = useState(false);

    useEffect(() => {
        AsyncStorage.getItem(AI_ROUTING_KEY)
            .then(val => setAiRouting(val === 'true'))
            .catch(() => {});
    }, []);

    const toggleAiRouting = async (value: boolean) => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        setAiRouting(value);
        await AsyncStorage.setItem(AI_ROUTING_KEY, value ? 'true' : 'false');
    };

    const m = useTheme();
    const doc = (title: string, body: string, url: string, last?: boolean) => (
        <Row icon="document-text-outline" title={title} subtitle={body} onPress={() => Linking.openURL(url)} last={last} />
    );
    return (
        <Screen title="Legal and privacy" onBack={() => navigation.goBack()}>
            <Card style={{ marginTop: SPACE.sm }}>
                <Txt variant="headline">How G 868 works</Txt>
                <Txt variant="body" tone="dim" style={{ marginTop: SPACE.sm }}>
                    G-Taxi operates as a principal connective network in this transaction. Your payment encompasses two distinct services: access to the G-Taxi platform and safety network, and the transportation service provided by separate Independent Contractors.
                </Txt>
                <Txt variant="body" tone="dim" style={{ marginTop: SPACE.sm }}>
                    The 12.5% VAT is strictly carved out in compliance with the Board of Inland Revenue (BIR) of Trinidad and Tobago.
                </Txt>
            </Card>

            <Card style={{ marginTop: SPACE.md }}>
                <Txt variant="headline">Your safety and your data</Txt>
                <Txt variant="body" tone="dim" style={{ marginTop: SPACE.sm }}>
                    We are a connective network using your location telemetry exclusively to keep you safe as you move. Our Service Providers (Drivers, Merchants, Couriers) are strictly separate, independent operators, not employees of G-Taxi.
                </Txt>
                <Txt variant="body" tone="dim" style={{ marginTop: SPACE.sm }}>
                    Your biometric and payment data is handled through encrypted gateways. You retain control over your data and may request permanent identity purging at any time via your settings.
                </Txt>
            </Card>

            <Card style={{ marginTop: SPACE.md }}>
                <Txt variant="headline">G assistant and privacy</Txt>
                <Txt variant="body" tone="dim" style={{ marginTop: SPACE.sm }}>
                    Our Artificial Intelligence learns your habits to assist you, anticipate your needs, and secure your routes. Your personal data is never sold. It is used strictly to assist you.
                </Txt>
                {flags.aiRoutingOffered && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: SPACE.lg }}>
                        <View style={{ flex: 1, marginRight: SPACE.md }}>
                            <Txt variant="bodyStrong">Smarter routes</Txt>
                            <Txt variant="caption" tone="dim">Share trip data for discounted routes</Txt>
                        </View>
                        <Toggle label="Smarter routes" value={aiRouting} onChange={toggleAiRouting} />
                    </View>
                )}
            </Card>

            <Section title="Full documents">
                <Card style={{ paddingVertical: SPACE.xs }}>
                    {doc('Terms of Service', 'The rules for using G 868', LEGAL_DOC_URLS.terms_of_service)}
                    {doc('Privacy Policy', 'Data Protection Act, 2011 of Trinidad and Tobago', LEGAL_DOC_URLS.privacy_policy)}
                    {doc('Data retention and deletion', 'How long we keep data, and how to delete it', LEGAL_DOC_URLS.data_retention)}
                    {doc('Safety and incident policy', 'How incidents are reported and resolved', LEGAL_DOC_URLS.safety_policy)}
                    {doc('Refunds and cancellations', 'When you get money back or pay no fee', LEGAL_DOC_URLS.refund_policy, true)}
                </Card>
            </Section>

            <Txt variant="caption" tone="faint" style={{ textAlign: 'center', marginTop: SPACE.xl }}>Governed by the laws of Trinidad and Tobago. Last updated 2026-07-16.</Txt>
        </Screen>
    );
}
