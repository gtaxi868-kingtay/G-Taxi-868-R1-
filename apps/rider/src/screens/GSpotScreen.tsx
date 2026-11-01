import React, { useState } from 'react';
import { View, Alert, RefreshControl } from 'react-native';
import * as Haptics from 'expo-haptics';
import { toast } from '../components/Toast';
import { Button, Card, EmptyState, Loading, Screen, SPACE, Txt, useTheme } from '../ui/kit';
import { AppScreenProps } from '../navigation/types';
import { useGSpot, type GSpotVenue, type GSpotRedeemCode } from '../hooks/useGSpot';

const formatTTD = (cents: number) => `$${(cents / 100).toFixed(2)} TTD`;

export function GSpotScreen({ navigation }: AppScreenProps<'GSpot'>) {
    const { venues, memberships, loading, refreshing, busy, refresh, join, cancel, generateRedeemCode } = useGSpot();
    const [activeCode, setActiveCode] = useState<GSpotRedeemCode | null>(null);

    const activeMembership = memberships.find((m) => m.status === 'active');

    const onJoin = async (venue: GSpotVenue) => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        Alert.alert(
            'Join G Spot',
            `Join ${venue.name} for ${formatTTD(venue.membership_price_cents)}/month, charged to your wallet now?`,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Join',
                    onPress: async () => {
                        const result = await join(venue.id);
                        if (!result.success) {
                            toast(result.error || 'Could not join. Please try again.', 'error');
                            return;
                        }
                        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                    },
                },
            ],
        );
    };

    const onCancel = async () => {
        if (!activeMembership) return;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        Alert.alert('Cancel Membership', 'This ends your G Spot membership at the end of this billing cycle. Continue?', [
            { text: 'Keep Membership', style: 'cancel' },
            {
                text: 'Cancel Membership',
                style: 'destructive',
                onPress: async () => {
                    const result = await cancel(activeMembership.id);
                    if (!result.success) toast(result.error || 'Could not cancel. Please try again.', 'error');
                    else setActiveCode(null);
                },
            },
        ]);
    };

    const onShowCode = async () => {
        if (!activeMembership) return;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        const result = await generateRedeemCode(activeMembership.id);
        if (!result.success || !result.code) {
            toast(result.error || 'Could not make a code. Please try again.', 'error');
            return;
        }
        setActiveCode(result.code);
    };

    const subsidyRemaining = activeMembership
        ? activeMembership.drink_subsidy_cap_cents - activeMembership.drink_subsidy_used_cents
        : 0;

    const m = useTheme();
    const stat = (value: string, label: string, i: number) => (
        <View style={{ flex: 1, alignItems: 'center', borderLeftWidth: i ? 1 : 0, borderLeftColor: m.chipBorder }}>
            <Txt variant="headline">{value}</Txt>
            <Txt variant="caption" tone="dim">{label}</Txt>
        </View>
    );

    return (
        <Screen
            title="G Spot"
            onBack={() => navigation.goBack()}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={m.accent} />}
            hero={
                <View>
                    <Txt variant="hero">Your bar membership</Txt>
                    <Txt variant="body" tone="dim" style={{ marginTop: SPACE.xs }}>Rides there and back, plus drink credit at a partner venue. Paid monthly from your wallet.</Txt>
                </View>
            }
        >
            {loading ? <Loading /> : activeMembership ? (
                <Card>
                    <Txt variant="label" tone="success">Active member</Txt>
                    <Txt variant="title" style={{ marginTop: SPACE.xs }}>{activeMembership.venue?.name}</Txt>
                    {activeMembership.venue?.address ? <Txt variant="caption" tone="dim">{activeMembership.venue.address}</Txt> : null}
                    <View style={{ flexDirection: 'row', marginTop: SPACE.lg }}>
                        {stat(formatTTD(subsidyRemaining), 'Drink credit left', 0)}
                        {stat(formatTTD(activeMembership.monthly_price_cents), 'Per month', 1)}
                    </View>
                    {activeCode ? (
                        <View style={{ alignItems: 'center', marginTop: SPACE.xl, padding: SPACE.lg, borderRadius: 16, backgroundColor: m.field }}>
                            <Txt variant="overline" tone="faint">SHOW THIS AT THE BAR</Txt>
                            <Txt variant="hero" tone="accent" style={{ letterSpacing: 6, marginTop: SPACE.xs }}>{activeCode.code}</Txt>
                            <Txt variant="caption" tone="dim">Expires {new Date(activeCode.expires_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</Txt>
                        </View>
                    ) : (
                        <Button title="Show my code at the bar" icon="qr-code-outline" style={{ marginTop: SPACE.xl }} loading={busy} onPress={onShowCode} />
                    )}
                    <Button title="Cancel membership" variant="ghost" style={{ marginTop: SPACE.md }} onPress={onCancel} />
                </Card>
            ) : venues.length === 0 ? (
                <EmptyState icon="wine-outline" title="No venues yet" body="Partner bars will show up here when they open memberships." />
            ) : (
                <>
                    <Txt variant="overline" tone="faint" style={{ marginBottom: SPACE.md }}>PARTNER VENUES</Txt>
                    {venues.map((venue) => (
                        <Card key={venue.id} style={{ marginBottom: SPACE.md }}>
                            <Txt variant="title">{venue.name}</Txt>
                            {venue.address ? <Txt variant="caption" tone="dim">{venue.address}</Txt> : null}
                            <View style={{ flexDirection: 'row', marginTop: SPACE.lg }}>
                                {stat(formatTTD(venue.membership_price_cents), 'Per month', 0)}
                                {stat(formatTTD(venue.drink_subsidy_cap_cents), 'Drink credit / month', 1)}
                            </View>
                            <Button title="Join with G-Coin" size="md" style={{ marginTop: SPACE.lg }} loading={busy} onPress={() => onJoin(venue)} />
                        </Card>
                    ))}
                </>
            )}
        </Screen>
    );
}
