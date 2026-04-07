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

import { tokens } from '../design-system/tokens';

const { width } = Dimensions.get('window');

// --- Rider Design Tokens (Deprecated local, using tokens) ---
const R = {
    bg: tokens.colors.background.base,
    surface: tokens.colors.background.surface,
    surfaceHigh: 'rgba(255,255,255,0.1)',
    border: tokens.colors.glass.stroke,
    purple: tokens.colors.primary.purple,
    purpleLight: tokens.colors.primary.cyan,
    gold: '#F59E0B',
    green: tokens.colors.status.success,
    red: tokens.colors.status.error,
    white: tokens.colors.text.primary,
    muted: tokens.colors.text.secondary,
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
            <View style={[s.txCard, { backgroundColor: 'rgba(255,255,255,0.02)' }]}>
                <View style={[s.txIcon, { backgroundColor: isPositive ? 'rgba(0,255,163,0.1)' : 'rgba(255,69,58,0.1)' }]}>
                    <Ionicons
                        name={isPositive ? "arrow-down" : "arrow-up"}
                        size={18}
                        color={isPositive ? tokens.colors.primary.cyan : tokens.colors.status.error}
                    />
                </View>
                <View style={{ flex: 1, marginLeft: 16 }}>
                    <Txt variant="bodyBold" color={R.white} style={{ fontSize: 16 }}>{item.description || 'Transaction'}</Txt>
                    <Txt variant="small" color={R.muted}>{date.toLocaleDateString()} · {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Txt>
                </View>
                <Txt variant="bodyBold" color={isPositive ? tokens.colors.primary.cyan : tokens.colors.text.primary}>
                    {isPositive ? '+' : '-'}${Math.abs(item.amount / 100).toFixed(2)}
                </Txt>
            </View>
        );
    };
    if (loading) {
        return (
            <View style={[s.root, { alignItems: 'center', justifyContent: 'center' }]}>
                <ActivityIndicator color={R.purple} size="large" />
            </View>
        );
    }

    return (
        <View style={s.root}>
            <StatusBar style="dark" />

            <View style={[s.header, { paddingTop: insets.top + 10 }]}>
                <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()}>
                    <Ionicons name="chevron-back" size={24} color={R.white} />
                </TouchableOpacity>
                <Txt variant="headingM" weight="heavy" color={R.white} style={{ marginLeft: 16 }}>Wallet</Txt>
            </View>

            <FlatList
                data={transactions}
                keyExtractor={item => item.id}
                renderItem={renderTransaction}
                contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }}
                ListHeaderComponent={
                    <>
                        {/* Hero Card: LinearGradient Blueberry Luxe */}
                        <LinearGradient colors={[tokens.colors.primary.lavender, tokens.colors.primary.blueberry]} style={s.hero}>
                            <Txt variant="caption" weight="heavy" color="rgba(255,255,255,0.7)">TOTAL BALANCE</Txt>
                            <View style={s.balanceRow}>
                                <Txt variant="headingL" weight="heavy" color="#FFF" style={{ fontSize: 48 }}>${balance.toFixed(2)}</Txt>
                                <Txt variant="bodyBold" color="rgba(255,255,255,0.7)" style={{ marginLeft: 8, marginTop: 12 }}>TTD</Txt>
                            </View>
                            <View style={s.gCoinBadge}>
                                <Ionicons name="flash" size={12} color={R.gold} />
                                <Txt variant="caption" weight="heavy" color={R.gold} style={{ marginLeft: 4 }}>G-COIN ACTIVE</Txt>
                            </View>
                        </LinearGradient>

                        {/* Quick Actions */}
                        <View style={s.actions}>
                            <TouchableOpacity style={s.actionBtn} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); navigation.navigate('WalletTopUp'); }}>
                                <View style={s.actionIcon}>
                                    <LinearGradient 
                                        colors={[tokens.colors.primary.purple, tokens.colors.primary.cyan]} 
                                        style={StyleSheet.absoluteFill} 
                                    />
                                    <Ionicons name="add" size={24} color="#FFF" />
                                </View>
                                <Txt variant="caption" weight="heavy" color="#FFF" style={{ marginTop: 12 }}>ADD FUNDS</Txt>
                            </TouchableOpacity>
                            <TouchableOpacity style={s.actionBtn} onPress={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}>
                                <View style={s.actionIcon}><Ionicons name="swap-horizontal" size={22} color="rgba(255,255,255,0.6)" /></View>
                                <Txt variant="caption" weight="heavy" color="rgba(255,255,255,0.6)" style={{ marginTop: 12 }}>TRANSFER</Txt>
                            </TouchableOpacity>
                            <TouchableOpacity style={s.actionBtn} onPress={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}>
                                <View style={s.actionIcon}><Ionicons name="list" size={22} color="rgba(255,255,255,0.6)" /></View>
                                <Txt variant="caption" weight="heavy" color="rgba(255,255,255,0.6)" style={{ marginTop: 12 }}>HISTORY</Txt>
                            </TouchableOpacity>
                        </View>

                        <Txt variant="bodyBold" color={R.white} style={{ marginBottom: 16 }}>Recent Activity</Txt>
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
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, marginBottom: 20 },
    backBtn: { width: 44, height: 44, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' },

    hero: { borderRadius: 40, padding: 32, marginBottom: 32, shadowColor: R.purple, shadowRadius: 30, shadowOpacity: 0.5 },
    balanceRow: { flexDirection: 'row', alignItems: 'baseline', marginVertical: 8 },
    gCoinBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.3)', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 24, alignSelf: 'flex-start' },

    actions: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 44 },
    actionBtn: { alignItems: 'center', flex: 1 },
    actionIcon: { width: 64, height: 64, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.03)', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },

    txCard: { flexDirection: 'row', alignItems: 'center', padding: 20, borderRadius: 28, marginBottom: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.03)', overflow: 'hidden' },
    txIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },

    empty: { marginTop: 40, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.02)', padding: 40, borderRadius: 32 },
});
