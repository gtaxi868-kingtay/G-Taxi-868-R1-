import React, { useState, useEffect } from 'react';
import { View, Alert, Linking } from 'react-native';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@gtaxi/core';
import { useAuth } from '../context/AuthContext';
import { usePlatformFlags } from '../hooks/usePlatformFlags';
import { toast } from '../components/Toast';
import { Button, Card, Field, Row, Screen, Section, SPACE, Toggle, Txt, useTheme } from '../ui/kit';
import { LEGAL_DOC_URLS } from '@g868/shared/legal';

export function SettingsScreen({ navigation }: any) {
    const { user } = useAuth();
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
            toast('Enter both a name and a phone number.', 'error');
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
            toast('Could not save your emergency contact. Please try again.', 'error');
        } else {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            toast('Emergency contact saved', 'success');
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

    const m = useTheme();
    const toggleRow = (title: string, sub: string, value: boolean, onChange: (v: boolean) => void, last?: boolean) => (
        <Row title={title} subtitle={sub} last={last} right={<Toggle label={title} value={value} onChange={onChange} />} />
    );

    return (
        <Screen title="Settings" onBack={() => navigation.goBack()}>
            <Section title="Notifications" style={{ marginTop: SPACE.sm }}>
                <Card style={{ paddingVertical: SPACE.xs }}>
                    {toggleRow('Ride updates', 'Driver arrivals and trip status', notifyRides, (v) => toggleSetting('ride_updates', v))}
                    {toggleRow('Promotions', 'Discounts and news', notifyPromos, (v) => toggleSetting('promotions', v), true)}
                </Card>
            </Section>

            <Section title="Emergency contact">
                <Card>
                    <Txt variant="caption" tone="dim" style={{ marginBottom: SPACE.md }}>Who we should contact for you in an emergency during a ride.</Txt>
                    <Field label="Name" placeholder="Contact name" value={contactName} onChangeText={setContactName} autoCapitalize="words" />
                    <Field label="Phone" placeholder="+1 868 000 0000" value={contactPhone} onChangeText={setContactPhone} keyboardType="phone-pad" />
                    <Button title="Save contact" size="md" variant="secondary" loading={savingContact} onPress={saveEmergencyContact} />
                </Card>
            </Section>

            <Section title="Privacy">
                <Card style={{ paddingVertical: SPACE.xs }}>
                    {flags.aiRoutingOffered && toggleRow('Smarter routes', 'Share trip data for discounted routes', aiRouting, (v) => toggleSetting('ai_routing', v))}
                    <Row title="Clear saved app data" subtitle="Resets preferences stored on this phone" last
                        right={<Ionicons name="refresh-outline" size={20} color={m.faint} />}
                        onPress={() => Alert.alert('Clear saved app data?', 'Preferences stored on this phone will reset. You stay signed in.', [
                            { text: 'Cancel', style: 'cancel' },
                            { text: 'Clear', style: 'destructive', onPress: async () => {
                                try { const keys = await AsyncStorage.getAllKeys(); await AsyncStorage.multiRemove(keys); toast('App data cleared', 'success'); }
                                catch { toast('Could not clear app data', 'error'); }
                            } },
                        ])} />
                </Card>
            </Section>

            <Section title="G-Level">
                <Card onPress={() => { Haptics.selectionAsync(); (navigation as any).navigate('Subscription'); }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Txt variant="bodyStrong" style={{ flex: 1 }}>{progTier === 'g_member' ? 'G-Member' : `Level ${progLevel}`}</Txt>
                        <Ionicons name="chevron-forward" size={18} color={m.faint} />
                    </View>
                    <Txt variant="caption" tone="dim" style={{ marginTop: SPACE.xs }}>
                        {progTier === 'g_member'
                            ? '15% off your first 6 rides each month, priority matching and 20 minutes free waiting.'
                            : progLevel >= 5
                                ? 'You qualify for G-Member. Tap to see the benefits.'
                                : `${progDiscount > 0 ? `${progDiscount}% off rides now. ` : ''}Ride more to unlock better perks.`}
                    </Txt>
                </Card>
            </Section>

            <Section title="More">
                <Card style={{ paddingVertical: SPACE.xs }}>
                    <Row icon="people-outline" title="Invite friends" subtitle="Give TT$15, get TT$15" onPress={() => (navigation as any).navigate('Referral')} />
                    <Row icon="document-text-outline" title="Terms of Service" onPress={() => Linking.openURL(LEGAL_DOC_URLS.terms_of_service)} />
                    <Row icon="lock-closed-outline" title="Privacy Policy" onPress={() => Linking.openURL(LEGAL_DOC_URLS.privacy_policy)} />
                    <Row icon="information-circle-outline" title="Version" right={<Txt variant="body" tone="dim">{Constants.expoConfig?.version || '1.0'}</Txt>} last />
                </Card>
            </Section>

            <Section title="Your account">
                <Card>
                    {delStatus?.pending ? (
                        <>
                            <Txt variant="bodyStrong" style={{ color: '#D97706' }}>{delStatus.status === 'on_hold' ? 'Deletion paused' : 'Deletion scheduled'}</Txt>
                            <Txt variant="caption" tone="dim" style={{ marginTop: SPACE.xs }}>
                                {delStatus.status === 'on_hold'
                                    ? `We cannot finish this yet: ${delStatus.hold_reason ?? 'an open matter on your account'}. It will complete once that is resolved.`
                                    : `Your account will be deleted on ${new Date(delStatus.scheduled_at).toLocaleDateString()}. You can stop this any time before then.`}
                            </Txt>
                            {Number(delStatus.wallet_balance_cents ?? 0) > 0 && (
                                <Txt variant="caption" style={{ color: '#D97706', marginTop: SPACE.sm }}>
                                    You still have TT${(Number(delStatus.wallet_balance_cents) / 100).toFixed(2)} in your wallet. Withdraw it first; it cannot be returned afterwards.
                                </Txt>
                            )}
                            <Button title="Keep my account" size="md" style={{ marginTop: SPACE.md }} loading={delBusy} onPress={cancelDeletion} />
                        </>
                    ) : showConfirm ? (
                        <>
                            <Txt variant="bodyStrong">Type DELETE to confirm</Txt>
                            <Txt variant="caption" tone="dim" style={{ marginTop: SPACE.xs, marginBottom: SPACE.md }}>This starts a 30-day countdown. You can stop it any time before it ends.</Txt>
                            <Field value={confirmText} onChangeText={setConfirmText} autoCapitalize="characters" autoCorrect={false} placeholder="DELETE" />
                            <View style={{ flexDirection: 'row', gap: SPACE.md }}>
                                <Button title="Cancel" size="md" variant="secondary" style={{ flex: 1 }} onPress={() => { setShowConfirm(false); setConfirmText(''); }} />
                                <Button title="Delete account" size="md" variant="danger" style={{ flex: 1 }} loading={delBusy}
                                    disabled={confirmText.trim() !== 'DELETE'} onPress={submitDeletion} />
                            </View>
                        </>
                    ) : (
                        <Row icon="trash-outline" title="Delete my account" subtitle="Erases your details. 30 days to change your mind." danger last onPress={startDeletion} />
                    )}
                </Card>
            </Section>
        </Screen>
    );
}
