import React, { useState, useEffect } from 'react';
import { View, ScrollView, StyleSheet, TouchableOpacity, Linking, Switch } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Txt } from '@/design-system/primitives';
import { GlassCard } from '@gtaxi/design-system/native';
import { ghostBorder } from '@gtaxi/design-system/utils/style-rules';
import { LEGAL_DOC_URLS } from '@g868/shared/legal';
import { usePlatformFlags } from '../hooks/usePlatformFlags';

// Same AsyncStorage key SettingsScreen.tsx reads/writes for "AI Route
// Opt-In" — this screen used to have its own disconnected useState here,
// so toggling it did nothing real. One key, one real control, shown in
// both places.
const AI_ROUTING_KEY = '@ai_routing_opt_in';

const CYAN = '#06B6D4';

export function LegalScreen({ navigation }: any) {
    const insets = useSafeAreaInsets();
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

    return (
        <View style={s.root}>
            <StatusBar style="light" />
            
            <LinearGradient
                colors={['#0F172A', '#1E1B4B', '#312E81']}
                style={StyleSheet.absoluteFillObject}
            />

            <View style={[s.header, { paddingTop: insets.top + 10 }]}>
                <TouchableOpacity 
                    style={s.backBtn} 
                    onPress={() => navigation.goBack()}
                >
                    <Ionicons name="chevron-back" size={22} color="#EAF3F6" />
                </TouchableOpacity>
                <Txt variant="headingM" weight="heavy" color="#EAF3F6" style={s.headerTitle}>
                    LEGAL & PRIVACY PROTOCOL
                </Txt>
            </View>

            <ScrollView
                contentContainerStyle={[s.scrollContent, { paddingBottom: insets.bottom + 40 }]}
                showsVerticalScrollIndicator={false}
            >
                <GlassCard style={s.card}>
                    <Txt variant="headingM" weight="heavy" color="#EAF3F6" style={s.sectionTitle}>
                        PLATFORM STATUS & VAT COMPLIANCE
                    </Txt>
                    <Txt variant="bodyReg" color="#AEA9B5" style={s.bodyText}>
                        G-Taxi operates as a principal connective network in this transaction. Your payment encompasses two distinct services: access to the G-Taxi platform and safety network, and the transportation service provided by separate Independent Contractors.
                    </Txt>
                    <Txt variant="bodyReg" color="#AEA9B5" style={s.bodyText}>
                        The 12.5% VAT is strictly carved out in compliance with the Board of Inland Revenue (BIR) of Trinidad and Tobago.
                    </Txt>
                </GlassCard>

                <GlassCard style={s.card}>
                    <Txt variant="headingM" weight="heavy" color="#EAF3F6" style={s.sectionTitle}>
                        CONNECTIVE NETWORK & SAFETY
                    </Txt>
                    <Txt variant="bodyReg" color="#AEA9B5" style={s.bodyText}>
                        We are a connective network using your location telemetry exclusively to keep you safe as you move. Our Service Providers (Drivers, Merchants, Couriers) are strictly separate, independent operators, not employees of G-Taxi.
                    </Txt>
                    <Txt variant="bodyReg" color="#AEA9B5" style={s.bodyText}>
                        Your biometric and payment data is handled through encrypted gateways. You retain control over your data and may request permanent identity purging at any time via your settings.
                    </Txt>
                </GlassCard>

                <GlassCard style={s.card}>
                    <Txt variant="headingM" weight="heavy" color="#EAF3F6" style={s.sectionTitle}>
                        AI GOVERNANCE & PRIVACY
                    </Txt>
                    <Txt variant="bodyReg" color="#AEA9B5" style={s.bodyText}>
                        Our Artificial Intelligence learns your habits to assist you, anticipate your needs, and secure your routes. Your personal data is never sold. It is used strictly to assist you.
                    </Txt>

                    {flags.aiRoutingOffered && (
                        <View style={s.optOutRow}>
                            <View style={s.optOutText}>
                                <Txt variant="bodyReg" weight="bold" color="#EAF3F6">AI Route Opt-In</Txt>
                                <Txt variant="caption" color="#AEA9B5">Share data for discount routes</Txt>
                            </View>
                            <Switch
                                trackColor={{ false: '#374151', true: CYAN }}
                                thumbColor={'#EAF3F6'}
                                ios_backgroundColor="#374151"
                                onValueChange={toggleAiRouting}
                                value={aiRouting}
                            />
                        </View>
                    )}
                </GlassCard>

                <TouchableOpacity style={s.docLinkCard} onPress={() => Linking.openURL(LEGAL_DOC_URLS.terms_of_service)}>
                    <Txt variant="headingM" weight="heavy" color="#EAF3F6" style={s.sectionTitle}>
                        Full Terms of Service
                    </Txt>
                    <Txt variant="bodyReg" color="#AEA9B5" style={s.bodyText}>
                        Read the full comprehensive Terms of Service governing your use of the G-Taxi ecosystem.
                    </Txt>
                    <View style={s.docLinkRow}>
                        <Txt variant="caption" color={CYAN} weight="bold">View Full Document →</Txt>
                    </View>
                </TouchableOpacity>

                <TouchableOpacity style={s.docLinkCard} onPress={() => Linking.openURL(LEGAL_DOC_URLS.privacy_policy)}>
                    <Txt variant="headingM" weight="heavy" color="#EAF3F6" style={s.sectionTitle}>
                        Full Privacy Policy
                    </Txt>
                    <Txt variant="bodyReg" color="#AEA9B5" style={s.bodyText}>
                        Compliant with the Data Protection Act, 2011 of Trinidad and Tobago and international GDPR standards.
                    </Txt>
                    <View style={s.docLinkRow}>
                        <Txt variant="caption" color={CYAN} weight="bold">View Full Document →</Txt>
                    </View>
                </TouchableOpacity>

                <TouchableOpacity style={s.docLinkCard} onPress={() => Linking.openURL(LEGAL_DOC_URLS.data_retention)}>
                    <Txt variant="headingM" weight="heavy" color="#EAF3F6" style={s.sectionTitle}>
                        Data Retention & Deletion Notice
                    </Txt>
                    <Txt variant="bodyReg" color="#AEA9B5" style={s.bodyText}>
                        How long we keep your data, and how to request permanent deletion.
                    </Txt>
                    <View style={s.docLinkRow}>
                        <Txt variant="caption" color={CYAN} weight="bold">View Full Document →</Txt>
                    </View>
                </TouchableOpacity>

                <TouchableOpacity style={s.docLinkCard} onPress={() => Linking.openURL(LEGAL_DOC_URLS.safety_policy)}>
                    <Txt variant="headingM" weight="heavy" color="#EAF3F6" style={s.sectionTitle}>
                        Safety & Incident Policy
                    </Txt>
                    <Txt variant="bodyReg" color="#AEA9B5" style={s.bodyText}>
                        How incidents are reported, investigated, and resolved.
                    </Txt>
                    <View style={s.docLinkRow}>
                        <Txt variant="caption" color={CYAN} weight="bold">View Full Document →</Txt>
                    </View>
                </TouchableOpacity>

                <TouchableOpacity style={s.docLinkCard} onPress={() => Linking.openURL(LEGAL_DOC_URLS.refund_policy)}>
                    <Txt variant="headingM" weight="heavy" color="#EAF3F6" style={s.sectionTitle}>
                        Refund & Cancellation Policy
                    </Txt>
                    <Txt variant="bodyReg" color="#AEA9B5" style={s.bodyText}>
                        When a ride, delivery, or booking qualifies for a refund or cancellation without a fee.
                    </Txt>
                    <View style={s.docLinkRow}>
                        <Txt variant="caption" color={CYAN} weight="bold">View Full Document →</Txt>
                    </View>
                </TouchableOpacity>

                <View style={s.footer}>
                    <Txt variant="caption" color="#AEA9B5" center style={{ opacity: 0.4 }}>
                        Governed by the laws of Trinidad and Tobago.
                    </Txt>
                    <Txt variant="caption" color="#AEA9B5" center style={{ opacity: 0.3, marginTop: 4 }}>
                        Last updated 2026-07-16.
                    </Txt>
                </View>
            </ScrollView>
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1 },
    header: { 
        flexDirection: 'row', 
        alignItems: 'center', 
        paddingHorizontal: 24, 
        marginBottom: 20,
        zIndex: 10,
    },
    headerTitle: { 
        marginLeft: 16, 
        letterSpacing: 2,
    },
    backBtn: { 
        width: 44, 
        height: 44, 
        borderRadius: 14, 
        backgroundColor: 'rgba(255,255,255,0.05)', 
        alignItems: 'center', 
        justifyContent: 'center',
        ...ghostBorder(0.1),
    },
    scrollContent: { 
        paddingHorizontal: 20,
        paddingTop: 10,
    },
    card: {
        marginBottom: 20,
        padding: 24,
    },
    sectionTitle: {
        marginBottom: 16,
        letterSpacing: 1,
    },
    bodyText: {
        lineHeight: 24,
        marginBottom: 16,
        opacity: 0.8,
    },
    optOutRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: 8,
        paddingTop: 16,
        borderTopWidth: 1,
        borderColor: 'rgba(255,255,255,0.1)',
    },
    optOutText: {
        flex: 1,
        marginRight: 16,
    },
    footer: {
        marginTop: 40,
        paddingBottom: 20,
    },
    docLinkCard: {
        marginBottom: 20,
        padding: 24,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: 'rgba(52,230,236,0.2)',
        backgroundColor: 'rgba(52,230,236,0.05)',
    },
    docLinkRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 8,
    },
});
