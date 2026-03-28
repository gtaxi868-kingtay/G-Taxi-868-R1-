import React, { useState, useEffect } from 'react';
import {
    View, StyleSheet, TouchableOpacity, Switch,
    ScrollView, Alert, Dimensions
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BlurView } from 'expo-blur';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
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
    border: tokens.colors.glass.stroke,
    purple: tokens.colors.primary.purple,
    purpleLight: tokens.colors.primary.cyan,
    gold: '#FFD700',
    white: tokens.colors.text.primary,
    muted: tokens.colors.text.secondary,
};

export function SettingsScreen({ navigation }: any) {
    const { user } = useAuth();
    const insets = useSafeAreaInsets();

    const [notifyRides, setNotifyRides] = useState(true);
    const [notifyPromos, setNotifyPromos] = useState(true);
    const [aiRouting, setAiRouting] = useState(false);

    useEffect(() => {
        if (!user) return;
        supabase.from('notification_settings').select('*').eq('user_id', user.id).single()
            .then(({ data }) => {
                if (data) {
                    setNotifyRides(data.ride_updates);
                    setNotifyPromos(data.promotions);
                }
            });
        AsyncStorage.getItem('@ai_routing_opt_in').then(val => setAiRouting(val === 'true'));
    }, [user]);

    const toggleSetting = async (field: 'ride_updates' | 'promotions' | 'ai_routing', value: boolean) => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        if (field === 'ride_updates') setNotifyRides(value);
        if (field === 'promotions') setNotifyPromos(value);
        if (field === 'ai_routing') {
            setAiRouting(value);
            await AsyncStorage.setItem('@ai_routing_opt_in', value ? 'true' : 'false');
            return;
        }

        if (user) {
            await supabase.from('notification_settings').upsert({
                user_id: user.id,
                [field]: value,
                updated_at: new Date().toISOString()
            });
        }
    };

    return (
        <View style={s.root}>
            <StatusBar style="light" />

            <View style={[s.header, { paddingTop: insets.top + 10 }]}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
                    <Ionicons name="chevron-back" size={24} color="#FFF" />
                </TouchableOpacity>
                <Txt variant="headingM" weight="heavy" color="#FFF" style={{ marginLeft: 16 }}>Settings</Txt>
            </View>

            <ScrollView contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 40 }]}>

                <Txt variant="caption" weight="heavy" color={R.muted} style={s.sectionLabel}>NOTIFICATIONS</Txt>
                <View style={s.card}>
                    <SettingRow
                        label="Ride Updates"
                        sub="Driver arrivals and status"
                        value={notifyRides}
                        onToggle={(v: boolean) => toggleSetting('ride_updates', v)}
                    />
                    <View style={s.divider} />
                    <SettingRow
                        label="Promotions"
                        sub="Discounts and news"
                        value={notifyPromos}
                        onToggle={(v: boolean) => toggleSetting('promotions', v)}
                    />
                </View>

                <Txt variant="caption" weight="heavy" color={R.muted} style={s.sectionLabel}>PRIVACY & SECURITY</Txt>
                <View style={s.card}>
                    <SettingRow
                        label="AI Route Opt-In"
                        sub="Share data for discount routes"
                        value={aiRouting}
                        onToggle={(v: boolean) => toggleSetting('ai_routing', v)}
                    />
                    <View style={s.divider} />
                    <TouchableOpacity style={s.row} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); Alert.alert('Cache Cleared'); }}>
                        <View style={{ flex: 1 }}>
                            <Txt variant="bodyBold" color="#FFF">Clear App Cache</Txt>
                            <Txt variant="small" color={R.muted}>Refresh local storage</Txt>
                        </View>
                        <Ionicons name="trash-outline" size={20} color={R.muted} />
                    </TouchableOpacity>
                </View>

                <Txt variant="caption" weight="heavy" color={R.muted} style={s.sectionLabel}>ABOUT</Txt>
                <View style={s.card}>
                    <TouchableOpacity style={s.row}>
                        <Txt variant="bodyBold" color="#FFF">Terms of Service</Txt>
                        <Ionicons name="chevron-forward" size={18} color={R.muted} />
                    </TouchableOpacity>
                    <View style={s.divider} />
                    <TouchableOpacity style={s.row}>
                        <Txt variant="bodyBold" color="#FFF">Privacy Policy</Txt>
                        <Ionicons name="chevron-forward" size={18} color={R.muted} />
                    </TouchableOpacity>
                    <View style={s.divider} />
                    <View style={s.row}>
                        <Txt variant="bodyBold" color="#FFF">Version</Txt>
                        <Txt variant="small" color={R.muted}>2.4.0 (Nano Banana)</Txt>
                    </View>
                </View>

            </ScrollView>
        </View>
    );
}

function SettingRow({ label, sub, value, onToggle }: any) {
    return (
        <View style={s.row}>
            <View style={{ flex: 1 }}>
                <Txt variant="bodyBold" color="#FFF">{label}</Txt>
                <Txt variant="small" color={R.muted}>{sub}</Txt>
            </View>
            <Switch
                value={value}
                onValueChange={onToggle}
                trackColor={{ false: '#333', true: R.purple }}
                thumbColor="#FFF"
            />
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: R.bg },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, marginBottom: 20 },
    backBtn: { width: 44, height: 44, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' },

    scroll: { paddingHorizontal: 20 },
    sectionLabel: { marginLeft: 16, marginBottom: 12, marginTop: 32, letterSpacing: 2 },
    card: { backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 32, padding: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
    row: { flexDirection: 'row', alignItems: 'center', padding: 20 },
    divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.05)', marginHorizontal: 20 },
});
