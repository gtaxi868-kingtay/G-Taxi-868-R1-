import React, { useEffect, useState } from 'react';
import { View, Pressable, FlatList, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import Reanimated, {
    useSharedValue, useAnimatedProps, withTiming,
    useDerivedValue
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@gtaxi/core';
import { useAuth } from '../context/AuthContext';
import { useInTab } from '../navigation/useInTab';
import { toast } from '../components/Toast';
import { CrystalFace, CrystalGradient, RAISED, RaisedIcon, BRAND_GRADIENT, BrandBadge, EmptyState, GUTTER, Header, Loading, RADIUS, Row, SPACE, Txt, useTheme } from '../ui/kit';

export function WalletScreen({ navigation }: any) {
    const inTab = useInTab(navigation);
    const { user } = useAuth();
    const insets = useSafeAreaInsets();

    const [balance, setBalance] = useState(0);
    const [transactions, setTransactions] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [balanceError, setBalanceError] = useState(false);

    const animatedBalance = useSharedValue(0);

    useEffect(() => {
        if (!user?.id) { setLoading(false); return; }

        fetchWalletData();

        const channel = supabase
            .channel(`wallet:${user.id}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'wallet_transactions',
                    filter: `user_id=eq.${user.id}`,
                },
                (payload) => {
                    fetchWalletData();
                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [user?.id]);

    const fetchWalletData = async () => {
        setLoading(true);
        try {
            const { data: balData, error: balError } = await supabase.rpc('get_wallet_balance', { p_user_id: user?.id });
            if (balError) {
                console.error('[WalletScreen] get_wallet_balance failed:', balError.message);
                setBalanceError(true);
            } else {
                setBalanceError(false);
                const realBal = (balData || 0) / 100;
                setBalance(realBal);
                animatedBalance.value = withTiming(realBal, { duration: 1500 });
            }

            const { data: txData, error: txError } = await supabase
                .from('wallet_transactions')
                .select('*')
                .eq('user_id', user?.id)
                .order('created_at', { ascending: false })
                .limit(20);

            if (txError) {
                console.error('[WalletScreen] wallet_transactions query failed:', txError.message);
            } else if (txData) {
                setTransactions(txData);
            }
        } catch (err) {
            console.error(err);
            toast('Could not load your wallet. Pull down to try again.', 'error');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    const fetchAllTransactions = async () => {
        setLoading(true);
        try {
            const { data: txData, error: txError } = await supabase
                .from('wallet_transactions')
                .select('*')
                .eq('user_id', user?.id)
                .order('created_at', { ascending: false })
                .limit(100);

            if (txError) {
                console.error('[WalletScreen] fetchAllTransactions failed:', txError.message);
                toast('Could not load the full history.', 'error');
            } else if (txData) {
                setTransactions(txData);
            }
        } catch (err) {
            console.error(err);
            toast('Could not load the full history.', 'error');
        } finally {
            setLoading(false);
        }
    };

    const onRefresh = () => {
        setRefreshing(true);
        fetchWalletData();
    };

    const m = useTheme();

    const renderTransaction = ({ item, index }: { item: any; index: number }) => {
        const isPositive = item.amount > 0;
        const date = new Date(item.created_at);
        return (
            <Row
                icon={isPositive ? 'arrow-down' : 'arrow-up'}
                title={item.description || 'Transaction'}
                subtitle={`${date.toLocaleDateString()} · ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
                last={index === transactions.length - 1}
                right={<Txt variant="bodyStrong" tone={isPositive ? 'success' : 'ink'}>{isPositive ? '+' : '-'}${Math.abs(item.amount / 100).toFixed(2)}</Txt>}
            />
        );
    };

    const action = (icon: any, label: string, onPress: () => void, primary?: boolean) => (
        <Pressable key={label} accessibilityRole="button" accessibilityLabel={label} onPress={() => { Haptics.selectionAsync(); onPress(); }}
            style={({ pressed }) => ({ flex: 1, alignItems: 'center', opacity: pressed ? 0.75 : 1 })}>
            {primary ? <BrandBadge icon={icon} size={52} round /> : (
                <View style={{ width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' }}>
                    <CrystalFace color="#6E5BE0" radius={26} />
                    <RaisedIcon name={icon} size={22} />
                </View>
            )}
            <Txt variant="label" style={{ marginTop: SPACE.sm }}>{label}</Txt>
        </Pressable>
    );

    return (
        <View style={{ flex: 1, backgroundColor: m.page }}>
            <StatusBar style={m.statusBar} />
            <Header title="Wallet" onBack={inTab ? undefined : () => navigation.goBack()} />
            {loading && !refreshing ? <Loading /> : (
                <FlatList<any>
                    data={transactions}
                    keyExtractor={item => item.id}
                    renderItem={renderTransaction}
                    contentContainerStyle={{ paddingHorizontal: GUTTER, paddingBottom: insets.bottom + SPACE.xxl }}
                    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={m.accent} colors={['#8B7CFF']} />}
                    ListHeaderComponent={
                        <>
                            <View style={{ borderRadius: RADIUS.card, overflow: 'hidden', marginTop: SPACE.sm }}>
                                <CrystalGradient colors={BRAND_GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ padding: SPACE.xl }}>
                                    <Txt variant="label" style={[RAISED, { color: '#FFFFFF' }]}>G-Coin balance</Txt>
                                    {balanceError ? (
                                        <Pressable accessibilityRole="button" onPress={fetchWalletData} style={{ marginTop: SPACE.md }}>
                                            <Txt variant="bodyStrong" tone="onBrand">Balance not available. Tap to try again.</Txt>
                                        </Pressable>
                                    ) : (
                                        <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: SPACE.xs }}>
                                            <Txt variant="hero" tone="onBrand" numberOfLines={1} adjustsFontSizeToFit style={[RAISED, { fontSize: 44, lineHeight: 50 }]}>${balance.toFixed(2)}</Txt>
                                            <Txt variant="bodyStrong" style={[RAISED, { color: '#FFFFFF', marginLeft: SPACE.sm }]}>TTD</Txt>
                                        </View>
                                    )}
                                </CrystalGradient>
                            </View>

                            <View style={{ flexDirection: 'row', marginTop: SPACE.xl }}>
                                {action('add', 'Add money', () => navigation.navigate('WalletTopUp'), true)}
                                {action('scan-outline', 'Pay at shop', () => navigation.navigate('NfcScan', { mode: 'pay' }))}
                                {action('cash-outline', 'Withdraw', () => navigation.navigate('CashWithdrawal'))}
                                {action('list-outline', 'Full history', () => { setLoading(true); fetchAllTransactions(); })}
                            </View>

                            <Txt variant="overline" tone="faint" style={{ marginTop: SPACE.xxl, marginBottom: SPACE.sm }}>RECENT ACTIVITY</Txt>
                        </>
                    }
                    ListEmptyComponent={<EmptyState icon="wallet-outline" title="No activity yet" body="Top-ups, rides paid with G-Coin and withdrawals will show here." />}
                />
            )}
        </View>
    );
}
