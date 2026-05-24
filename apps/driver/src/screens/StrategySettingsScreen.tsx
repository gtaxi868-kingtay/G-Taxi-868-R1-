import React, { useEffect, useState } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity, SafeAreaView,
    ScrollView, Switch, ActivityIndicator, Alert
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { supabase } from '@gtaxi/core';
import { useAuth } from '../context/AuthContext';
import { SURFACE, VOICES, ANIMATION } from '@gtaxi/design-system';
import { ghostBorder, elevationGlow, glassSurface } from '@gtaxi/design-system/utils/style-rules';

export function StrategySettingsScreen({ navigation }: { navigation: any }) {
    const { user } = useAuth();
    const insets = useSafeAreaInsets();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const [strategy, setStrategy] = useState({
        strategy_mode: 'stable',
        fatigue_alerts_enabled: true,
        max_distance_meters: 10000
    });

    useEffect(() => {
        fetchStrategy();
    }, []);

    const fetchStrategy = async () => {
        try {
            const { data, error } = await supabase
                .from('driver_ai_strategy')
                .select('*')
                .eq('user_id', user?.id)
                .single();

            if (data) {
                setStrategy({
                    strategy_mode: data.strategy_mode,
                    fatigue_alerts_enabled: data.fatigue_alerts_enabled,
                    max_distance_meters: data.max_distance_meters
                });
            }
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const updateStrategy = async (key: string, value: boolean | string) => {
        const newStrategy = { ...strategy, [key]: value };
        setStrategy(newStrategy);
        setSaving(true);

        try {
            const { error } = await supabase
                .from('driver_ai_strategy')
                .upsert({
                    user_id: user?.id,
                    ...newStrategy,
                    updated_at: new Date().toISOString()
                });

            if (error) throw error;
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } catch (err) {
            Alert.alert('Update Failed', (err as Error).message);
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <View style={[s.root, { justifyContent: 'center' }]}>
                <ActivityIndicator color={VOICES.driver.accent} />
            </View>
        );
    }

    return (
        <View style={s.root}>
            <StatusBar style="light" />
            <View style={[s.header, { paddingTop: insets.top + 8 }]}>
                <TouchableOpacity style={s.headerBtn} onPress={() => navigation.goBack()}>
                    <Ionicons name="chevron-back" size={24} color="#FFF" />
                </TouchableOpacity>
                <Text style={{ marginLeft: 16, fontSize: 16, fontWeight: '700', color: '#FFF' }}>AI strategy</Text>
            </View>

            <ScrollView contentContainerStyle={s.scroll}>
                <View style={s.section}>
                    <Text style={[s.sectionTitle, {fontSize: 11, fontWeight: '600', color: 'rgba(255,255,255,0.6)'}]}>BUSINESS GOAL</Text>
                    <View style={s.modeGrid}>
                        {[
                            { id: 'hustler', label: 'Hustler', icon: 'flash', desc: 'Max earnings. Priority on long, high-surge trips.' },
                            { id: 'stable', label: 'Stable', icon: 'trending-up', desc: 'Consistent, short neighborhood hops.' },
                            { id: 'closer', label: 'Closer', icon: 'home', desc: 'Priority on trips leading towards your home.' }
                        ].map((m) => (
                            <TouchableOpacity
                                key={m.id}
                                style={[s.modeItem, strategy.strategy_mode === m.id && s.modeItemActive]}
                                onPress={() => updateStrategy('strategy_mode', m.id)}
                            >
                                <Ionicons name={m.icon as any} size={24} color={strategy.strategy_mode === m.id ? '#FFF' : 'rgba(255,255,255,0.6)'} />
                                <Text style={{ marginTop: 8, fontSize: 14, fontWeight: '600', color: strategy.strategy_mode === m.id ? '#FFF' : 'rgba(255,255,255,0.6)' }}>{m.label}</Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                    <View style={{ marginTop: 20, padding: 16, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 12 }}>
                        <Text style={{fontSize: 11, fontWeight: '500', color: 'rgba(255,255,255,0.6)', textAlign: 'center'}}>
                            {strategy.strategy_mode === 'hustler' && "Hustler mode optimizes for the highest hourly rate, often leading you further from home."}
                            {strategy.strategy_mode === 'stable' && "Stable mode focuses on high-frequency, low-stress trips with minimal downtime."}
                            {strategy.strategy_mode === 'closer' && "Closer mode filtered to only show you rides that end within 5km of your registered home."}
                        </Text>
                    </View>
                </View>

                <View style={s.section}>
                    <Text style={[s.sectionTitle, {fontSize: 11, fontWeight: '600', color: 'rgba(255,255,255,0.6)'}]}>HEALTH & SAFETY</Text>
                    <View style={s.row}>
                        <View style={{ flex: 1 }}>
                            <Text style={{fontSize: 14, fontWeight: '600', color: '#FFF'}}>Fatigue & Wellness Alerts</Text>
                            <Text style={{fontSize: 11, fontWeight: '500', color: 'rgba(255,255,255,0.6)'}}>AI monitors driving patterns to suggest breaks.</Text>
                        </View>
                        <Switch
                            value={strategy.fatigue_alerts_enabled}
                            onValueChange={(val: boolean) => updateStrategy('fatigue_alerts_enabled', val)}
                            trackColor={{ false: 'rgba(26, 21, 48, 1)', true: VOICES.driver.accent }}
                        />
                    </View>
                </View>

                {saving && (
                    <View style={s.savingIndicator}>
                        <ActivityIndicator size="small" color={VOICES.driver.accent} />
                        <Text style={{ marginLeft: 8, fontSize: 11, fontWeight: '500', color: VOICES.driver.gold }}>Updating Strategy...</Text>
                    </View>
                )}
            </ScrollView>
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: SURFACE.base },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 20, ...ghostBorder(0.15), paddingBottom: 12 },
    headerBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' },
    
    scroll: { paddingHorizontal: 20, paddingBottom: 40 },
    section: { backgroundColor: 'rgba(26, 21, 48, 0.8)', borderRadius: 24, padding: 24, marginBottom: 20, ...ghostBorder(0.15) },
    sectionTitle: { marginBottom: 20, letterSpacing: 1 },
    
    modeGrid: { flexDirection: 'row', gap: 10 },
    modeItem: { flex: 1, height: 100, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.03)', alignItems: 'center', justifyContent: 'center', ...ghostBorder(0) },
    modeItemActive: { backgroundColor: VOICES.driver.accent, borderColor: VOICES.driver.gold },

    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    savingIndicator: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 10 }
});
