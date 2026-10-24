import React, { useState, useEffect, useCallback } from 'react';
import { View, Share, FlatList } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@gtaxi/core';
import { logAppEvent } from '../services/analytics';
import { useAuth } from '../context/AuthContext';
import { BrandBadge, Button, Card, GUTTER, Header, Loading, Row, Section, SPACE, Txt, useTheme } from '../ui/kit';
import type { AppScreenProps } from '../navigation/types';


function fmt(cents: number) {
    return `TT$${(cents / 100).toFixed(2)}`;
}

export function ReferralScreen({ navigation }: AppScreenProps<'Referral'>) {
    const insets = useSafeAreaInsets();
    const { user } = useAuth();
    const [code, setCode] = useState<string | null>(null);
    const [earnings, setEarnings] = useState<any[]>([]);
    const [totalEarned, setTotalEarned] = useState(0);
    const [loading, setLoading] = useState(true);
    const [copying, setCopying] = useState(false);

    const load = useCallback(async () => {
        if (!user) return;
        setLoading(true);
        try {
            const { data: existingCode } = await supabase
                .from('referral_codes')
                .select('code')
                .eq('user_id', user.id)
                .maybeSingle();

            if (existingCode?.code) {
                setCode(existingCode.code);
            } else {
                const { data: newCode, error } = await supabase
                    .rpc('generate_referral_code', { p_user_id: user.id, p_type: 'rider' });
                if (!error && newCode) setCode(newCode);
            }

            const { data: earningRows } = await supabase
                .from('referral_earnings')
                .select('*')
                .eq('referrer_id', user.id)
                .order('created_at', { ascending: false });

            if (earningRows) {
                setEarnings(earningRows);
                const total = earningRows
                    .filter((r: any) => r.status === 'paid')
                    .reduce((s: number, r: any) => s + r.amount_cents, 0);
                setTotalEarned(total);
            }
        } catch (e) {
            console.warn('Referral load error:', e);
        } finally {
            setLoading(false);
        }
    }, [user]);

    useEffect(() => { load(); }, [load]);

    const copyCode = async () => {
        if (!code) return;
        setCopying(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        try {
            const { setStringAsync } = await import('expo-clipboard');
            await setStringAsync(code);
        } catch {
            await Share.share({ message: code });
        }
        setTimeout(() => setCopying(false), 1500);
    };

    const shareCode = async () => {
        if (!code) return;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        const result = await Share.share({
            message: `Use my G-Taxi code ${code} when signing up — after your first ride you get TTD $15 in ride credits, and so do I! Download: https://gtaxi.tt`,
            title: 'Get TTD $15 on G-Taxi',
        });
        if (result.action === Share.sharedAction) logAppEvent('rider_referral_shared');
    };

    const m = useTheme();

    const renderEarning = ({ item, index }: { item: any; index: number }) => {
        const isPaid = item.status === 'paid';
        return (
            <Row
                icon={item.type === 'rider' ? 'person-add-outline' : 'car-outline'}
                title={item.type === 'rider' ? 'Friend joined' : 'Driver referral'}
                subtitle={new Date(item.created_at).toLocaleDateString('en-TT', { day: 'numeric', month: 'short' })}
                last={index === earnings.length - 1}
                right={
                    <View style={{ alignItems: 'flex-end' }}>
                        <Txt variant="bodyStrong" tone={isPaid ? 'success' : 'dim'}>{fmt(item.amount_cents)}</Txt>
                        <Txt variant="caption" tone="faint">{isPaid ? 'Paid' : 'Pending'}</Txt>
                    </View>
                }
            />
        );
    };

    return (
        <View style={{ flex: 1, backgroundColor: m.page }}>
            <StatusBar style={m.statusBar} />
            <Header title="Invite friends" onBack={() => navigation.goBack()} />
            {loading ? <Loading /> : (
                <FlatList
                    data={earnings}
                    keyExtractor={i => i.id}
                    renderItem={renderEarning}
                    contentContainerStyle={{ paddingHorizontal: GUTTER, paddingBottom: insets.bottom + SPACE.xxl }}
                    ListHeaderComponent={
                        <>
                            <View style={{ alignItems: 'center', marginTop: SPACE.sm }}>
                                <BrandBadge icon="gift" size={72} round />
                                <Txt variant="hero" style={{ textAlign: 'center', marginTop: SPACE.lg }}>Give $15, get $15</Txt>
                                <Txt variant="body" tone="dim" style={{ textAlign: 'center', marginTop: SPACE.xs }}>
                                    When a friend signs up with your code and takes their first ride, you both get TT$15 in your wallet.
                                </Txt>
                            </View>

                            <Card style={{ alignItems: 'center', marginTop: SPACE.xl, paddingVertical: SPACE.xl }}>
                                <Txt variant="overline" tone="faint">YOUR CODE</Txt>
                                {code ? (
                                    <>
                                        <Txt variant="hero" style={{ letterSpacing: 4, marginTop: SPACE.xs }}>{code}</Txt>
                                        <View style={{ flexDirection: 'row', gap: SPACE.md, marginTop: SPACE.lg, alignSelf: 'stretch' }}>
                                            <Button title={copying ? 'Copied' : 'Copy'} icon={copying ? 'checkmark' : 'copy-outline'} variant="secondary" size="md" style={{ flex: 1 }} onPress={copyCode} />
                                            <Button title="Share" icon="share-social-outline" size="md" style={{ flex: 1 }} onPress={shareCode} />
                                        </View>
                                    </>
                                ) : <Loading />}
                            </Card>

                            <Card style={{ flexDirection: 'row', marginTop: SPACE.md }}>
                                <View style={{ flex: 1, alignItems: 'center' }}>
                                    <Txt variant="title">{earnings.length}</Txt>
                                    <Txt variant="caption" tone="dim">Friends invited</Txt>
                                </View>
                                <View style={{ flex: 1, alignItems: 'center', borderLeftWidth: 1, borderLeftColor: m.chipBorder }}>
                                    <Txt variant="title" tone="success">{fmt(totalEarned)}</Txt>
                                    <Txt variant="caption" tone="dim">Earned</Txt>
                                </View>
                            </Card>

                            <Section title="How it works">
                                {['Share your code with a friend', 'They sign up and enter your code', 'They take their first ride', 'You both get TT$15 in your wallet'].map((t, i) => (
                                    <View key={t} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: SPACE.sm }}>
                                        <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: m.field, alignItems: 'center', justifyContent: 'center', marginRight: SPACE.md }}>
                                            <Txt variant="label" tone="accent">{i + 1}</Txt>
                                        </View>
                                        <Txt variant="body" style={{ flex: 1 }}>{t}</Txt>
                                    </View>
                                ))}
                            </Section>

                            <Txt variant="overline" tone="faint" style={{ marginTop: SPACE.xl, marginBottom: SPACE.sm }}>HISTORY</Txt>
                        </>
                    }
                    ListEmptyComponent={<Txt variant="body" tone="dim">No invites yet. Share your code to start earning.</Txt>}
                />
            )}
        </View>
    );
}
