import React, { useEffect, useState } from 'react';
import {
    View, StyleSheet, TouchableOpacity, SafeAreaView,
    ScrollView, Switch, ActivityIndicator, Alert
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { supabase } from '../../../../shared/supabase';
import { useAuth } from '../context/AuthContext';
import { Txt } from '../design-system/primitives';

// ── Rider Design Tokens ──────────────────────────────────────────────────────
const R = {
    bg: '#07050F',
    surface: '#110E22',
    surfaceHigh: '#1A1530',
    border: 'rgba(255,255,255,0.08)',
    purple: '#7C3AED',
    purpleLight: '#A78BFA',
    gold: '#F59E0B',
    white: '#FFFFFF',
    muted: 'rgba(255,255,255,0.4)',
};

export function AISettingsScreen({ navigation }: any) {
    const { user } = useAuth();
    const insets = useSafeAreaInsets();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const [prefs, setPrefs] = useState({
        quiet_ride: false,
        ai_suggestions_enabled: true,
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
                    pace_priority: data.pace_priority
                });
            } else if (error && error.code === 'PGRST116') {
                // No prefs yet, create them via upsert later
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
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } catch (err: any) {
            Alert.alert('Update Failed', err.message);
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <View style={[s.root, { justifyContent: 'center' }]}>
                <ActivityIndicator color={R.purple} />
            </View>
        );
    }

    return (
        <View style={s.root}>
            <StatusBar style="light" />
            <View style={[s.header, { paddingTop: insets.top + 10 }]}>
                <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()}>
                    <Ionicons name="chevron-back" size={24} color="#FFF" />
                </TouchableOpacity>
                <Txt variant="headingM" weight="heavy" color="#FFF" style={{ marginLeft: 16 }}>AI & Safety</Txt>
            </View>

            <ScrollView contentContainerStyle={s.scroll}>
                <View style={s.section}>
                    <Txt variant="caption" color={R.muted} style={s.sectionTitle}>CONCIERGE SETTINGS</Txt>
                    
                    <View style={s.row}>
                        <View style={{ flex: 1 }}>
                            <Txt variant="bodyBold" color="#FFF">Smart Suggestions</Txt>
                            <Txt variant="small" color={R.muted}>AI learns your routines to suggest rides and stops.</Txt>
                        </View>
                        <Switch
                            value={prefs.ai_suggestions_enabled}
                            onValueChange={(val: boolean) => updatePref('ai_suggestions_enabled', val)}
                            trackColor={{ false: R.surfaceHigh, true: R.purple }}
                        />
                    </View>

                    <View style={s.divider} />

                    <View style={s.row}>
                        <View style={{ flex: 1 }}>
                            <Txt variant="bodyBold" color="#FFF">Quiet Ride Preference</Txt>
                            <Txt variant="small" color={R.muted}>Nudge drivers to keep music low and talk minimal.</Txt>
                        </View>
                        <Switch
                            value={prefs.quiet_ride}
                            onValueChange={(val: boolean) => updatePref('quiet_ride', val)}
                            trackColor={{ false: R.surfaceHigh, true: R.purple }}
                        />
                    </View>
                </View>

                <View style={s.section}>
                    <Txt variant="caption" color={R.muted} style={s.sectionTitle}>TRAVEL PACE</Txt>
                    <View style={s.paceGrid}>
                        {['speed', 'balanced', 'cost'].map((mode) => (
                            <TouchableOpacity
                                key={mode}
                                style={[s.paceItem, prefs.pace_priority === mode && s.paceItemActive]}
                                onPress={() => updatePref('pace_priority', mode)}
                            >
                                <Ionicons 
                                    name={mode === 'speed' ? 'flash' : mode === 'cost' ? 'wallet' : 'git-compare'} 
                                    size={20} 
                                    color={prefs.pace_priority === mode ? R.white : R.muted} 
                                />
                                <Txt variant="caption" color={prefs.pace_priority === mode ? R.white : R.muted} style={{ marginTop: 4 }}>
                                    {mode.toUpperCase()}
                                </Txt>
                            </TouchableOpacity>
                        ))}
                    </View>
                    <Txt variant="small" color={R.muted} style={{ marginTop: 12, textAlign: 'center' }}>
                        {prefs.pace_priority === 'speed' && "Prioritize the fastest route, regardless of tolls or fare."}
                        {prefs.pace_priority === 'balanced' && "Optimized balance between travel time and cost."}
                        {prefs.pace_priority === 'cost' && "Prioritize the cheapest path, even if it takes longer."}
                    </Txt>
                </View>

                {saving && (
                    <View style={s.savingIndicator}>
                        <ActivityIndicator size="small" color={R.purple} />
                        <Txt variant="small" color={R.purpleLight} style={{ marginLeft: 8 }}>Saving...</Txt>
                    </View>
                )}
            </ScrollView>
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: R.bg },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 20 },
    backBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: R.surface, alignItems: 'center', justifyContent: 'center' },
    
    scroll: { paddingHorizontal: 20, paddingBottom: 40 },
    section: { backgroundColor: R.surface, borderRadius: 24, padding: 20, marginBottom: 20, borderWidth: 1, borderColor: R.border },
    sectionTitle: { marginBottom: 16, letterSpacing: 1 },
    
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.05)', marginVertical: 20 },
    
    paceGrid: { flexDirection: 'row', gap: 12 },
    paceItem: { flex: 1, height: 70, borderRadius: 16, backgroundColor: R.surfaceHigh, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'transparent' },
    paceItemActive: { backgroundColor: R.purple, borderColor: R.purpleLight },

    savingIndicator: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 10 }
});
