import React, { useEffect, useState } from 'react';
import { View, StyleSheet, SafeAreaView, TouchableOpacity, FlatList, ActivityIndicator, Alert } from 'react-native';
import { supabase } from '../../../../shared/supabase';
import { useAuth } from '../context/AuthContext';
import { tokens } from '../design-system/tokens';
import { Txt, Surface, Card } from '../design-system/primitives';
import { Ionicons } from '@expo/vector-icons';

export function WalletScreen({ navigation }: any) {
    const { user } = useAuth();
    const [balance, setBalance] = useState<number | null>(null);
    const [transactions, setTransactions] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (user?.id) {
            // Fetch balance
            supabase.rpc('get_wallet_balance', { p_user_id: user.id })
                .then(({ data, error }) => {
                    if (!error && data !== null) {
                        setBalance(data / 100); // Amount stored in cents
                    } else {
                        setBalance(0);
                    }
                });

            // Fetch transactions
            supabase
                .from('wallet_transactions')
                .select('id, amount, transaction_type, description, created_at, status')
                .eq('user_id', user.id)
                .order('created_at', { ascending: false })
                .limit(10)
                .then(({ data, error }) => {
                    if (data && !error) setTransactions(data);
                    setLoading(false);
                });
        } else {
            setLoading(false);
        }
    }, [user?.id]);

    const handleTopUp = (amount: number) => {
        navigation.navigate('WalletTopUp');
    };

    const getTransactionIconName = (type: string) => {
        switch (type) {
            case 'topup': return 'arrow-up-outline';
            case 'driver_payout': return 'cash-outline';
            case 'ride_payment': return 'car-outline';
            case 'refund': return 'arrow-undo-outline';
            default: return 'ellipse';
        }
    };

    const isOwed = balance !== null && balance < 0;

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.headerRow}>
                <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
                    <Txt variant="bodyBold" color={tokens.colors.primary.purple}>← Back</Txt>
                </TouchableOpacity>
                <Txt variant="headingM" weight="bold" color={tokens.colors.text.primary}>
                    G-Taxi Wallet
                </Txt>
            </View>

            {loading ? (
                <ActivityIndicator color={tokens.colors.primary.purple} style={{ marginTop: 40 }} />
            ) : (
                <FlatList
                    data={transactions}
                    keyExtractor={item => item.id}
                    contentContainerStyle={styles.scroll}
                    ListHeaderComponent={
                        <>
                            {/* Balance Card */}
                            <Card padding="xl" elevation="level3" radius="xl" style={styles.heroCard}>
                                <Txt variant="caption" weight="bold" color={tokens.colors.text.secondary}>AVAILABLE BALANCE</Txt>
                                <Txt
                                    variant="displayXL"
                                    weight="bold"
                                    color={isOwed ? tokens.colors.status.error : tokens.colors.primary.purple}
                                    style={{ marginVertical: 8 }}
                                >
                                    ${Math.abs(balance || 0).toFixed(2)} TTD
                                </Txt>
                            </Card>

                            {/* Top Up Section */}
                            <View style={styles.sectionHeader}>
                                <Txt variant="headingM" weight="bold" color={tokens.colors.text.primary}>
                                    Add Funds
                                </Txt>
                            </View>
                            <View style={styles.topUpGrid}>
                                {[20, 50, 100, 200].map(amount => (
                                    <TouchableOpacity
                                        key={amount}
                                        style={styles.topUpBtn}
                                        onPress={() => handleTopUp(amount)}
                                    >
                                        <Txt variant="headingM" weight="bold" color={tokens.colors.text.primary}>
                                            ${amount}
                                        </Txt>
                                        <Txt variant="caption" color={tokens.colors.text.secondary}>TTD</Txt>
                                    </TouchableOpacity>
                                ))}
                            </View>

                            <View style={[styles.sectionHeader, { marginTop: 32 }]}>
                                <Txt variant="headingM" weight="bold" color={tokens.colors.text.primary}>
                                    Recent Transactions
                                </Txt>
                            </View>
                        </>
                    }
                    ListEmptyComponent={
                        <Surface intensity={30} style={styles.emptyState}>
                            <Txt variant="bodyReg" color={tokens.colors.text.secondary}>No transactions yet.</Txt>
                        </Surface>
                    }
                    renderItem={({ item }) => {
                        const date = new Date(item.created_at);
                        const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                        const amountFormatted = (Math.abs(item.amount) / 100).toFixed(2);
                        const isPositive = item.amount >= 0;

                        return (
                            <Surface intensity={40} style={styles.txItem}>
                                <View style={styles.txIcon}>
                                    <Ionicons name={getTransactionIconName(item.transaction_type) as any} size={20} color={tokens.colors.text.secondary} />
                                </View>
                                <View style={{ flex: 1, paddingRight: 8 }}>
                                    <Txt variant="bodyBold" color={tokens.colors.text.primary} numberOfLines={1}>
                                        {item.description || item.transaction_type}
                                    </Txt>
                                    <Txt variant="caption" color={tokens.colors.text.secondary} style={{ marginTop: 4 }}>
                                        {date.toLocaleDateString()} • {timeStr}
                                    </Txt>
                                </View>
                                <Txt
                                    variant="bodyBold"
                                    weight="bold"
                                    color={isPositive ? tokens.colors.status.success : tokens.colors.status.error}
                                >
                                    {isPositive ? '+' : '-'}${amountFormatted}
                                </Txt>
                            </Surface>
                        );
                    }}
                />
            )}
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: tokens.colors.background.base },
    headerRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16 },
    backBtn: { position: 'absolute', left: 20, zIndex: 10, paddingVertical: 16 },
    scroll: { padding: 20 },
    heroCard: { alignItems: 'center', marginBottom: 32, borderWidth: 1, borderColor: tokens.colors.border.subtle },
    sectionHeader: { marginBottom: 16 },
    topUpGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
    topUpBtn: {
        flex: 1,
        minWidth: '45%',
        backgroundColor: tokens.colors.background.ambient,
        paddingVertical: 18,
        borderRadius: 16,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: tokens.colors.border.subtle,
    },
    emptyState: { padding: 32, alignItems: 'center', borderRadius: 16, borderWidth: 1, borderColor: tokens.colors.border.subtle, borderStyle: 'dashed' },
    txItem: { flexDirection: 'row', alignItems: 'center', padding: 16, borderRadius: 16, marginBottom: 12, borderWidth: 1, borderColor: tokens.colors.border.subtle },
    txIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.05)', justifyContent: 'center', alignItems: 'center', marginRight: 16 },
});
