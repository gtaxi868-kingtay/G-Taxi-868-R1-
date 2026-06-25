import React from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { SURFACE, VOICES } from '@gtaxi/design-system';
import { LiquidGlass } from '@gtaxi/design-system/native';

export function LegalScreen({ navigation }: { navigation: any }) {
    const insets = useSafeAreaInsets();

    return (
        <View style={s.root}>
            <StatusBar style="light" />
            <LiquidGlass voice="driver" style={[s.header, { paddingTop: insets.top + 10 }]} tier="chrome">
                <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()}>
                    <Ionicons name="chevron-back" size={24} color="#FFF" />
                </TouchableOpacity>
                <Text style={{ marginLeft: 16, fontSize: 16, fontWeight: '800', color: '#FFF' }}>
                    Operator Agreements
                </Text>
            </LiquidGlass>

            <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: insets.bottom + 40 }}>
                <LiquidGlass voice="driver" style={s.docLink} tier="inlay">
                    <TouchableOpacity onPress={() => Linking.openURL('https://gtaxi.tt/legal/terms')}>
                        <Text style={s.docTitle}>Terms of Service</Text>
                        <Text style={s.docDesc}>
                            Full Terms of Service governing the G-Taxi platform.
                            G-Taxi is a technology platform connecting independent providers with clients — not a transportation carrier.
                        </Text>
                        <Text style={s.docLinkText}>View Full Document →</Text>
                    </TouchableOpacity>
                </LiquidGlass>

                <LiquidGlass voice="driver" style={s.docLink} tier="inlay">
                    <TouchableOpacity onPress={() => Linking.openURL('https://gtaxi.tt/legal/privacy')}>
                        <Text style={s.docTitle}>Privacy Policy</Text>
                        <Text style={s.docDesc}>
                            Data collection, processing, and protection. Compliant with the Data Protection Act, 2011 of Trinidad and Tobago.
                        </Text>
                        <Text style={s.docLinkText}>View Full Document →</Text>
                    </TouchableOpacity>
                </LiquidGlass>

                <LiquidGlass voice="driver" style={s.summaryCard} tier="inlay">
                    <Text style={s.summaryTitle}>Independent Contractor Status</Text>
                    <Text style={s.summaryDesc}>
                        You operate as an independent contractor — not an employee of G-Taxi. You control your hours, routes, and service decisions. Payouts are processed through the Platform Ledger with applicable platform fees deducted. See the full Terms of Service above for complete details.
                    </Text>
                </LiquidGlass>

                <LiquidGlass voice="driver" style={s.summaryCard} tier="inlay">
                    <Text style={s.summaryTitle}>Privacy & Telemetry</Text>
                    <Text style={s.summaryDesc}>
                        G-Taxi requires background location tracking while you are online for dispatch. Ride events are logged for dispute resolution. You may request account and data deletion via Profile Settings. Full details in our Privacy Policy.
                    </Text>
                </LiquidGlass>

                <Text style={{ textAlign: 'center', fontSize: 11, color: 'rgba(255,255,255,0.2)', marginTop: 32 }}>
                    Governed by the laws of Trinidad and Tobago. Caribbean-region scalable. Last updated 2026-06-18.
                </Text>
            </ScrollView>
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: '#0A0718' },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, marginBottom: 32, borderWidth: 0, paddingBottom: 12 },
    backBtn: { width: 44, height: 44, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' },
    docLink: {
        padding: 20,
        borderRadius: 16,
        marginBottom: 16,
        marginTop: 8,
        borderWidth: 0,
    },
    docTitle: { fontSize: 16, fontWeight: '700', color: '#FFF', marginBottom: 4 },
    docDesc: { fontSize: 13, color: 'rgba(255,255,255,0.5)', marginBottom: 8, lineHeight: 20 },
    docLinkText: { fontSize: 12, fontWeight: '700', color: VOICES.driver.accent },
    summaryCard: {
        padding: 20,
        borderRadius: 16,
        marginBottom: 16,
        borderWidth: 0,
    },
    summaryTitle: { marginBottom: 8, fontSize: 15, fontWeight: '700', color: '#FFF' },
    summaryDesc: { lineHeight: 22, fontSize: 13, fontWeight: '400', color: 'rgba(255,255,255,0.6)' },
});
