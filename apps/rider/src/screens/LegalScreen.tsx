import React from 'react';
import { View, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Txt, GlassCard } from '../design-system';
import { tokens } from '../design-system/tokens';

export function LegalScreen({ navigation }: any) {
    const insets = useSafeAreaInsets();

    return (
        <View style={s.root}>
            <StatusBar style="light" />
            
            {/* Ambient Background */}
            <LinearGradient
                colors={['#0F172A', '#1E1B4B', '#312E81']}
                style={StyleSheet.absoluteFillObject}
            />

            {/* Header */}
            <View style={[s.header, { paddingTop: insets.top + 10 }]}>
                <TouchableOpacity 
                    style={s.backBtn} 
                    onPress={() => navigation.goBack()}
                >
                    <Ionicons name="chevron-back" size={22} color={tokens.colors.text.primary} />
                </TouchableOpacity>
                <Txt variant="headingM" weight="heavy" color={tokens.colors.text.primary} style={s.headerTitle}>
                    LEGAL PROTOCOL
                </Txt>
            </View>

            <ScrollView 
                contentContainerStyle={[s.scrollContent, { paddingBottom: insets.bottom + 40 }]}
                showsVerticalScrollIndicator={false}
            >
                <GlassCard style={s.card}>
                    <Txt variant="headingM" weight="heavy" color={tokens.colors.text.primary} style={s.sectionTitle}>
                        DATA SECURITY & PRIVACY
                    </Txt>
                    <Txt variant="bodyReg" color={tokens.colors.text.secondary} style={s.bodyText}>
                        G-Taxi utilizes state-of-the-art encryption to safeguard your movement data. We collect location telemetry exclusively for driver matching and security auditing. Your biometric and payment data is handled through decentralized encrypted gateways and never touches our core servers.
                    </Txt>
                    <Txt variant="bodyReg" color={tokens.colors.text.secondary} style={s.bodyText}>
                        You retain total sovereignty over your dataset and may trigger a permanent "Right to be Forgotten" wipe through the Executive Settings at any time.
                    </Txt>
                </GlassCard>

                <GlassCard style={s.card}>
                    <Txt variant="headingM" weight="heavy" color={tokens.colors.text.primary} style={s.sectionTitle}>
                        NETWORK CONDUCT
                    </Txt>
                    <Txt variant="bodyReg" color={tokens.colors.text.secondary} style={s.bodyText}>
                        By engaging with the G-Taxi ecosystem, you agree to our standard of Professionalism and Safety. Operators (Drivers) are independent nodes in the logistics mesh.
                    </Txt>
                    <Txt variant="bodyReg" color={tokens.colors.text.secondary} style={s.bodyText}>
                        Platform fees are dynamically calculated based on network load and computational overhead, typically ranging from 18% to 22.5%. Any violation of the Network Trust Protocol will result in immediate and permanent revocation of access.
                    </Txt>
                </GlassCard>

                <View style={s.footer}>
                    <Txt variant="caption" color={tokens.colors.text.secondary} center style={{ opacity: 0.3 }}>
                        G-TAXI EMPIRE v1.0.0 • SYSTEM ACTIVE
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
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.1)',
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
    }
});
