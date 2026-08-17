import React, { useState, useEffect } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity, Switch,
    ScrollView, Alert, useWindowDimensions, TextInput, ActivityIndicator, Linking
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@gtaxi/core';
import { useAuth } from '../context/AuthContext';
import { usePlatformFlags } from '../hooks/usePlatformFlags';
import { Txt } from '@/design-system/primitives';
import { SURFACE, VOICES, ANIMATION } from '@gtaxi/design-system';
import { ghostBorder, elevationGlow } from '@gtaxi/design-system/utils/style-rules';
import { LEGAL_DOC_URLS } from '@g868/shared/legal';

const CYAN = '#06B6D4';

const R = {
    bg: SURFACE.base,
    surface: 'rgba(255,255,255,0.08)',
    border: 'rgba(191,64,255,0.2)',
    purple: VOICES.rider.accent,
    purpleLight: VOICES.rider.accent,
    gold: '#F59E0B',
    white: '#EAF3F6',
    muted: '#AEA9B5',
};

export function SettingsScreen({ navigation }: any) {
    const { width } = useWindowDimensions();
    const { user } = useAuth();
    const insets = useSafeAreaInsets();
    // 'opt_in_ai_routing' on the admin's Platform Control page. Until now that
    // switch controlled nothing; this is the read that makes it real.
    const { flags } = usePlatformFlags();

    const [notifyRides, setNotifyRides] = useState(true);
    const [notifyPromos, setNotifyPromos] = useState(true);
    const [aiRouting, setAiRouting] = useState(false);

    const [contactName, setContactName] = useState('');
    const [contactPhone, setContactPhone] = useState('');

    // ── Account deletion ────────────────────────────────────────────────────
    // The backend has had request/cancel/status since 20260806010000; nothing
    // called them, so the Privacy Policy had to tell people to send an email.
    // This is that call site.
    const [delStatus, setDelStatus] = useState<any>(null);
    const [delBusy, setDelBusy] = useState(false);
    const [confirmText, setConfirmText] = useState('');
    const [showConfirm, setShowConfirm] = useState(false);

    const loadDeletionStatus = async () => {
        // .then(ok, err) — supabase.rpc returns a THENABLE with no .catch.
        const { data, error } = await supabase.rpc('get_my_deletion_status')
            .then((r: any) => r, (e: any) => ({ data: null, error: e }));
        if (!error && data) setDelStatus(data);
    };

    useEffect(() => { loadDeletionStatus(); }, [user?.id]);

    const submitDeletion = async () => {
        setDelBusy(true);
        const { data, error } = await supabase.rpc('request_account_deletion')
            .then((r: any) => r, (e: any) => ({ data: null, error: e }));
        setDelBusy(false);

        if (error || !data?.success) {
            Alert.alert('Could not submit', 'Please try again, or email privacy@gtaxi.tt.');
            return;
        }

        setShowConfirm(false);
        setConfirmText('');
        await loadDeletionStatus();

        const when = new Date(data.scheduled_at).toLocaleDateString();
        Alert.alert(
            'Deletion scheduled',
            `Your account will be deleted on ${when}. You can cancel any time before then from this screen.` +
            (data.warning ? `\n\n${data.warning}` : ''),
        );
    };

    const startDeletion = () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        const bal = Number(delStatus?.wallet_balance_cents ?? 0);
        Alert.alert(
            'Delete your account?',
            'Your name, contact details, saved places and assistant memory are erased.\n\n' +
            'Records the law requires us to keep — payments and trip totals — stay, ' +
            'but with nothing linking them to you.\n\n' +
            `You get 30 days to change your mind.${bal > 0
                ? `\n\nYou have TT$${(bal / 100).toFixed(2)} in your wallet. Withdraw it first — it cannot be returned afterwards.`
                : ''}`,
            [
                { text: 'Keep my account', style: 'cancel' },
                { text: 'Continue', style: 'destructive', onPress: () => setShowConfirm(true) },
            ],
        );
    };

    const cancelDeletion = async () => {
        setDelBusy(true);
        const { data, error } = await supabase.rpc('cancel_account_deletion')
            .then((r: any) => r, (e: any) => ({ data: null, error: e }));
        setDelBusy(false);
        if (error || !data?.success) {
            Alert.alert('Could not cancel', 'Please try again, or email privacy@gtaxi.tt.');
            return;
        }
        await loadDeletionStatus();
        Alert.alert('Deletion cancelled', 'Your account is staying. Nothing was removed.');
    };
    const [savingContact, setSavingContact] = useState(false);

    const [progLevel, setProgLevel] = useState(1);
    const [progTier, setProgTier] = useState('free');
    const [progDiscount, setProgDiscount] = useState(0);

    useEffect(() => {
        if (!user) return;

        (async () => {
            try {
                const { data: notifData } = await supabase.from('notification_settings').select('*').eq('user_id', user.id).single();
                if (notifData) {
                    setNotifyRides(notifData.ride_updates);
                    setNotifyPromos(notifData.promotions);
                }
            } catch (err) { console.error('[Settings] notification_settings:', err); }

            try {
                const { data: subData } = await supabase.from('profiles').select('subscription_tier').eq('id', user.id).single();
                if (subData) {
                    setProgTier(subData.subscription_tier || 'free');
                }
            } catch (err) { console.error('[Settings] subscription_tier:', err); }

            try {
                const { data: progData } = await supabase.from('rider_progression').select('level').eq('rider_id', user.id).maybeSingle();
                if (progData?.level) {
                    setProgLevel(progData.level);
                    const { data: cfg } = await supabase.from('progression_config').select('discount_percent').eq('level', progData.level).maybeSingle();
                    if (cfg?.discount_percent) setProgDiscount(cfg.discount_percent);
                }
            } catch (err) { console.error('[Settings] progression:', err); }

            try {
                const { data: contactData } = await supabase.from('profiles').select('emergency_contact_name, emergency_contact_phone').eq('id', user.id).single();
                if (contactData) {
                    setContactName(contactData.emergency_contact_name || '');
                    setContactPhone(contactData.emergency_contact_phone || '');
                }
            } catch (err) { console.error('[SettingsScreen] emergency_contact:', err); }

            try {
                const val = await AsyncStorage.getItem('@ai_routing_opt_in');
                setAiRouting(val === 'true');
            } catch {}
        })();
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
                    <Ionicons name="chevron-back" size={24} color="#EAF3F6" />
                </TouchableOpacity>
                <Txt variant="headingM" weight="heavy" color="#EAF3F6" style={{ marginLeft: 16, fontFamily: 'CormorantGaramond_600SemiBold' }}>Settings</Txt>
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
                            <ActivityIndicator size="small" color="#EAF3F6" />
                        ) : (
                            <Txt variant="bodyBold" color="#EAF3F6">Save Emergency Contact</Txt>
                        )}
                    </TouchableOpacity>
                </View>

                <Txt variant="caption" weight="heavy" color={R.muted} style={s.sectionLabel}>PRIVACY & SECURITY</Txt>
                <View style={s.card}>
                    {flags.aiRoutingOffered && (
                        <>
                            <SettingRow
                                label="AI Route Opt-In"
                                sub="Share data for discount routes"
                                value={aiRouting}
                                onToggle={(v: boolean) => toggleSetting('ai_routing', v)}
                            />
                            <View style={s.divider} />
                        </>
                    )}
                    <TouchableOpacity style={s.row} onPress={async () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); try { const keys = await AsyncStorage.getAllKeys(); await AsyncStorage.multiRemove(keys); Alert.alert('Cache Cleared', 'Local storage has been refreshed.'); } catch { Alert.alert('Error', 'Could not clear cache.'); } }}>
                        <View style={{ flex: 1 }}>
                            <Txt variant="bodyBold" color="#EAF3F6">Clear App Cache</Txt>
                            <Txt variant="small" color={R.muted}>Refresh local storage</Txt>
                        </View>
                        <Ionicons name="trash-outline" size={20} color={R.muted} />
                    </TouchableOpacity>
                </View>

                <Txt variant="caption" weight="heavy" color={R.muted} style={s.sectionLabel}>G-LEVEL</Txt>
                <TouchableOpacity style={s.card} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); (navigation as any).navigate('Subscription'); }}>
                    <View style={{ padding: 20 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                            <View style={{ paddingHorizontal: 12, paddingVertical: 4, borderRadius: 99, backgroundColor: progTier === 'g_member' ? '#CBD6DE' : R.purple }}>
                                <Text style={{ color: '#EAF3F6', fontWeight: '800', fontSize: 12, textTransform: 'uppercase' }}>
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
                            <Txt variant="bodyBold" color="#EAF3F6">Refer & Earn</Txt>
                            <Txt variant="small" color={R.muted}>Give TTD $15, get TTD $15</Txt>
                        </View>
                        <Ionicons name="gift-outline" size={20} color={R.purple} />
                    </TouchableOpacity>
                </View>

                <Txt variant="caption" weight="heavy" color={R.muted} style={s.sectionLabel}>ABOUT</Txt>
                <View style={s.card}>
                    <TouchableOpacity style={s.row} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); Linking.openURL(LEGAL_DOC_URLS.terms_of_service); }}>
                        <Txt variant="bodyBold" color="#EAF3F6">Terms of Service</Txt>
                        <Ionicons name="chevron-forward" size={18} color={R.muted} />
                    </TouchableOpacity>
                    <View style={s.divider} />
                    <TouchableOpacity style={s.row} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); Linking.openURL(LEGAL_DOC_URLS.privacy_policy); }}>
                        <Txt variant="bodyBold" color="#EAF3F6">Privacy Policy</Txt>
                        <Ionicons name="chevron-forward" size={18} color={R.muted} />
                    </TouchableOpacity>
                    <View style={s.divider} />
                    <View style={s.row}>
                        <Txt variant="bodyBold" color="#EAF3F6">Version</Txt>
                        <Txt variant="small" color={R.muted}>2.4.0 (Nano Banana)</Txt>
                    </View>
                </View>

                <Txt variant="caption" weight="heavy" color={R.muted} style={s.sectionLabel}>YOUR ACCOUNT</Txt>
                <View style={s.card}>
                    {delStatus?.pending ? (
                        <View style={{ padding: 20 }}>
                            <Txt variant="bodyBold" color="#F59E0B">
                                {delStatus.status === 'on_hold'
                                    ? 'Deletion paused'
                                    : 'Deletion scheduled'}
                            </Txt>
                            <Txt variant="small" color={R.muted} style={{ marginTop: 6, lineHeight: 18 }}>
                                {delStatus.status === 'on_hold'
                                    ? `We cannot finish this yet: ${delStatus.hold_reason ?? 'an open matter on your account'}. It will complete once that is resolved.`
                                    : `Your account will be deleted on ${new Date(delStatus.scheduled_at).toLocaleDateString()}. You can stop this at any time before then.`}
                            </Txt>
                            {Number(delStatus.wallet_balance_cents ?? 0) > 0 && (
                                <Txt variant="small" color="#F59E0B" style={{ marginTop: 10, lineHeight: 18 }}>
                                    You still have TT${(Number(delStatus.wallet_balance_cents) / 100).toFixed(2)} in your wallet.
                                    Withdraw it before then — it cannot be returned afterwards.
                                </Txt>
                            )}
                            <TouchableOpacity
                                style={[s.row, { marginTop: 14, justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 16 }]}
                                disabled={delBusy}
                                onPress={cancelDeletion}
                            >
                                {delBusy
                                    ? <ActivityIndicator size="small" color="#EAF3F6" />
                                    : <Txt variant="bodyBold" color={R.purple}>Keep my account</Txt>}
                            </TouchableOpacity>
                        </View>
                    ) : showConfirm ? (
                        <View style={{ padding: 20 }}>
                            <Txt variant="bodyBold" color="#EAF3F6">Type DELETE to confirm</Txt>
                            <Txt variant="small" color={R.muted} style={{ marginTop: 6, lineHeight: 18 }}>
                                This starts a 30-day countdown. You can stop it any time before it ends.
                            </Txt>
                            <TextInput
                                value={confirmText}
                                onChangeText={setConfirmText}
                                autoCapitalize="characters"
                                autoCorrect={false}
                                placeholder="DELETE"
                                placeholderTextColor="rgba(255,255,255,0.25)"
                                style={{
                                    marginTop: 14, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14,
                                    backgroundColor: 'rgba(0,0,0,0.25)', color: '#EAF3F6', fontWeight: '700',
                                    letterSpacing: 2, borderWidth: 1, borderColor: R.border,
                                }}
                            />
                            <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
                                <TouchableOpacity
                                    style={{ flex: 1, alignItems: 'center', paddingVertical: 14, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.06)' }}
                                    onPress={() => { setShowConfirm(false); setConfirmText(''); }}
                                >
                                    <Txt variant="bodyBold" color="#EAF3F6">Cancel</Txt>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={{
                                        flex: 1, alignItems: 'center', paddingVertical: 14, borderRadius: 16,
                                        backgroundColor: confirmText.trim() === 'DELETE' ? '#B91C1C' : 'rgba(185,28,28,0.25)',
                                    }}
                                    disabled={confirmText.trim() !== 'DELETE' || delBusy}
                                    onPress={submitDeletion}
                                >
                                    {delBusy
                                        ? <ActivityIndicator size="small" color="#EAF3F6" />
                                        : <Txt variant="bodyBold" color="#EAF3F6">Delete account</Txt>}
                                </TouchableOpacity>
                            </View>
                        </View>
                    ) : (
                        <TouchableOpacity style={s.row} onPress={startDeletion}>
                            <View style={{ flex: 1 }}>
                                <Txt variant="bodyBold" color="#EAF3F6">Delete my account</Txt>
                                <Txt variant="small" color={R.muted}>Erases your details. 30 days to change your mind.</Txt>
                            </View>
                            <Ionicons name="close-circle-outline" size={20} color="#B91C1C" />
                        </TouchableOpacity>
                    )}
                </View>

            </ScrollView>
        </View>
    );
}

function SettingRow({ label, sub, value, onToggle }: any) {
    return (
        <View style={s.row}>
            <View style={{ flex: 1 }}>
                <Txt variant="bodyBold" color="#EAF3F6">{label}</Txt>
                <Txt variant="small" color={R.muted}>{sub}</Txt>
            </View>
            <Switch
                value={value}
                onValueChange={onToggle}
                trackColor={{ false: '#333', true: R.purple }}
                thumbColor="#EAF3F6"
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
        paddingHorizontal: 16, paddingVertical: 14, fontSize: 15, color: '#EAF3F6',
        marginHorizontal: 12, marginTop: 10, ...ghostBorder(0.12),
    },
    saveBtn: {
        backgroundColor: VOICES.rider.accent, borderRadius: 16,
        alignItems: 'center', justifyContent: 'center', paddingVertical: 14,
        margin: 12, marginTop: 14,
    },
});
