import React, { useEffect, useState } from 'react';
import { View, StyleSheet, SafeAreaView, TouchableOpacity, ScrollView, ActivityIndicator, Linking } from 'react-native';
import { supabase } from '../../../../shared/supabase';
import { useAuth } from '../context/AuthContext';
import { tokens } from '../design-system/tokens';
import { Txt, Surface, Card } from '../design-system/primitives';
import { Ionicons } from '@expo/vector-icons';

export function WalletScreen({ navigation }: any) {
    const { driver } = useAuth();
    const [balance, setBalance] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (driver?.id) {
            supabase.rpc('get_wallet_balance', { p_user_id: driver.id })
                .then(({ data, error }) => {
                    if (!error && data !== null) {
                        setBalance(data / 100);
                    } else {
                        setBalance(0);
                    }
                    setLoading(false);
                });
        }
    }, [driver?.id]);

    const isOwed = balance !== null && balance < 0;
    const isGood = balance !== null && balance >= 0;

    const handleDeposit = () => {
        Linking.openURL('https://wa.me/18685550100?text=I need to settle my G-Taxi commission balance.');
    };

    return (
        <SafeAreaView style={styles.container}>
            <ScrollView contentContainerStyle={styles.scroll}>

                <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
                    <Txt variant="bodyBold" color={tokens.colors.primary.purple}>← Back</Txt>
                </TouchableOpacity>

                <Txt variant="headingL" weight="bold" color={tokens.colors.text.primary} style={styles.title}>
                    Commission Ledger
                </Txt>

                {loading ? (
                    <ActivityIndicator color={tokens.colors.primary.purple} style={{ marginTop: 40 }} />
                ) : (
                    <>
                        <Card padding="xl" elevation="level3" radius="xl" style={styles.heroCard}>
                            <Txt variant="caption" weight="bold" color={tokens.colors.text.secondary}>CURRENT BALANCE</Txt>
                            <Txt
                                variant="displayXL"
                                weight="bold"
                                color={isOwed ? tokens.colors.status.error : tokens.colors.primary.cyan}
                                style={{ marginVertical: 8 }}
                            >
                                ${Math.abs(balance || 0).toFixed(2)}
                            </Txt>
                            <Txt variant="bodyBold" color={tokens.colors.text.primary}>
                                {isOwed ? 'You owe the platform (19% cuts)' : 'All clear.'}
                            </Txt>

                            {isOwed && balance <= -600 && (
                                <View style={styles.lockWarning}>
                                    <Txt variant="caption" weight="bold" color={tokens.colors.background.base}>
                                        ⚠️ ACCOUNT RESTRICTED — CAP REACHED
                                    </Txt>
                                </View>
                            )}
                        </Card>

                        <Txt variant="headingM" weight="bold" color={tokens.colors.text.primary} style={styles.sectionTitle}>
                            How It Works
                        </Txt>

                        <Surface intensity={30} style={styles.infoBox}>
                            <View style={styles.infoRow}>
                                <Ionicons name="cash-outline" size={24} color={tokens.colors.status.success} style={{ marginRight: 16 }} />
                                <View style={{ flex: 1 }}>
                                    <Txt variant="bodyBold" color={tokens.colors.text.primary}>Cash Trips</Txt>
                                    <Txt variant="caption" color={tokens.colors.text.secondary} style={{ marginTop: 4 }}>
                                        You keep all the cash. We deduct our 19% fee from this ledger balance.
                                    </Txt>
                                </View>
                            </View>
                            <View style={styles.divider} />
                            <View style={styles.infoRow}>
                                <Ionicons name="card-outline" size={24} color={tokens.colors.primary.purple} style={{ marginRight: 16 }} />
                                <View style={{ flex: 1 }}>
                                    <Txt variant="bodyBold" color={tokens.colors.text.primary}>Card Trips</Txt>
                                    <Txt variant="caption" color={tokens.colors.text.secondary} style={{ marginTop: 4 }}>
                                        We collect the payment. Your 81% share is ADDED to this ledger balance.
                                    </Txt>
                                </View>
                            </View>
                            <View style={styles.divider} />
                            <View style={styles.infoRow}>
                                <Ionicons name="lock-closed-outline" size={24} color={tokens.colors.status.error} style={{ marginRight: 16 }} />
                                <View style={{ flex: 1 }}>
                                    <Txt variant="bodyBold" color={tokens.colors.text.primary}>The $600 Cap</Txt>
                                    <Txt variant="caption" color={tokens.colors.text.secondary} style={{ marginTop: 4 }}>
                                        If your balance reaches -$600, you cannot accept new rides until you settle via bank transfer.
                                    </Txt>
                                </View>
                            </View>
                        </Surface>

                        <TouchableOpacity style={styles.depositBtn} onPress={handleDeposit}>
                            <Txt variant="bodyBold" weight="bold" color={tokens.colors.background.base}>
                                Settle Balance via Transfer
                            </Txt>
                        </TouchableOpacity>

                    </>
                )}
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: tokens.colors.background.base },
    scroll: { padding: 20 },
    backBtn: { marginBottom: 16 },
    title: { marginBottom: 24 },
    heroCard: { alignItems: 'center', marginBottom: 32, borderWidth: 1, borderColor: tokens.colors.border.subtle },
    lockWarning: { marginTop: 16, backgroundColor: tokens.colors.status.error, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 12 },
    sectionTitle: { marginBottom: 16 },
    infoBox: { padding: 0, borderRadius: 16, borderWidth: 1, borderColor: tokens.colors.border.subtle, overflow: 'hidden' },
    infoRow: { flexDirection: 'row', alignItems: 'center', padding: 20 },
    divider: { height: 1, backgroundColor: tokens.colors.border.subtle, marginHorizontal: 20 },
    depositBtn: { marginTop: 32, backgroundColor: tokens.colors.primary.purple, paddingVertical: 18, borderRadius: 16, alignItems: 'center' },
});
