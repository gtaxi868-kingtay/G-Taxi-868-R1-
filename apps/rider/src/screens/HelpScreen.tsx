import React, { useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { Button, Card, Row, Screen, Section, SPACE, Txt, useTheme } from '../ui/kit';

const FAQ_ITEMS = [
    {
        question: 'How do I pay for my ride?',
        answer: 'Pay your driver in cash, or pay with G-Coin from your wallet. Choose before you confirm the ride.',
        icon: 'cash-outline',
    },
    {
        question: 'I left something in the car',
        answer: 'Open Your Trips, choose the ride, then tap "Report a problem with this trip" and pick Lost item. Our team will contact the driver for you.',
        icon: 'search-outline',
    },
    {
        question: 'How is my fare worked out?',
        answer: 'The estimate uses distance and time. The final fare can change if the route changes a lot, or if the driver waits for you.',
        icon: 'calculator-outline',
    },
    {
        question: 'What happens if I press SOS?',
        answer: 'G Guardian, a real person, is alerted with your ride and location, and you get buttons to call them straight away.',
        icon: 'shield-checkmark-outline',
    },
];

export function HelpScreen({ navigation }: any) {
    const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

    const toggleFAQ = (index: number) => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        setExpandedIndex(expandedIndex === index ? null : index);
    };

    const handleEmail = () => Linking.openURL('mailto:support@gtaxi.tt');
    const handleCall = () => Linking.openURL('tel:+18687031000');

    const m = useTheme();
    return (
        <Screen title="Help" onBack={() => navigation.goBack()}>
            <Section title="Common questions" style={{ marginTop: SPACE.sm }}>
                {FAQ_ITEMS.map((item, idx) => {
                    const open = expandedIndex === idx;
                    return (
                        <Card key={idx} style={{ marginBottom: SPACE.sm }}>
                            <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => toggleFAQ(idx)}
                                style={{ flexDirection: 'row', alignItems: 'center' }}>
                                <Ionicons name={item.icon as any} size={20} color={m.accent} />
                                <Txt variant="bodyStrong" style={{ flex: 1, marginHorizontal: SPACE.md }}>{item.question}</Txt>
                                <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={m.faint} />
                            </Pressable>
                            {open && <Txt variant="body" tone="dim" style={{ marginTop: SPACE.md }}>{item.answer}</Txt>}
                        </Card>
                    );
                })}
            </Section>

            <Section title="Still need help?">
                <Card style={{ paddingVertical: SPACE.xs }}>
                    <Row icon="flag-outline" title="Report a problem" subtitle="Refunds, lost items, safety and more" onPress={() => navigation.navigate('ReportProblem')} />
                    <Row icon="call-outline" title="Call us" subtitle="1-868-703-1000, day and night" onPress={handleCall} />
                    <Row icon="mail-outline" title="Email support" subtitle="support@gtaxi.tt" onPress={handleEmail} last />
                </Card>
            </Section>
        </Screen>
    );
}
