import React, { useState } from 'react';
import { View, ScrollView, StyleSheet, TouchableOpacity, Linking, Switch } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Txt } from '@/design-system/primitives';
import { GlassCard } from '@gtaxi/design-system/native';
import { ghostBorder } from '@gtaxi/design-system/utils/style-rules';

const CYAN = '#06B6D4';

export function LegalScreen({ navigation }: any) {
    const insets = useSafeAreaInsets();
    const [aiEnabled, setAiEnabled] = useState(true);

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
                    
                    <View style={s.optOutRow}>
                        <View style={s.optOutText}>
                            <Txt variant="bodyReg" weight="bold" color="#EAF3F6">AI Predictive Assistance</Txt>
                            <Txt variant="caption" color="#AEA9B5">Allow AI to learn from your movement</Txt>
                        </View>
                        <Switch
                            trackColor={{ false: '#374151', true: CYAN }}
                            thumbColor={'#EAF3F6'}
                            ios_backgroundColor="#374151"
                            onValueChange={setAiEnabled}
                            value={aiEnabled}
                        />
                    </View>
                </GlassCard>

                <TouchableOpacity style={s.docLinkCard} onPress={() => Linking.openURL('https://gtaxi.tt/legal/terms')}>
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

                <TouchableOpacity style={s.docLinkCard} onPress={() => Linking.openURL('https://gtaxi.tt/legal/privacy')}>
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
