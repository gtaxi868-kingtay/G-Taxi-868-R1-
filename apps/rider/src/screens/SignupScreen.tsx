import React, { useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { RainLogin, CrystalInput, CrystalButton } from '@gtaxi/design-system/native';
import { VOICES } from '@gtaxi/design-system';
import * as Haptics from 'expo-haptics';
import { RIDER_CONSENT_DOCUMENTS, LEGAL_DOC_URLS } from '@g868/shared/legal';
import { savePendingSignup } from '@g868/shared/pendingSignup';
import { linkDriverCode, savePendingDriverCode } from '../services/driverCode';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@gtaxi/core';
import { toast } from '../components/Toast';
import { Checkbox, MoodProvider, Toggle } from '../ui/kit';

export function SignupScreen({ navigation }: any) {

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [showMore, setShowMore] = useState(false);
    const [checkEmail, setCheckEmail] = useState(false);

    const [formData, setFormData] = useState({
        name: '',
        email: '',
        phone: '',
        password: '',
        referralCode: '',
        commanderCode: '',
        aiEnabled: true,
        termsAccepted: false,
    });

    const handleSignup = async () => {
        if (!formData.termsAccepted) {
            setError('Please accept the terms of service to continue.');
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            return;
        }
        if (!formData.name || !formData.email || !formData.password) {
            setError('Please fill in your name, email, and password.');
            return;
        }
        if (formData.password.length < 6) {
            setError('Password must be at least 6 characters.');
            return;
        }

        setLoading(true);
        setError('');
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

        // The "AI assistant" toggle above was captured in formData and never
        // sent anywhere — a real dead control, same class of bug as the old
        // Legal screen toggle. There is one real AI preference in this app,
        // AsyncStorage key '@ai_routing_opt_in' (read by SettingsScreen and
        // LegalScreen, gated by the admin's opt_in_ai_routing platform flag).
        // It's a local-only preference — no auth or network needed to write
        // it — so honor whatever the user chose here immediately, rather
        // than silently discarding it and leaving the real toggle at its
        // SettingsScreen default (off) regardless of the user's answer.
        await AsyncStorage.setItem('@ai_routing_opt_in', formData.aiEnabled ? 'true' : 'false').catch(() => {});

        try {
            // Step 1: Create the auth account with email + password
            const { data: authData, error: signUpError } = await supabase.auth.signUp({
                email: formData.email.trim().toLowerCase(),
                password: formData.password,
                options: {
                    data: {
                        full_name: formData.name.trim(),
                        role: 'rider',
                        terms_accepted: true,
                        terms_accepted_at: new Date().toISOString(),
                    },
                },
            });

            if (signUpError) throw signUpError;
            if (!authData.user) throw new Error('Signup failed — no user returned');

            // Step 2: Save phone number to profiles table (no OTP required)
            if (formData.phone) {
                await supabase
                    .from('profiles')
                    .update({ phone_number: formData.phone.trim() })
                    .eq('id', authData.user.id);
            }

            // Step 2b: Record every document a rider is asked to accept as
            // real evidence — Terms, Privacy Policy, Data Retention notice,
            // Safety Policy. Was Terms-only; the other three had real
            // versioned docs in docs/legal/ and a real CHECK-constraint slot
            // in user_consents, but nothing ever wrote to them.
            //
            // The flags passed into signUp's options.data land in
            // raw_user_meta_data, which is USER-WRITABLE (any rider can call
            // auth.updateUser and set their own terms_accepted). That is not
            // proof. Verified live: 0 of 10 existing users carried the flag
            // at all, so there was no record of anyone accepting anything.
            //
            // record_consent writes to the append-only user_consents ledger
            // and takes the user id from auth.uid(), never from the client.
            // Needs a session, so it is skipped when email confirmation is
            // pending — same constraint as the commander code below.
            if (authData.session) {
                for (const doc of RIDER_CONSENT_DOCUMENTS) {
                    try {
                        await supabase.rpc('record_consent', {
                            p_document: doc.document,
                            p_version: doc.version,
                            p_user_agent: Platform.OS,
                        });
                    } catch (e) {
                        // One document failing to record must not stop the
                        // rest — do not block signup on any ledger write,
                        // but make the gap visible rather than silent.
                        console.warn(`[Signup] consent not recorded for ${doc.document}:`, e);
                    }
                }
            } else {
                // Email confirmation is on, so there is no session yet and
                // auth.uid() is null — record_consent and apply_commander_code
                // would both be rejected. Park them; AuthContext flushes on the
                // first real sign-in. Previously both were simply dropped and
                // never retried.
                await savePendingSignup(AsyncStorage, {
                    forUserId: authData.user.id,
                    consents: RIDER_CONSENT_DOCUMENTS.map(doc => ({
                        document: doc.document,
                        version: doc.version,
                        userAgent: Platform.OS,
                    })),
                    commanderCode: formData.commanderCode.trim() || undefined,
                });
            }

            // Step 3: Apply referral code if provided — TTD $15 each, paid after this rider's first completed ride
            // apply_referral_code returns {success:false, error} on a bad/
            // expired/self-referral code rather than raising, so the
            // try/catch below never fired either way — a wrong code looked
            // identical to a correct one. Surfaced (non-blocking) so the
            // rider actually learns their code didn't apply.
            let referralWarning: string | null = null;
            if (formData.referralCode.trim()) {
                try {
                    const { data: referralResult } = await supabase.rpc('apply_referral_code', {
                        p_referee_id: authData.user.id,
                        p_code: formData.referralCode.trim().toUpperCase(),
                        p_type: 'rider',
                    });
                    if (referralResult && referralResult.success === false) {
                        referralWarning = referralResult.error || 'That referral code could not be applied.';
                        // Not a rider's code: it may be a DRIVER's code (from
                        // their keychain). Link this rider to that driver.
                        if (/invalid referral code/i.test(referralWarning || '')) {
                            const code = formData.referralCode.trim().toUpperCase();
                            if (authData.session) {
                                const driverResult = await linkDriverCode(code);
                                referralWarning = driverResult.success
                                    ? null
                                    : (driverResult.error === 'Invalid referral code'
                                        ? 'That code was not found. Check it and add it later from Refer & Earn.'
                                        : driverResult.error || 'That code could not be applied.');
                            } else {
                                // No session until the email is confirmed: apply it at first sign-in.
                                await savePendingDriverCode(code);
                                referralWarning = null;
                            }
                        }
                    }
                } catch { /* non-fatal — bonus is a perk, not a requirement */ }
            }

            // Step 4: Link to a G-Lead's territory if a commander code was entered.
            // Requires an active session — apply_commander_code reads auth.uid().
            // If email confirmation is required (no session yet), this is silently
            // skipped; nothing in this repo re-prompts for it post-verification.
            if (formData.commanderCode.trim() && authData.session) {
                try {
                    await supabase.rpc('apply_commander_code', {
                        p_code: formData.commanderCode.trim(),
                    });
                } catch { /* non-fatal — territory linking is a bonus, not a requirement */ }
            }

            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            if (referralWarning) toast(referralWarning, 'error');
            if (!authData.session) {
                // Email confirmation is on: show the "check your email" step.
                setCheckEmail(true);
            } else {
                // Signed in already: the app moves to Home on its own.
                toast('Welcome to G 868', 'success');
            }

        } catch (err: any) {

            setError(err.message || 'Signup failed. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    const set = (k: keyof typeof formData) => (v: any) => setFormData({ ...formData, [k]: v });
    const link = (text: string, accent: string, onPress: () => void) => (
        <Pressable accessibilityRole="button" onPress={() => { Haptics.selectionAsync(); onPress(); }} style={{ alignItems: 'center', paddingVertical: 8 }}>
            <Text style={st.linkText}>{text} <Text style={st.linkAccent}>{accent}</Text></Text>
        </Pressable>
    );

    // Same crystal "rain" scaffold as the sign-in screen, so signing in,
    // signing up and resetting a password feel like one place.
    if (checkEmail) {
        return (
            <View style={{ flex: 1 }}>
                <StatusBar style="light" />
                <RainLogin voice="rider" logoSource={require('../../assets/logo.png')}
                    footer={link('Prefer WhatsApp?', 'Verify there', () => Linking.openURL('https://wa.me/18687031000?text=VERIFY_ACCOUNT_' + encodeURIComponent(formData.email)))}>
                    <Text style={st.title}>Check your email</Text>
                    <Text style={st.body}>We sent a link to {formData.email.trim()}. Tap it to confirm your account, then sign in.</Text>
                    <CrystalButton title="Back to sign in" voice="rider" onPress={() => navigation.navigate('Login')} />
                </RainLogin>
            </View>
        );
    }

    return (
        <View style={{ flex: 1 }}>
            <StatusBar style="light" />
            <RainLogin
                voice="rider"
                logoSource={require('../../assets/logo.png')}
                footer={link('Already have an account?', 'Sign in', () => navigation.navigate('Login'))}
            >
                {error ? <Text style={st.error}>{error}</Text> : null}

                <CrystalInput label="Full name" voice="rider" placeholder="Your name" value={formData.name} onChangeText={set('name')} autoCapitalize="words" />
                <CrystalInput label="Email" voice="rider" placeholder="you@email.com" value={formData.email} onChangeText={set('email')} keyboardType="email-address" />
                <CrystalInput label="Phone (optional)" voice="rider" placeholder="+1 868 000 0000" value={formData.phone} onChangeText={set('phone')} keyboardType="phone-pad" />
                <CrystalInput label="Password" voice="rider" placeholder="At least 6 characters" value={formData.password} onChangeText={set('password')} secureTextEntry />

                {showMore ? (
                    <>
                        <CrystalInput label="Referral or driver code" voice="rider" placeholder="e.g. ABC123" value={formData.referralCode} onChangeText={set('referralCode')} autoCapitalize="characters" />
                        <CrystalInput label="G-Lead code" voice="rider" placeholder="Code from your G-Lead" value={formData.commanderCode} onChangeText={set('commanderCode')} autoCapitalize="characters" />
                    </>
                ) : link('Have a referral or driver code?', 'Add it', () => setShowMore(true))}

                <MoodProvider force="night">
                    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 4 }}>
                        <View style={{ flex: 1, marginRight: 12 }}>
                            <Text style={st.rowTitle}>G assistant</Text>
                            <Text style={st.rowSub}>Helpful safety and comfort tips during rides</Text>
                        </View>
                        <Toggle color={VOICES.rider.accent} label="G assistant" value={formData.aiEnabled} onChange={(v) => { set('aiEnabled')(v); Haptics.selectionAsync(); }} />
                    </View>
                    <Checkbox color={VOICES.rider.accent} checked={formData.termsAccepted} onChange={(v) => { set('termsAccepted')(v); Haptics.selectionAsync(); }}>
                        <Text style={st.rowSub}>
                            I accept the{' '}
                            <Text style={st.linkAccent} onPress={() => Linking.openURL(LEGAL_DOC_URLS.terms_of_service)}>Terms of Service</Text>
                            {' '}and{' '}
                            <Text style={st.linkAccent} onPress={() => Linking.openURL(LEGAL_DOC_URLS.privacy_policy)}>Privacy Policy</Text>
                        </Text>
                    </Checkbox>
                </MoodProvider>

                <CrystalButton title="Create account" voice="rider" onPress={handleSignup} loading={loading} />
            </RainLogin>
        </View>
    );
}

const st = StyleSheet.create({
    title: { color: '#EAF3F6', fontSize: 22, fontWeight: '800', textAlign: 'center' },
    body: { color: 'rgba(234,243,246,0.7)', fontSize: 15, lineHeight: 21, textAlign: 'center', marginBottom: 8 },
    error: { color: '#FF6B6B', fontSize: 13, fontWeight: '600', textAlign: 'center' },
    linkText: { color: 'rgba(234,243,246,0.55)', fontSize: 14, fontWeight: '500' },
    linkAccent: { color: VOICES.rider.accent, fontWeight: '700' },
    rowTitle: { color: '#EAF3F6', fontSize: 15, fontWeight: '700' },
    rowSub: { color: 'rgba(234,243,246,0.6)', fontSize: 13, lineHeight: 18 },
});
