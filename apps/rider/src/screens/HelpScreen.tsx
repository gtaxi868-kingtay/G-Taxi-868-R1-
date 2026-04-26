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

import { tokens } from '../design-system/tokens';

const { width } = Dimensions.get('window');

// --- Rider Design Tokens (Deprecated local, using tokens) ---
const R = {
    bg: tokens.colors.background.base,
    surface: tokens.colors.background.surface,
    border: tokens.colors.glass.stroke,
    purple: tokens.colors.primary.purple,
    purpleLight: tokens.colors.primary.cyan,
    gold: '#F59E0B',
    white: tokens.colors.text.primary,
    muted: tokens.colors.text.secondary,
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
    const handleCall = () => Linking.openURL('tel:+18687031000');

    return (
        <View style={s.root}>
            <StatusBar style="light" />

            <View style={[s.header, { paddingTop: insets.top + 10 }]}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
                    <Ionicons name="chevron-back" size={24} color="#FFF" />
                </TouchableOpacity>
                <Txt variant="headingM" weight="heavy" color="#FFF" style={{ marginLeft: 16 }}>Help Center</Txt>
            </View>

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
                        <LinearGradient 
                            colors={[tokens.colors.primary.purple, tokens.colors.primary.cyan]} 
                            start={{x: 0, y: 0}} 
                            end={{x: 1, y: 0}}
                            style={s.btnGradient}
                        >
                            <Ionicons name="mail" size={20} color="#FFF" style={{ marginRight: 12 }} />
                            <Txt variant="bodyBold" color="#FFF">EMAIL SUPPORT</Txt>
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
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, marginBottom: 20 },
    backBtn: { width: 44, height: 44, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' },

    scroll: { paddingHorizontal: 20 },
    faqCard: { backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 28, padding: 20, marginBottom: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)', overflow: 'hidden' },
    faqCardActive: { borderColor: R.purple, backgroundColor: 'rgba(124,58,237,0.05)' },
    faqHeader: { flexDirection: 'row', alignItems: 'center' },
    faqIconWrap: { width: 44, height: 44, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' },
    faqBody: { marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.05)' },

    contactSection: { marginTop: 40 },
    supportBtn: { height: 64, borderRadius: 24, overflow: 'hidden', marginBottom: 16 },
    btnGradient: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
    callBtn: { height: 64, borderRadius: 24, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.02)' },
});
