import React, { useState, useEffect } from 'react';
import { View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@gtaxi/core';
import { usePlatformFlags } from '../hooks/usePlatformFlags';
import { useAuth } from '../context/AuthContext';
import { toast } from '../components/Toast';
import { Button, Card, EmptyState, Field, Screen, Section, SPACE, Txt, useTheme } from '../ui/kit';

export function PromoScreen({ navigation }: any) {
    // 'promo_codes_active' on the admin's Platform Control page.
    const { flags } = usePlatformFlags();
    const { user } = useAuth();

    const [code, setCode] = useState('');
    const [loading, setLoading] = useState(false);
    const [promos, setPromos] = useState<any[]>([]);

    useEffect(() => {
        fetchPromos();
    }, []);

    const fetchPromos = async () => {
        const { data } = await supabase
            .from('admin_promos')
            .select('*')
            .eq('is_active', true);
        if (data) setPromos(data);
    };

    // Real redemption: claim_promo_code validates server-side (exists,
    // active, not expired, under max_uses, not already claimed by this
    // rider) and records the claim -- the old version here inserted
    // directly into user_promos and showed a success alert regardless of
    // whether it actually worked (it never did: a broken trigger made
    // every such insert fail). Claiming attaches to the rider's NEXT ride
    // automatically (create_ride) and the discount lands in the real fare
    // math at settlement (complete_ride) -- not applied here, on purpose.
    const handleApply = async () => {
        if (!code) return;
        setLoading(true);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

        const { data, error } = await supabase.rpc('claim_promo_code', { p_code: code });

        setLoading(false);

        if (error) {
            toast(error.message, 'error');
            return;
        }
        if (!data?.success) {
            toast(data?.message || 'That code could not be applied.', 'error');
            return;
        }

        toast(data.message || `Applied: up to ${data.discount_percent}% off your next ride.`, 'success');
        setCode('');
        fetchPromos();
    };

    const m = useTheme();
    if (!flags.promoCodes) {
        return (
            <Screen title="Promotions" onBack={() => navigation.goBack()}>
                <EmptyState icon="pricetag-outline" title="Promotions are paused" body="Promo codes are switched off right now. Your rides and orders are not affected." />
            </Screen>
        );
    }
    return (
        <Screen title="Promotions" onBack={() => navigation.goBack()}>
            <Card style={{ marginTop: SPACE.sm }}>
                <Txt variant="bodyStrong" style={{ marginBottom: SPACE.md }}>Have a promo code?</Txt>
                <Field placeholder="Enter code" value={code} onChangeText={t => setCode(t.toUpperCase())} autoCapitalize="characters" autoCorrect={false} />
                <Button title="Apply code" size="md" loading={loading} disabled={!code} onPress={handleApply} />
            </Card>

            <Section title="Available offers">
                {promos.length === 0 ? (
                    <EmptyState icon="gift-outline" title="No offers right now" body="New offers will show up here." />
                ) : promos.map((p, idx) => (
                    <Card key={idx} style={{ marginBottom: SPACE.md, flexDirection: 'row', alignItems: 'center' }}>
                        <View style={{ flex: 1 }}>
                            <Txt variant="headline">{p.code}</Txt>
                            {p.description ? <Txt variant="caption" tone="dim" style={{ marginTop: 2 }}>{p.description}</Txt> : null}
                            <Txt variant="caption" tone="faint" style={{ marginTop: SPACE.sm }}>{p.expires_at ? `Ends ${new Date(p.expires_at).toLocaleDateString()}` : 'No end date'}</Txt>
                        </View>
                        <View style={{ alignItems: 'center', paddingHorizontal: SPACE.md, paddingVertical: SPACE.sm, borderRadius: 14, backgroundColor: m.field }}>
                            <Txt variant="title" tone="accent">{p.discount_percent}%</Txt>
                            <Txt variant="overline" tone="accent">OFF</Txt>
                        </View>
                    </Card>
                ))}
            </Section>
        </Screen>
    );
}
