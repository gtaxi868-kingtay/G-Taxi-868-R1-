import React, { useState, useEffect } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity, Switch,
    ScrollView, Alert, useWindowDimensions, TextInput, ActivityIndicator
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@gtaxi/core';
import { useAuth } from '../context/AuthContext';
import { Txt } from '@/design-system/primitives';
import { SURFACE, VOICES, ANIMATION } from '@gtaxi/design-system';
import { ghostBorder, elevationGlow } from '@gtaxi/design-system/utils/style-rules';

const CYAN = '#06B6D4';

const R = {
    bg: SURFACE.base,
    surface: 'rgba(255,255,255,0.08)',
    border: 'rgba(191,64,255,0.2)',
    purple: VOICES.rider.accent,
    purpleLight: VOICES.rider.accent,
    gold: '#F59E0B',
    white: '#FFFFFF',
    muted: '#AEA9B5',
};

export function SettingsScreen({ navigation }: any) {
    const { width } = useWindowDimensions();
    const { user } = useAuth();
    const insets = useSafeAreaInsets();

    const [notifyRides, setNotifyRides] = useState(true);
    const [notifyPromos, setNotifyPromos] = useState(true);
    const [aiRouting, setAiRouting] = useState(false);

    const [contactName, setContactName] = useState('');
    const [contactPhone, setContactPhone] = useState('');
    const [savingContact, setSavingContact] = useState(false);

    const [progLevel, setProgLevel] = useState(1);
    const [progTier, setProgTier] = useState('free');
    const [progDiscount, setProgDiscount] = useState(0);

    useEffect(() => {
        if (!user) return;
        supabase.from('notification_settings').select('*').eq('user_id', user.id).single()
            .then(({ data }) => {
                if (data) {
                    setNotifyRides(data.ride_updates);
                    setNotifyPromos(data.promotions);
                }
            });
        supabase.from('profiles').select('subscription_tier').eq('id', user.id).single()
            .then(({ data }) => {
                if (data) {
                    setProgTier(data.subscription_tier || 'free');
                }
            });
        supabase.from('rider_progression').select('level').eq('rider_id', user.id).maybeSingle()
            .then(async ({ data }) => {
                if (data?.level) {
                    setProgLevel(data.level);
                    const { data: cfg } = await supabase
                        .from('progression_config')
                        .select('discount_percent')
                        .eq('level', data.level)
                        .maybeSingle();
                    if (cfg?.discount_percent) setProgDiscount(cfg.discount_percent);
                }
            });
        supabase.from('profiles').select('emergency_contact_name, emergency_contact_phone').eq('id', user.id).single()
            .then(({ data }) => {
                if (data) {
                    setContactName(data.emergency_contact_name || '');
                    setContactPhone(data.emergency_contact_phone || '');
                }
            });
        AsyncStorage.getItem('@ai_routing_opt_in').then(val => setAiRouting(val === 'true'));
    }, [user]);

    const saveEmergencyContact = async () => {
        if (!user) return;
        if (!contactName.trim() || !contactPhone.trim()) {
            Alert.alert('Incomplete', 'Please enter both a name and phone number.');
            return;
        }
        setSavingContact(true);
        const { error } = await supabase
            .from('profiles')
            .update({
                emergency_contact_name: contactName.trim(),
                emergency_contact_phone: contactPhone.trim(),
            })
            .eq('id', user.id);
        setSavingContact(false);
        if (error) {
            Alert.alert('Error', 'Could not save emergency contact. Please try again.');
        } else {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            Alert.alert('Saved', 'Your emergency contact will be notified by SMS if you press SOS during a ride.');
        }
    };

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

                <Txt variant="caption" weight="heavy" color={R.muted} style={s.sectionLabel}>EMERGENCY CONTACT</Txt>
                <View style={s.card}>
                    <View style={{ padding: 20, paddingBottom: 8 }}>
                        <Txt variant="small" color={R.muted}>
                            Notified by SMS with your live location if you press SOS during a ride.
                        </Txt>
                    </View>
                    <TextInput
                        style={s.input}
                        placeholder="Contact name"
                        placeholderTextColor={R.muted}
                        value={contactName}
                        onChangeText={setContactName}
                    />
                    <TextInput
                        style={s.input}
                        placeholder="Phone number (e.g. +1868...)"
                        placeholderTextColor={R.muted}
                        value={contactPhone}
                        onChangeText={setContactPhone}
                        keyboardType="phone-pad"
                    />
                    <TouchableOpacity style={s.saveBtn} onPress={saveEmergencyContact} disabled={savingContact}>
                        {savingContact ? (
                            <ActivityIndicator size="small" color="#FFF" />
                        ) : (
                            <Txt variant="bodyBold" color="#FFF">Save Emergency Contact</Txt>
                        )}
                    </TouchableOpacity>
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

                <Txt variant="caption" weight="heavy" color={R.muted} style={s.sectionLabel}>G-LEVEL</Txt>
                <TouchableOpacity style={s.card} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); (navigation as any).navigate('Subscription'); }}>
                    <View style={{ padding: 20 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                            <View style={{ paddingHorizontal: 12, paddingVertical: 4, borderRadius: 99, backgroundColor: progTier === 'g_member' ? '#D4AF37' : R.purple }}>
                                <Text style={{ color: '#FFF', fontWeight: '800', fontSize: 12, textTransform: 'uppercase' }}>
                                    {progTier === 'g_member' ? 'G-Member' : `Level ${progLevel}`}
                                </Text>
                            </View>
                            {progTier === 'g_member' && (
                                <Text style={{ color: R.muted, fontSize: 12 }}>15% off · Unlimited priority</Text>
                            )}
                            {progTier !== 'g_member' && progDiscount > 0 && (
                                <Text style={{ color: R.muted, fontSize: 12 }}>{progDiscount}% off rides</Text>
                            )}
                        </View>
                        <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13, lineHeight: 18 }}>
                            {progTier === 'g_member'
                                ? 'You are a G-Member. 15% off all rides, unlimited priority matching, 20-minute wait grace.'
                                : progLevel >= 5
                                    ? 'Level 5 — you qualify for G-Member. Tap to upgrade and get 15% off everything.'
                                    : `Level ${progLevel} — ride more to unlock better perks. Tap to see your full benefits.`}
                        </Text>
                    </View>
                    <View style={s.divider} />
                    <View style={s.row}>
                        <Text style={{ color: R.purple, fontWeight: '700', fontSize: 14 }}>View G-Level</Text>
                        <Ionicons name="chevron-forward" size={18} color={R.purple} />
                    </View>
                </TouchableOpacity>

                <Txt variant="caption" weight="heavy" color={R.muted} style={s.sectionLabel}>EARN</Txt>
                <View style={s.card}>
                    <TouchableOpacity style={s.row} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); (navigation as any).navigate('Referral'); }}>
                        <View style={{ flex: 1 }}>
                            <Txt variant="bodyBold" color="#FFF">Refer & Earn</Txt>
                            <Txt variant="small" color={R.muted}>Give TTD $15, get TTD $15</Txt>
                        </View>
                        <Ionicons name="gift-outline" size={20} color={R.purple} />
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
    card: { backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 32, padding: 12, ...elevationGlow(8) },
    row: { flexDirection: 'row', alignItems: 'center', padding: 20 },
    divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.05)', marginHorizontal: 20 },
    input: {
        backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 16,
        paddingHorizontal: 16, paddingVertical: 14, fontSize: 15, color: '#FFF',
        marginHorizontal: 12, marginTop: 10, ...ghostBorder(0.12),
    },
    saveBtn: {
        backgroundColor: VOICES.rider.accent, borderRadius: 16,
        alignItems: 'center', justifyContent: 'center', paddingVertical: 14,
        margin: 12, marginTop: 14,
    },
});
