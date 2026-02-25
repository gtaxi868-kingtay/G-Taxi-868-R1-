import React, { useEffect, useState } from 'react';
import { View, StyleSheet, FlatList, ActivityIndicator, SafeAreaView, TouchableOpacity } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { tokens } from '../design-system/tokens';
import { Txt, Surface } from '../design-system/primitives';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../../../../shared/supabase';

interface WalletTx {
    id: string;
    amount: number;
    transaction_type: string;
    description: string;
    created_at: string;
    status: string;
}

export function WalletScreen({ navigation }: any) {
    const { driver } = useAuth();
    const [balanceCents, setBalanceCents] = useState<number | null>(null);
    const [transactions, setTransactions] = useState<WalletTx[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!driver?.id) return;

        const fetchData = async () => {
            // 1. Fetch live balance
            const { data: balData } = await supabase.rpc('get_wallet_balance', { p_user_id: driver.id });
            if (balData !== null) setBalanceCents(Math.round(Number(balData)));

            // 2. Fetch transaction history
            const { data: txData } = await supabase
                .from('wallet_transactions')
                .select('*')
                .eq('user_id', driver.id)
                .order('created_at', { ascending: false })
                .limit(50);

            if (txData) setTransactions(txData);
            setLoading(false);
        };

        fetchData();
    }, [driver?.id]);

    const renderItem = ({ item }: { item: WalletTx }) => {
        const isCredit = item.amount > 0;
        const amountDisplay = (Math.abs(item.amount) / 100).toFixed(2);

        // Define icons and colors based on transaction type
        let icon = '💸';
        let color = isCredit ? tokens.colors.status.success : tokens.colors.text.primary;

        if (item.transaction_type === 'topup' || item.transaction_type === 'driver_payout') icon = '🏦';
        if (item.transaction_type === 'ride_payment' && !isCredit) {
            icon = '📉'; // Commission deduction
            color = tokens.colors.status.warning;
        }

        return (
            <Surface style={styles.txRow} intensity={20}>
                <View style={styles.txIconBox}>
                    <Txt variant="headingM">{icon}</Txt>
                </View>
                <View style={styles.txDetails}>
                    <Txt variant="bodyBold" color={tokens.colors.text.primary}>{item.description}</Txt>
                    <Txt variant="caption" color={tokens.colors.text.tertiary}>
                        {new Date(item.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                    </Txt>
                </View>
                <View style={styles.txAmount}>
                    <Txt variant="headingM" weight="bold" color={color}>
                        {isCredit ? '+' : '-'}${amountDisplay}
                    </Txt>
                    <Txt variant="small" color={item.status === 'completed' ? tokens.colors.status.success : tokens.colors.text.tertiary} style={{ textTransform: 'uppercase', marginTop: 2 }}>
                        {item.status}
                    </Txt>
                </View>
            </Surface>
        );
    };

    return (
        <SafeAreaView style={styles.container}>
            <StatusBar style="light" />

            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
                    <Surface style={styles.backSurface} intensity={40}>
                        <Txt variant="bodyBold" color={tokens.colors.text.primary}>← Back</Txt>
                    </Surface>
                </TouchableOpacity>
                <Txt variant="headingL" weight="bold" color={tokens.colors.text.primary}>Wallet</Txt>
                <View style={{ width: 60 }} />
            </View>

            {/* Main Balance Card */}
            <View style={styles.balanceContainer}>
                <Surface style={styles.balanceCard} intensity={40}>
                    <Txt variant="bodyBold" color={tokens.colors.text.secondary} style={{ marginBottom: 4 }}>
                        CURRENT BALANCE (TTD)
                    </Txt>
                    {balanceCents === null ? (
                        <ActivityIndicator color={tokens.colors.primary.purple} style={{ marginTop: 12 }} />
                    ) : (
                        <Txt variant="displayXL" weight="bold" color={balanceCents < 0 ? tokens.colors.status.error : tokens.colors.status.success}>
                            ${(balanceCents / 100).toFixed(2)}
                        </Txt>
                    )}
                    {balanceCents !== null && balanceCents <= -60000 && (
                        <View style={styles.warningBadge}>
                            <Txt variant="caption" weight="bold" color="#000">SYSTEM LOCKOUT CAP REACHED</Txt>
                        </View>
                    )}
                </Surface>
            </View>

            {/* Ledger List */}
            <View style={styles.ledgerHeader}>
                <Txt variant="bodyBold" color={tokens.colors.text.secondary}>Recent Transactions</Txt>
            </View>

            {loading ? (
                <View style={styles.loader}>
                    <ActivityIndicator size="large" color={tokens.colors.primary.purple} />
                </View>
            ) : (
                <FlatList
                    data={transactions}
                    keyExtractor={t => t.id}
                    renderItem={renderItem}
                    contentContainerStyle={styles.listContent}
                    showsVerticalScrollIndicator={false}
                    ListEmptyComponent={
                        <View style={styles.emptyState}>
                            <Txt variant="bodyReg" color={tokens.colors.text.tertiary}>No transactions found.</Txt>
                        </View>
                    }
                />
            )}
        </SafeAreaView>
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
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        paddingVertical: 16,
    },
    backBtn: {
        shadowColor: tokens.colors.primary.purple,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2,
        shadowRadius: 12,
        elevation: 8,
    },
    backSurface: {
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: 20,
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: tokens.colors.border.subtle,
    },
    balanceContainer: {
        paddingHorizontal: 20,
        paddingVertical: 16,
    },
    balanceCard: {
        padding: 32,
        borderRadius: 24,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: tokens.colors.border.subtle,
    },
    warningBadge: {
        backgroundColor: tokens.colors.status.warning,
        paddingHorizontal: 12,
        paddingVertical: 4,
        borderRadius: 12,
        marginTop: 12,
    },
    ledgerHeader: {
        paddingHorizontal: 24,
        paddingVertical: 16,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255,255,255,0.05)',
    },
    listContent: {
        padding: 20,
        gap: 12,
    },
    txRow: {
        flexDirection: 'row',
        padding: 16,
        borderRadius: 16,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.03)',
    },
    txIconBox: {
        width: 48,
        height: 48,
        borderRadius: 12,
        backgroundColor: 'rgba(255,255,255,0.05)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    txDetails: {
        flex: 1,
        marginLeft: 16,
        gap: 4,
    },
    txAmount: {
        alignItems: 'flex-end',
    },
    loader: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    emptyState: {
        padding: 40,
        alignItems: 'center',
    }
});
