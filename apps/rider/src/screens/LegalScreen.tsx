import React from 'react';
import { View, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { Txt } from '../design-system/primitives';
import { tokens } from '../design-system/tokens';

export function LegalScreen({ navigation }: any) {
    const insets = useSafeAreaInsets();

    return (
        <View style={s.root}>
            <StatusBar style="dark" />
            <View style={[s.header, { paddingTop: insets.top + 10 }]}>
                <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()}>
                    <Ionicons name="chevron-back" size={24} color={tokens.colors.text.primary} />
                </TouchableOpacity>
                <Txt variant="headingM" weight="heavy" color={tokens.colors.text.primary} style={{ marginLeft: 16 }}>
                    Legal & Privacy
                </Txt>
            </View>

            <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: insets.bottom + 40 }}>
                <Txt variant="headingM" weight="bold" color={tokens.colors.text.primary} style={{ marginBottom: 12 }}>
                    Privacy Policy
                </Txt>
                <Txt variant="bodyReg" color={tokens.colors.text.secondary} style={{ marginBottom: 24, lineHeight: 24 }}>
                    G-Taxi collects your location data to match you with nearby drivers and provide real-time tracking. We do not sell your personal data to third parties. Your payment information is securely processed via Stripe and never stored on our servers. You have the right to request a complete deletion of your account and associated data at any time via the Profile Settings.
                </Txt>

                <Txt variant="headingM" weight="bold" color={tokens.colors.text.primary} style={{ marginBottom: 12 }}>
                    Terms of Service
                </Txt>
                <Txt variant="bodyReg" color={tokens.colors.text.secondary} style={{ lineHeight: 24 }}>
                    By using G-Taxi, you agree to abide by our code of conduct. Drivers are independent contractors. G-Taxi platform fees are subject to dynamic changes based on market conditions (19%-22%). Inappropriate behavior will result in immediate termination of your account off the network.
                </Txt>
            </ScrollView>
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: tokens.colors.background.base },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, marginBottom: 32 },
    backBtn: { width: 44, height: 44, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.05)', alignItems: 'center', justifyContent: 'center' },
});
