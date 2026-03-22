import React, { useEffect, useState } from 'react';
import {
    View, StyleSheet, TouchableOpacity, SafeAreaView,
    FlatList, ActivityIndicator, Dimensions
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import Reanimated, {
    useSharedValue, useAnimatedProps, withTiming,
    useDerivedValue
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../../shared/supabase';
import { useAuth } from '../context/AuthContext';
import { Txt } from '../design-system/primitives';

const { width } = Dimensions.get('window');

// ── Rider Design Tokens ──────────────────────────────────────────────────────
const R = {
    bg: '#07050F',
    surface: '#110E22',
    surfaceHigh: '#1A1530',
    border: 'rgba(255,255,255,0.08)',
    purple: '#7C3AED',
    purpleLight: '#A78BFA',
    gold: '#F59E0B',
    green: '#10B981',
    red: '#EF4444',
    white: '#FFFFFF',
    muted: 'rgba(255,255,255,0.4)',
};

export function WalletScreen({ navigation }: any) {
    const { user } = useAuth();
    const insets = useSafeAreaInsets();

    const [balance, setBalance] = useState(0);
    const [transactions, setTransactions] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    const animatedBalance = useSharedValue(0);

    useEffect(() => {
        if (user?.id) fetchWalletData();
    }, [user?.id]);

    const fetchWalletData = async () => {
        setLoading(true);
        try {
            // BUG_FIX: Ensure wallet_balance is fetched correctly
            const { data: balData } = await supabase.rpc('get_wallet_balance', { p_user_id: user?.id });
            const realBal = (balData || 0) / 100;
            setBalance(realBal);
            animatedBalance.value = withTiming(realBal, { duration: 1500 });

            const { data: txData } = await supabase
                .from('wallet_transactions')
                .select('*')
                .eq('user_id', user?.id)
                .order('created_at', { ascending: false })
                .limit(20);

            if (txData) setTransactions(txData);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const renderTransaction = ({ item }: { item: any }) => {
        const isPositive = item.amount > 0;
        const date = new Date(item.created_at);

        return (
            <BlurView tint="dark" intensity={40} style={s.txCard}>
                <View style={[s.txIcon, { backgroundColor: isPositive ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)' }]}>
                    <Ionicons
                        name={isPositive ? "arrow-down" : "arrow-up"}
                        size={18}
                        color={isPositive ? R.green : R.red}
                    />
                </View>
                <View style={{ flex: 1, marginLeft: 16 }}>
                    <Txt variant="bodyBold" color="#FFF" numberOfLines={1}>{item.description || 'Transaction'}</Txt>
                    <Txt variant="small" color={R.muted}>{date.toLocaleDateString()} · {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Txt>
                </View>
                <Txt variant="bodyBold" color={isPositive ? R.green : R.white}>
                    {isPositive ? '+' : '-'}${Math.abs(item.amount / 100).toFixed(2)}
                </Txt>
            </BlurView>
        );
    };

    return (
        <View style={s.root}>
            <StatusBar style="light" />

            <View style={[s.header, { paddingTop: insets.top + 10 }]}>
                <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()}>
                    <Ionicons name="chevron-back" size={24} color="#FFF" />
                </TouchableOpacity>
                <Txt variant="headingM" weight="heavy" color="#FFF" style={{ marginLeft: 16 }}>Wallet</Txt>
            </View>

            <FlatList
                data={transactions}
                keyExtractor={item => item.id}
                renderItem={renderTransaction}
                contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }}
                ListHeaderComponent={
                    <>
                        {/* Hero Card: LinearGradient purple */}
                        <LinearGradient colors={[R.purple, '#4C1D95']} style={s.hero}>
                            <Txt variant="caption" weight="heavy" color="rgba(255,255,255,0.6)">TOTAL BALANCE</Txt>
                            <View style={s.balanceRow}>
                                <Txt variant="headingL" weight="heavy" color="#FFF" style={{ fontSize: 48 }}>${balance.toFixed(2)}</Txt>
                                <Txt variant="bodyBold" color="rgba(255,255,255,0.6)" style={{ marginLeft: 8, marginTop: 12 }}>TTD</Txt>
                            </View>
                            <View style={s.gCoinBadge}>
                                <Ionicons name="flash" size={12} color={R.gold} />
                                <Txt variant="caption" weight="heavy" color={R.gold} style={{ marginLeft: 4 }}>G-COIN ACTIVE</Txt>
                            </View>
                        </LinearGradient>

                        {/* Quick Actions */}
                        <View style={s.actions}>
                            <TouchableOpacity style={s.actionBtn} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); navigation.navigate('WalletTopUp'); }}>
                                <View style={s.actionIcon}><Ionicons name="add" size={24} color="#FFF" /></View>
                                <Txt variant="caption" weight="bold" color="#FFF">ADD FUNDS</Txt>
                            </TouchableOpacity>
                            <TouchableOpacity style={s.actionBtn} onPress={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}>
                                <View style={s.actionIcon}><Ionicons name="swap-horizontal" size={22} color="#FFF" /></View>
                                <Txt variant="caption" weight="bold" color="#FFF">TRANSFER</Txt>
                            </TouchableOpacity>
                            <TouchableOpacity style={s.actionBtn} onPress={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}>
                                <View style={s.actionIcon}><Ionicons name="list" size={22} color="#FFF" /></View>
                                <Txt variant="caption" weight="bold" color="#FFF">HISTORY</Txt>
                            </TouchableOpacity>
                        </View>

                        <Txt variant="bodyBold" color="#FFF" style={{ marginBottom: 16 }}>Recent Activity</Txt>
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
    root: { flex: 1, backgroundColor: R.bg },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 20 },
    backBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: R.surface, alignItems: 'center', justifyContent: 'center' },

    hero: { borderRadius: 32, padding: 32, marginBottom: 32, shadowColor: R.purple, shadowRadius: 20, shadowOpacity: 0.4 },
    balanceRow: { flexDirection: 'row', alignItems: 'baseline', marginVertical: 8 },
    gCoinBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.2)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, alignSelf: 'flex-start' },

    actions: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 40 },
    actionBtn: { alignItems: 'center', flex: 1 },
    actionIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: R.surface, alignItems: 'center', justifyContent: 'center', marginBottom: 12, borderWidth: 1, borderColor: R.border },

    txCard: { flexDirection: 'row', alignItems: 'center', padding: 16, borderRadius: 20, marginBottom: 12, borderWidth: 1, borderColor: R.border, overflow: 'hidden' },
    txIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },

    empty: { marginTop: 40, alignItems: 'center' },
});
