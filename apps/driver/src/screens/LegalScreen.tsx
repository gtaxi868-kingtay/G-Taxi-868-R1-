import React from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { SURFACE, VOICES, ANIMATION } from '@gtaxi/design-system';
import { ghostBorder, elevationGlow, glassSurface } from '@gtaxi/design-system/utils/style-rules';
import { LEGAL_DOC_URLS } from '@g868/shared/legal';

export function LegalScreen({ navigation }: { navigation: any }) {
    const insets = useSafeAreaInsets();

    return (
        <View style={s.root}>
            <StatusBar style="light" />
            <View style={[s.header, { paddingTop: insets.top + 10 }]}>
                <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()}>
                    <Ionicons name="chevron-back" size={24} color="#EAF3F6" />
                </TouchableOpacity>
                <Text style={{ marginLeft: 16, fontSize: 16, fontWeight: '800', color: '#EAF3F6' }}>
                    Operator Agreements
                </Text>
            </View>

            <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: insets.bottom + 40 }}>
                <TouchableOpacity
                    style={s.docLink}
                    onPress={() => Linking.openURL(LEGAL_DOC_URLS.terms_of_service)}
                >
                    <Text style={{ fontSize: 16, fontWeight: '700', color: '#EAF3F6', marginBottom: 4 }}>
                        Terms of Service
                    </Text>
                    <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', marginBottom: 8 }}>
                        Full Terms of Service governing the G-Taxi platform.
                        G-Taxi is a technology platform connecting independent providers with clients — not a transportation carrier.
                    </Text>
                    <Text style={{ fontSize: 12, fontWeight: '700', color: '#06B6D4' }}>
                        View Full Document →
                    </Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={[s.docLink, { marginTop: 0 }]}
                    onPress={() => Linking.openURL(LEGAL_DOC_URLS.driver_agreement)}
                >
                    <Text style={{ fontSize: 16, fontWeight: '700', color: '#EAF3F6', marginBottom: 4 }}>
                        Driver & Operator Agreement
                    </Text>
                    <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', marginBottom: 8 }}>
                        Your independent-contractor status, payout terms, and platform conduct rules.
                    </Text>
                    <Text style={{ fontSize: 12, fontWeight: '700', color: '#06B6D4' }}>
                        View Full Document →
                    </Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={[s.docLink, { marginTop: 0 }]}
                    onPress={() => Linking.openURL(LEGAL_DOC_URLS.privacy_policy)}
                >
                    <Text style={{ fontSize: 16, fontWeight: '700', color: '#EAF3F6', marginBottom: 4 }}>
                        Privacy Policy
                    </Text>
                    <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', marginBottom: 8 }}>
                        Data collection, processing, and protection. Compliant with the Data Protection Act, 2011 of Trinidad and Tobago.
                    </Text>
                    <Text style={{ fontSize: 12, fontWeight: '700', color: '#06B6D4' }}>
                        View Full Document →
                    </Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={[s.docLink, { marginTop: 0 }]}
                    onPress={() => Linking.openURL(LEGAL_DOC_URLS.data_retention)}
                >
                    <Text style={{ fontSize: 16, fontWeight: '700', color: '#EAF3F6', marginBottom: 4 }}>
                        Data Retention & Deletion Notice
                    </Text>
                    <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', marginBottom: 8 }}>
                        How long we keep your data, and how to request permanent deletion.
                    </Text>
                    <Text style={{ fontSize: 12, fontWeight: '700', color: '#06B6D4' }}>
                        View Full Document →
                    </Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={[s.docLink, { marginTop: 0 }]}
                    onPress={() => Linking.openURL(LEGAL_DOC_URLS.safety_policy)}
                >
                    <Text style={{ fontSize: 16, fontWeight: '700', color: '#EAF3F6', marginBottom: 4 }}>
                        Safety & Incident Policy
                    </Text>
                    <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', marginBottom: 8 }}>
                        How incidents are reported, investigated, and resolved.
                    </Text>
                    <Text style={{ fontSize: 12, fontWeight: '700', color: '#06B6D4' }}>
                        View Full Document →
                    </Text>
                </TouchableOpacity>

                <View style={s.summaryCard}>
                    <Text style={{ marginBottom: 8, fontSize: 15, fontWeight: '700', color: '#EAF3F6' }}>
                        Independent Contractor Status
                    </Text>
                    <Text style={{ lineHeight: 22, fontSize: 13, fontWeight: '400', color: 'rgba(255,255,255,0.6)' }}>
                        You operate as an independent contractor — not an employee of G-Taxi. You control your hours, routes, and service decisions. Payouts are processed through the Platform Ledger with applicable platform fees deducted. See the full Terms of Service above for complete details.
                    </Text>
                </View>

                <View style={s.summaryCard}>
                    <Text style={{ marginBottom: 8, fontSize: 15, fontWeight: '700', color: '#EAF3F6' }}>
                        Privacy & Telemetry
                    </Text>
                    <Text style={{ lineHeight: 22, fontSize: 13, fontWeight: '400', color: 'rgba(255,255,255,0.6)' }}>
                        G-Taxi requires background location tracking while you are online for dispatch. Ride events are logged for dispute resolution. You may request account and data deletion via Profile Settings. Full details in our Privacy Policy.
                    </Text>
                </View>

                <Text style={{ textAlign: 'center', fontSize: 11, color: 'rgba(255,255,255,0.2)', marginTop: 32 }}>
                    Governed by the laws of Trinidad and Tobago. Caribbean-region scalable. Last updated 2026-06-18.
                </Text>
            </ScrollView>
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: '#0A0718' },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, marginBottom: 32 },
    backBtn: { width: 44, height: 44, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' },
    docLink: {
        padding: 20,
        borderRadius: 16,
        backgroundColor: 'rgba(52,230,236,0.06)',
        borderWidth: 1,
        borderColor: 'rgba(52,230,236,0.15)',
        marginBottom: 16,
        marginTop: 8,
    },
    summaryCard: {
        padding: 20,
        borderRadius: 16,
        backgroundColor: 'rgba(255,255,255,0.04)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.08)',
        marginBottom: 16,
    },
});
