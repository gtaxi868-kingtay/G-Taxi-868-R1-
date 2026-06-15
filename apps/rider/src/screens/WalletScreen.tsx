import React, { useEffect, useState } from 'react';
import {
    View, StyleSheet, TouchableOpacity, SafeAreaView,
    FlatList, ActivityIndicator, useWindowDimensions, RefreshControl, Alert
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import Reanimated, {
    useSharedValue, useAnimatedProps, withTiming,
    useDerivedValue
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@gtaxi/core';
import { useAuth } from '../context/AuthContext';
import { Txt } from '@/design-system/primitives';
import { SURFACE, VOICES, ANIMATION } from '@gtaxi/design-system';
import { ghostBorder, elevationGlow, glassSurface } from '@gtaxi/design-system/utils/style-rules';

const CYAN = '#06B6D4';

const R = {
    bg: SURFACE.base,
    surface: 'rgba(255,255,255,0.08)',
    surfaceHigh: 'rgba(255,255,255,0.1)',
    border: 'rgba(191,64,255,0.2)',
    purple: VOICES.rider.accent,
    purpleLight: VOICES.rider.accent,
    gold: '#F59E0B',
    green: '#32D74B',
    red: '#FF6E84',
    white: '#FFFFFF',
    muted: '#AEA9B5',
};

export function WalletScreen({ navigation }: any) {
    const { width } = useWindowDimensions();
    const { user } = useAuth();
    const insets = useSafeAreaInsets();

    const [balance, setBalance] = useState(0);
    const [transactions, setTransactions] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [balanceError, setBalanceError] = useState(false);

    const animatedBalance = useSharedValue(0);

    useEffect(() => {
        if (!user?.id) return;

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
            Alert.alert("Sync Issue", "Could not securely fetch your wallet balance. Pull down to refresh.");
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    const onRefresh = () => {
        setRefreshing(true);
        fetchWalletData();
    };

    const renderTransaction = ({ item }: { item: any }) => {
        const isPositive = item.amount > 0;
        const date = new Date(item.created_at);

        return (
            <View style={[s.txCard, { backgroundColor: 'rgba(255,255,255,0.02)' }]}>
                <View style={[s.txIcon, { backgroundColor: isPositive ? 'rgba(0,255,163,0.1)' : 'rgba(255,69,58,0.1)' }]}>
                    <Ionicons
                        name={isPositive ? "arrow-down" : "arrow-up"}
                        size={18}
                        color={isPositive ? CYAN : '#FF6E84'}
                    />
                </View>
                <View style={{ flex: 1, marginLeft: 16 }}>
                    <Txt variant="bodyBold" color={R.white} style={{ fontSize: 16 }}>{item.description || 'Transaction'}</Txt>
                    <Txt variant="small" color={R.muted}>{date.toLocaleDateString()} · {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Txt>
                </View>
                <Txt variant="bodyBold" color={isPositive ? '#BF40FF' : '#FFF'}>
                    {isPositive ? '+' : '-'}${Math.abs(item.amount / 100).toFixed(2)}
                </Txt>
            </View>
        );
    };
    if (loading) {
        return (
            <View style={[s.root, { alignItems: 'center', justifyContent: 'center' }]}>
                <ActivityIndicator color={VOICES.rider.accent} size="large" />
            </View>
        );
    }

    return (
        <View style={s.root}>
            <StatusBar style="light" />

            <View style={[s.header, { paddingTop: insets.top + 10 }]}>
                <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()} accessibilityLabel="Go back" accessibilityRole="button">
                    <Ionicons name="chevron-back" size={24} color="#FFF" />
                </TouchableOpacity>
                <Txt variant="headingM" weight="heavy" color="#FFF" style={{ marginLeft: 16 }}>Wallet</Txt>
            </View>

            <FlatList<any>
                data={transactions}
                keyExtractor={item => item.id}
                renderItem={renderTransaction}
                contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }}
                refreshControl={
                    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={VOICES.rider.accent} colors={[VOICES.rider.accent]} />
                }
                ListHeaderComponent={
                    <>
                        <LinearGradient colors={[VOICES.rider.accent, '#a88be0']} style={s.hero}>
                            <Txt variant="caption" weight="heavy" color="rgba(255,255,255,0.7)">Balance</Txt>
                            {balanceError ? (
                                <TouchableOpacity onPress={fetchWalletData} accessibilityLabel="Retry loading balance" accessibilityRole="button" style={{ marginVertical: 12, backgroundColor: 'rgba(255,100,100,0.2)', borderRadius: 12, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                    <Ionicons name="alert-circle-outline" size={18} color="#FFA0A0" />
                                    <Txt variant="bodyReg" color="#FFA0A0">Balance unavailable — tap to retry</Txt>
                                </TouchableOpacity>
                            ) : (
                                <View style={s.balanceRow}>
                                    <Txt variant="headingL" weight="heavy" color="#FFF" style={{ fontSize: 48 }}>${balance.toFixed(2)}</Txt>
                                    <Txt variant="bodyBold" color="rgba(255,255,255,0.7)" style={{ marginLeft: 8, marginTop: 12 }}>TTD</Txt>
                                </View>
                            )}
                            <View style={s.gCoinBadge}>
                                <Ionicons name="flash" size={12} color="#F59E0B" />
                                <Txt variant="caption" color="#F59E0B" style={{ marginLeft: 4 }}>G-Rewards active</Txt>
                            </View>
                        </LinearGradient>

                        <View style={s.actions}>
                            <TouchableOpacity style={s.actionBtn} accessibilityLabel="Add funds to wallet" accessibilityRole="button" onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); navigation.navigate('WalletTopUp'); }}>
                                <View style={s.actionIcon}>
                                    <LinearGradient 
                                        colors={[VOICES.rider.accent, CYAN]} 
                                        style={StyleSheet.absoluteFillObject} 
                                    />
                                    <Ionicons name="add" size={24} color="#FFF" />
                                </View>
                                <Txt variant="caption" weight="heavy" color="#FFF" style={{ marginTop: 12 }}>ADD FUNDS</Txt>
                            </TouchableOpacity>
                            <TouchableOpacity style={s.actionBtn} accessibilityLabel="Withdraw funds" accessibilityRole="button" onPress={() => Alert.alert(
                                'Withdraw Funds',
                                'Withdrawals are processed within 2 business days. Contact support to request a withdrawal.',
                                [{ text: 'OK' }]
                            )}>
                                <View style={s.actionIcon}><Ionicons name="swap-horizontal" size={22} color="rgba(255,255,255,0.6)" /></View>
                                <Txt variant="caption" weight="heavy" color="rgba(255,255,255,0.6)" style={{ marginTop: 12 }}>WITHDRAW</Txt>
                            </TouchableOpacity>
                            <TouchableOpacity style={s.actionBtn} accessibilityLabel="View transaction history" accessibilityRole="button" onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); navigation.navigate('Trips'); }}>
                                <View style={s.actionIcon}><Ionicons name="list" size={22} color="rgba(255,255,255,0.6)" /></View>
                                <Txt variant="caption" weight="heavy" color="rgba(255,255,255,0.6)" style={{ marginTop: 12 }}>HISTORY</Txt>
                            </TouchableOpacity>
                        </View>

                        <Txt variant="bodyBold" color="#FFF" style={{ marginBottom: 16 }}>RECENT ACTIVITY</Txt>
                    </>
                }
                ListEmptyComponent={
                    (!loading && transactions.length === 0) ? (
                        <View style={s.empty}>
                            <Txt variant="bodyReg" color={R.muted}>No transactions yet</Txt>
                        </View>
                    ) : null
                }
            />
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: SURFACE.base },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, marginBottom: 20 },
    backBtn: { width: 44, height: 44, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' },

    hero: { borderRadius: 40, padding: 32, marginBottom: 32, ...elevationGlow() },
    balanceRow: { flexDirection: 'row', alignItems: 'baseline', marginVertical: 8 },
    gCoinBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.3)', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 24, alignSelf: 'flex-start' },

    actions: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 44 },
    actionBtn: { alignItems: 'center', flex: 1 },
    actionIcon: { width: 64, height: 64, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.03)', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', ...ghostBorder(0.15) },

    txCard: { flexDirection: 'row', alignItems: 'center', padding: 20, borderRadius: 28, marginBottom: 12, ...ghostBorder(0.15), overflow: 'hidden' },
    txIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },

    empty: { marginTop: 40, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.02)', padding: 40, borderRadius: 32 },
});
