import React, { useState, useEffect } from 'react';
import { View, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import * as Haptics from 'expo-haptics';
import { supabase } from '@gtaxi/core';
import { useAuth } from '../context/AuthContext';
import { toast } from '../components/Toast';
import { Card, Chip, Loading, Row, Screen, Section, SPACE, Toggle, Txt, useTheme } from '../ui/kit';

export function AISettingsScreen({ navigation }: any) {
    const { user } = useAuth();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const [prefs, setPrefs] = useState({
        quiet_ride: false,
        ai_suggestions_enabled: true,
        memory_enabled: false,
        pace_priority: 'balanced'
    });

    useEffect(() => {
        fetchPrefs();
    }, []);

    const fetchPrefs = async () => {
        try {
            const { data, error } = await supabase
                .from('rider_ai_preferences')
                .select('*')
                .eq('user_id', user?.id)
                .single();

            if (data) {
                setPrefs({
                    quiet_ride: data.quiet_ride,
                    ai_suggestions_enabled: data.ai_suggestions_enabled,
                    memory_enabled: data.memory_enabled ?? false,
                    pace_priority: data.pace_priority
                });
            }
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const updatePref = async (key: string, value: any) => {
        const newPrefs = { ...prefs, [key]: value };
        setPrefs(newPrefs);
        setSaving(true);

        try {
            const { error } = await supabase
                .from('rider_ai_preferences')
                .upsert({
                    user_id: user?.id,
                    ...newPrefs,
                    updated_at: new Date().toISOString()
                });

            if (error) throw error;

            if (key === 'ai_suggestions_enabled' && value === true) {
                const cacheKey = `ai_insight_cache_${user?.id}`;
                try {
                    await AsyncStorage.removeItem(cacheKey);
                } catch (e) {
                    console.warn('[AISettings] Cache clear failed:', e);
                }
            }

            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } catch (err: any) {
            toast('Could not save: ' + err.message, 'error');
        } finally {
            setSaving(false);
        }
    };

    const m = useTheme();
    const forgetMe = () => {
        Alert.alert(
            'Forget everything?',
            'G will erase all its notes about you and cancel pending reminders. This cannot be undone.',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Forget me', style: 'destructive',
                    onPress: async () => {
                        try {
                            const { error } = await supabase.functions.invoke('g_rider_concierge', { body: { action: 'forget' } });
                            if (error) throw error;
                            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                            toast('G has forgotten everything it knew about you', 'success');
                        } catch (err: any) {
                            toast(err?.message || 'Could not erase right now.', 'error');
                        }
                    },
                },
            ],
        );
    };
    const PACE: Record<string, { icon: any; label: string; text: string }> = {
        speed: { icon: 'flash-outline', label: 'Fastest', text: 'Take the fastest route, even if it costs a little more.' },
        balanced: { icon: 'git-compare-outline', label: 'Balanced', text: 'A good balance of time and cost.' },
        cost: { icon: 'wallet-outline', label: 'Cheapest', text: 'Take the cheapest route, even if it takes longer.' },
    };

    return (
        <Screen title="G assistant and safety" onBack={() => navigation.goBack()}>
            {loading ? <Loading /> : (
                <>
                    <Section title="G assistant" style={{ marginTop: SPACE.sm }}>
                        <Card style={{ paddingVertical: SPACE.xs }}>
                            <Row title="Smart suggestions" subtitle="G learns your routines to suggest rides and stops"
                                right={<Toggle label="Smart suggestions" value={prefs.ai_suggestions_enabled} onChange={(v) => updatePref('ai_suggestions_enabled', v)} />} />
                            <Row title="Quiet ride" subtitle="Ask drivers to keep music low and chat to a minimum"
                                right={<Toggle label="Quiet ride" value={prefs.quiet_ride} onChange={(v) => updatePref('quiet_ride', v)} />} />
                            <View style={{ opacity: prefs.ai_suggestions_enabled ? 1 : 0.45 }}>
                                <Row title="G remembers you" subtitle="G keeps notes on your usuals to help faster. Only your own data."
                                    right={<Toggle label="G remembers you" value={prefs.memory_enabled}
                                        onChange={(v) => prefs.ai_suggestions_enabled ? updatePref('memory_enabled', v) : toast('Turn on smart suggestions first.')} />} />
                            </View>
                            <Row icon="trash-outline" title="Forget me" subtitle="Erase everything G knows about you" danger last onPress={forgetMe} />
                        </Card>
                    </Section>

                    <Section title="Route preference">
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                            {Object.keys(PACE).map((mode) => (
                                <Chip key={mode} icon={PACE[mode].icon} label={PACE[mode].label} selected={prefs.pace_priority === mode} onPress={() => updatePref('pace_priority', mode)} />
                            ))}
                        </View>
                        <Txt variant="caption" tone="dim">{PACE[prefs.pace_priority]?.text}</Txt>
                    </Section>

                    {saving && <Txt variant="caption" tone="accent" style={{ marginTop: SPACE.lg }}>Saving…</Txt>}
                </>
            )}
        </Screen>
    );
}
