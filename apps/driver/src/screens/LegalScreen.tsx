import React from 'react';
import { View, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { Txt } from '../design-system/primitives';
import { VOICES } from '../design-system';

export function LegalScreen({ navigation }: any) {
    const insets = useSafeAreaInsets();

    return (
        <View style={s.root}>
            <StatusBar style="light" />
            <View style={[s.header, { paddingTop: insets.top + 10 }]}>
                <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()}>
                    <Ionicons name="chevron-back" size={24} color="#FFF" />
                </TouchableOpacity>
                <Txt variant="headingM" weight="heavy" color="#FFF" style={{ marginLeft: 16 }}>
                    Operator Agreements
                </Txt>
            </View>

            <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: insets.bottom + 40 }}>
                <Txt variant="headingM" weight="bold" color="#FFF" style={{ marginBottom: 12 }}>
                    Privacy & Telemetry Policy
                </Txt>
                <Txt variant="bodyReg" color={VOICES.driver.textMuted} style={{ marginBottom: 24, lineHeight: 24 }}>
                    As an operator, G-Taxi requires persistent background location tracking while you are online to dispatch trips effectively. We log ride events for dispute resolution. You may terminate your account and erase your telemetry data permanently via the Profile Settings.
                </Txt>

                <Txt variant="headingM" weight="bold" color="#FFF" style={{ marginBottom: 12 }}>
                    Platform Terms of Service
                </Txt>
                <Txt variant="bodyReg" color={VOICES.driver.textMuted} style={{ lineHeight: 24 }}>
                     You are acting as an independent contractor. Financial payouts are handled via the Platform Ledger minus the automated routing fee (19% Pioneer / 22% Standard). Indebted operators below the threshold will face automated dispatch lockouts until the balance is resolved.
                </Txt>
            </ScrollView>
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: '#0A0718' },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, marginBottom: 32 },
    backBtn: { width: 44, height: 44, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' },
});
