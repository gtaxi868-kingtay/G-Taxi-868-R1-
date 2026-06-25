import React from 'react';
import { View, ScrollView, StyleSheet, TouchableOpacity, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { Txt } from '@/design-system/primitives';
import { LiquidGlass } from '@gtaxi/design-system/native';
import { SURFACE, VOICES } from '@gtaxi/design-system';
import { ghostBorder } from '@gtaxi/design-system/utils/style-rules';
import type { AppScreenProps } from '../navigation/types';

const CYAN = '#1DE0E6';

export function LegalScreen({ navigation }: AppScreenProps<'Legal'>) {
    const insets = useSafeAreaInsets();

    return (
        <View style={s.root}>
            <StatusBar style="light" />

            <View style={[s.header, { paddingTop: insets.top + 10 }]}>
                <LiquidGlass tier="chrome" voice="rider" style={{ flexDirection: 'row', alignItems: 'center', flex: 1, paddingVertical: 8, paddingHorizontal: 12 }}>
                    <TouchableOpacity 
                        style={s.backBtn} 
                        onPress={() => navigation.goBack()}
                    >
                        <Ionicons name="chevron-back" size={22} color="#FFF" />
                    </TouchableOpacity>
                    <Txt variant="headingM" weight="heavy" color="#FFF" style={s.headerTitle}>
                        LEGAL PROTOCOL
                    </Txt>
                </LiquidGlass>
            </View>

            <ScrollView
                contentContainerStyle={[s.scrollContent, { paddingBottom: insets.bottom + 40 }]}
                showsVerticalScrollIndicator={false}
            >
                <LiquidGlass tier="panel" voice="rider" style={s.card}>
                    <TouchableOpacity onPress={() => Linking.openURL('https://gtaxi.tt/legal/terms')}>
                        <Txt variant="headingM" weight="heavy" color="#FFF" style={s.sectionTitle}>
                            Terms of Service
                        </Txt>
                        <Txt variant="bodyReg" color="#AEA9B5" style={s.bodyText}>
                            Read the full Terms of Service — governing your use of the G-Taxi platform.
                            G-Taxi is a technology platform, not a transportation carrier.
                            Governed by the laws of Trinidad and Tobago.
                        </Txt>
                        <View style={s.docLinkRow}>
                            <Txt variant="caption" color={CYAN} weight="bold">View Full Document →</Txt>
                        </View>
                    </TouchableOpacity>
                </LiquidGlass>

                <LiquidGlass tier="panel" voice="rider" style={s.card}>
                    <TouchableOpacity onPress={() => Linking.openURL('https://gtaxi.tt/legal/privacy')}>
                        <Txt variant="headingM" weight="heavy" color="#FFF" style={s.sectionTitle}>
                            Privacy Policy
                        </Txt>
                        <Txt variant="bodyReg" color="#AEA9B5" style={s.bodyText}>
                            How we collect, use, and protect your personal data. Compliant with the
                            Data Protection Act, 2011 of Trinidad and Tobago and applicable Caribbean data protection laws.
                        </Txt>
                        <View style={s.docLinkRow}>
                            <Txt variant="caption" color={CYAN} weight="bold">View Full Document →</Txt>
                        </View>
                    </TouchableOpacity>
                </LiquidGlass>

                <LiquidGlass tier="panel" voice="rider" style={s.card}>
                    <Txt variant="headingM" weight="heavy" color="#FFF" style={s.sectionTitle}>
                        DATA SECURITY & PRIVACY
                    </Txt>
                    <Txt variant="bodyReg" color="#AEA9B5" style={s.bodyText}>
                        G-Taxi utilizes encryption to safeguard your movement data. We collect location telemetry exclusively for driver matching and security auditing. Your biometric and payment data is handled through encrypted gateways.
                    </Txt>
                    <Txt variant="bodyReg" color="#AEA9B5" style={s.bodyText}>
                        You retain control over your data and may request permanent deletion through your account settings or by contacting privacy@gtaxi.tt.
                    </Txt>
                </LiquidGlass>

                <LiquidGlass tier="panel" voice="rider" style={s.card}>
                    <Txt variant="headingM" weight="heavy" color="#FFF" style={s.sectionTitle}>
                        NETWORK CONDUCT
                    </Txt>
                    <Txt variant="bodyReg" color="#AEA9B5" style={s.bodyText}>
                        By engaging with the G-Taxi ecosystem, you agree to our standard of Professionalism and Safety. Service Providers (Drivers, Merchants, Couriers) are independent operators.
                    </Txt>
                    <Txt variant="bodyReg" color="#AEA9B5" style={s.bodyText}>
                        Platform fees vary by service vertical and are disclosed before each transaction. Violations of the Platform's conduct standards may result in account suspension or termination.
                    </Txt>
                </LiquidGlass>

                <View style={s.footer}>
                    <Txt variant="caption" color="#AEA9B5" center style={{ opacity: 0.4 }}>
                        Terms governed by the laws of Trinidad and Tobago.
                    </Txt>
                    <Txt variant="caption" color="#AEA9B5" center style={{ opacity: 0.3, marginTop: 4 }}>
                        Caribbean-region scalable. Last updated 2026-06-18.
                    </Txt>
                </View>
            </ScrollView>
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: SURFACE.base },
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
    footer: {
        marginTop: 40,
        paddingBottom: 20,
    },
    docLinkRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 8,
    },
});
