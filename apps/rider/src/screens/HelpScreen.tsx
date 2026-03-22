import React, { useState } from 'react';
import {
    View, StyleSheet, FlatList, TouchableOpacity,
    SafeAreaView, Dimensions, Linking, ScrollView
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { Txt } from '../design-system/primitives';

const { width } = Dimensions.get('window');

// ── Rider Design Tokens ──────────────────────────────────────────────────────
const R = {
    bg: '#07050F',
    surface: '#110E22',
    border: 'rgba(255,255,255,0.08)',
    purple: '#7C3AED',
    purpleLight: '#A78BFA',
    gold: '#F59E0B',
    white: '#FFFFFF',
    muted: 'rgba(255,255,255,0.4)',
};

const FAQ_ITEMS = [
    {
        question: 'How do I pay for my ride?',
        answer: 'You can pay with Cash, Card, or G-Taxi Wallet. Select your preferred method before confirming your ride.',
        icon: 'card-outline'
    },
    {
        question: 'Vehicle sanitization policy',
        answer: 'All G-Taxi partners follow strict hygiene protocols, including regular vehicle cleaning and sanitization.',
        icon: 'shield-checkmark-outline'
    },
    {
        question: 'Lost Item Recovery',
        answer: 'If you left an item in a ride, go to Your Trips, select the ride, and tap "Report an Issue" to contact the driver.',
        icon: 'search-outline'
    },
    {
        question: 'Estimated Fare Accuracy',
        answer: 'Fare estimates include distance, time, and traffic. Final fares may vary slightly if the route changes significantly.',
        icon: 'calculator-outline'
    },
];

export function HelpScreen({ navigation }: any) {
    const insets = useSafeAreaInsets();
    const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

    const toggleFAQ = (index: number) => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        setExpandedIndex(expandedIndex === index ? null : index);
    };

    const handleEmail = () => Linking.openURL('mailto:support@gtaxi.tt');
    const handleCall = () => Linking.openURL('tel:+18681234567');

    return (
        <View style={s.root}>
            <StatusBar style="light" />

            <BlurView tint="dark" intensity={80} style={[s.header, { paddingTop: insets.top + 10 }]}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
                    <Ionicons name="chevron-back" size={24} color="#FFF" />
                </TouchableOpacity>
                <Txt variant="headingM" weight="heavy" color="#FFF">Help Center</Txt>
                <View style={{ width: 44 }} />
            </BlurView>

            <ScrollView contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 40 }]}>

                <Txt variant="bodyBold" color="#FFF" style={{ marginBottom: 20 }}>Common Questions</Txt>

                {FAQ_ITEMS.map((item, idx) => (
                    <TouchableOpacity
                        key={idx}
                        style={[s.faqCard, expandedIndex === idx && s.faqCardActive]}
                        onPress={() => toggleFAQ(idx)}
                        activeOpacity={0.9}
                    >
                        <View style={s.faqHeader}>
                            <View style={s.faqIconWrap}>
                                <Ionicons name={item.icon as any} size={20} color={R.purpleLight} />
                            </View>
                            <Txt variant="bodyBold" color="#FFF" style={{ flex: 1, marginLeft: 16 }}>{item.question}</Txt>
                            <Ionicons
                                name={expandedIndex === idx ? "chevron-up" : "chevron-down"}
                                size={18}
                                color={R.muted}
                            />
                        </View>
                        {expandedIndex === idx && (
                            <View style={s.faqBody}>
                                <Txt variant="bodyReg" color={R.muted}>{item.answer}</Txt>
                            </View>
                        )}
                    </TouchableOpacity>
                ))}

                <View style={s.contactSection}>
                    <Txt variant="bodyBold" color="#FFF" style={{ marginBottom: 16 }}>Need more help?</Txt>

                    <TouchableOpacity style={s.supportBtn} onPress={handleEmail}>
                        <LinearGradient colors={[R.purple, '#4C1D95']} style={s.btnGradient}>
                            <Ionicons name="mail" size={20} color="#FFF" style={{ marginRight: 12 }} />
                            <Txt variant="bodyBold" color="#FFF">Email Support</Txt>
                        </LinearGradient>
                    </TouchableOpacity>

                    <TouchableOpacity style={s.callBtn} onPress={handleCall}>
                        <Txt variant="bodyBold" color={R.white}>Call Hotline</Txt>
                    </TouchableOpacity>
                </View>

            </ScrollView>
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: R.bg },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 16, borderBottomWidth: 1, borderColor: R.border },
    backBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: R.surface, alignItems: 'center', justifyContent: 'center' },

    scroll: { padding: 24 },
    faqCard: { backgroundColor: R.surface, borderRadius: 20, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: R.border, overflow: 'hidden' },
    faqCardActive: { borderColor: R.purple },
    faqHeader: { flexDirection: 'row', alignItems: 'center' },
    faqIconWrap: { width: 40, height: 40, borderRadius: 10, backgroundColor: 'rgba(124,58,237,0.1)', alignItems: 'center', justifyContent: 'center' },
    faqBody: { marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.05)' },

    contactSection: { marginTop: 40 },
    supportBtn: { height: 60, borderRadius: 30, overflow: 'hidden', marginBottom: 16 },
    btnGradient: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
    callBtn: { height: 60, borderRadius: 30, borderWidth: 1, borderColor: R.border, alignItems: 'center', justifyContent: 'center' },
});
