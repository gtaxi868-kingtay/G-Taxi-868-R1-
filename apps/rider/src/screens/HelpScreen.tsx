import React, { useEffect, useState } from 'react';
import { View, StyleSheet, FlatList, TouchableOpacity, SafeAreaView, Dimensions, Linking } from 'react-native';
import { Surface, Txt, Card } from '../design-system/primitives';
import { tokens } from '../design-system/tokens';
import { LinearGradient } from 'expo-linear-gradient';

const { width } = Dimensions.get('window');

const FAQ_ITEMS = [
    {
        question: 'How do I pay for my ride?',
        answer: 'You can pay with Cash or Card. Select your payment method before confirming your ride.',
    },
    {
        question: 'What if my driver doesn\'t show up?',
        answer: 'If your driver doesn\'t arrive within 10 minutes, you can cancel the ride for free and request another.',
    },
    {
        question: 'How do I report a lost item?',
        answer: 'Go to Your Trips, select the ride, and tap "Report an Issue" to contact your driver about lost items.',
    },
    {
        question: 'Can I schedule a ride in advance?',
        answer: 'Yes! Scheduled rides are available for airport pickups and other planned trips.',
    },
    {
        question: 'How are fares calculated?',
        answer: 'Fares are based on distance, estimated time, and current demand. You\'ll always see the estimated fare before booking.',
    },
];

export function HelpScreen({ navigation }: any) {
    const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

    const toggleFAQ = (index: number) => {
        setExpandedIndex(expandedIndex === index ? null : index);
    };

    const handleContactSupport = () => {
        Linking.openURL('mailto:support@gtaxi.tt?subject=G-Taxi%20Support%20Request');
    };

    const handleCallSupport = () => {
        Linking.openURL('tel:+18681234567');
    };

    const renderFAQItem = ({ item, index }: { item: typeof FAQ_ITEMS[0]; index: number }) => (
        <TouchableOpacity
            activeOpacity={0.7}
            style={{ marginBottom: 12 }}
            onPress={() => toggleFAQ(index)}
        >
            <Card style={styles.card} padding="md" elevation="level1">
                <View style={styles.questionRow}>
                    <Txt variant="bodyBold" style={{ flex: 1 }}>{item.question}</Txt>
                    <Txt variant="headingM">{expandedIndex === index ? '−' : '+'}</Txt>
                </View>
                {expandedIndex === index && (
                    <Txt variant="bodyReg" color={tokens.colors.text.secondary} style={{ marginTop: 12 }}>
                        {item.answer}
                    </Txt>
                )}
            </Card>
        </TouchableOpacity>
    );

    return (
        <View style={styles.container}>
            <LinearGradient
                colors={[tokens.colors.background.base, '#1A1A24']}
                style={StyleSheet.absoluteFill}
            />

            <SafeAreaView style={{ flex: 1 }}>
                {/* Header */}
                <View style={styles.header}>
                    <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
                        <Surface style={styles.backSurf} intensity={20}>
                            <Txt variant="headingM">←</Txt>
                        </Surface>
                    </TouchableOpacity>
                    <Txt variant="headingL" weight="bold">Help & Support</Txt>
                </View>

                {/* FAQ List */}
                <FlatList
                    data={FAQ_ITEMS}
                    renderItem={renderFAQItem}
                    keyExtractor={(item, index) => `faq-${index}`}
                    contentContainerStyle={styles.list}
                    ListHeaderComponent={
                        <View style={styles.sectionHeader}>
                            <Txt variant="headingM" weight="bold">Frequently Asked Questions</Txt>
                        </View>
                    }
                    ListFooterComponent={
                        <View style={styles.contactSection}>
                            <Txt variant="headingM" weight="bold" style={{ marginBottom: 16 }}>
                                Still need help?
                            </Txt>

                            <TouchableOpacity style={styles.contactBtn} onPress={handleContactSupport}>
                                <Card style={styles.contactCard} padding="md">
                                    <View style={styles.contactRow}>
                                        <Txt style={{ fontSize: 24, marginRight: 12 }}>✉️</Txt>
                                        <View>
                                            <Txt variant="bodyBold">Email Support</Txt>
                                            <Txt variant="caption" color={tokens.colors.text.secondary}>
                                                support@gtaxi.tt
                                            </Txt>
                                        </View>
                                    </View>
                                </Card>
                            </TouchableOpacity>

                            <TouchableOpacity style={styles.contactBtn} onPress={handleCallSupport}>
                                <Card style={styles.contactCard} padding="md">
                                    <View style={styles.contactRow}>
                                        <Txt style={{ fontSize: 24, marginRight: 12 }}>📞</Txt>
                                        <View>
                                            <Txt variant="bodyBold">Call Us</Txt>
                                            <Txt variant="caption" color={tokens.colors.text.secondary}>
                                                +1 (868) 123-4567
                                            </Txt>
                                        </View>
                                    </View>
                                </Card>
                            </TouchableOpacity>
                        </View>
                    }
                />
            </SafeAreaView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: tokens.colors.background.base,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 20,
    },
    backBtn: {
        marginRight: 16,
    },
    backSurf: {
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
    },
    list: {
        padding: 20,
    },
    sectionHeader: {
        marginBottom: 16,
    },
    card: {
        backgroundColor: 'rgba(255,255,255,0.03)',
    },
    questionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    contactSection: {
        marginTop: 32,
        paddingTop: 24,
        borderTopWidth: 1,
        borderTopColor: 'rgba(255,255,255,0.05)',
    },
    contactBtn: {
        marginBottom: 12,
    },
    contactCard: {
        backgroundColor: 'rgba(255,255,255,0.03)',
    },
    contactRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
});
