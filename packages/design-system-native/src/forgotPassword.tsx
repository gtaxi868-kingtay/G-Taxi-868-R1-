import React, { useState } from 'react';
import { Text, Pressable, StyleSheet, View } from 'react-native';
import { RainLogin, CrystalInput, CrystalButton } from './rainLogin';

// "Forgot password" in the crystal sign-in style, for any app that uses
// RainLogin (driver, shop). Two steps: email -> 6-digit code + new password.
// The app supplies the two server calls (see @g868/shared/passwordReset), so
// this file stays free of any backend client.

type Result = { ok: boolean; message: string };

const ACCENT: Record<string, string> = { driver: '#34E6EC', merchant: '#2DD4BF', rider: '#34E6EC', admin: '#8B5CF6' };

export function ForgotPasswordFlow(props: {
    voice?: 'driver' | 'merchant' | 'rider' | 'admin';
    logoSource?: any;
    initialEmail?: string;
    onBack: () => void;
    onRequestCode: (email: string) => Promise<Result>;
    onSetPassword: (email: string, code: string, password: string, confirm: string) => Promise<Result>;
    onDone?: () => void;
}) {
    const { voice = 'driver', logoSource, onBack, onRequestCode, onSetPassword, onDone } = props;
    const accent = ACCENT[voice] || ACCENT.driver;
    const [step, setStep] = useState<'email' | 'code'>('email');
    const [email, setEmail] = useState(props.initialEmail ?? '');
    const [code, setCode] = useState('');
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

    const sendCode = async () => {
        setBusy(true); setNote(null);
        const r = await onRequestCode(email);
        setBusy(false);
        setNote({ ok: r.ok, text: r.message });
        if (r.ok) setStep('code');
    };

    const save = async () => {
        setBusy(true); setNote(null);
        const r = await onSetPassword(email, code, password, confirm);
        setBusy(false);
        setNote({ ok: r.ok, text: r.message });
        if (r.ok) onDone?.();
    };

    const link = (label: string, onPress: () => void) => (
        <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={8} style={st.linkWrap}>
            <Text style={[st.link, { color: accent }]}>{label}</Text>
        </Pressable>
    );

    return (
        <RainLogin
            voice={voice}
            logoSource={logoSource}
            subtitle={step === 'email' ? 'Reset your password' : 'Enter your code'}
            footer={link('Back to sign in', onBack)}
        >
            {step === 'email' ? (
                <>
                    <Text style={st.help}>Enter the email you signed up with. We'll send you a 6-digit code.</Text>
                    <CrystalInput label="Email" voice={voice} placeholder="you@example.com" value={email} onChangeText={setEmail} keyboardType="email-address" testID="reset-email" />
                    {note ? <Text style={[st.note, { color: note.ok ? '#7EE2B8' : '#FF9A9E' }]} accessibilityLiveRegion="polite">{note.text}</Text> : null}
                    <CrystalButton title="Send me a code" voice={voice} onPress={sendCode} loading={busy} testID="reset-send" />
                </>
            ) : (
                <>
                    <Text style={st.help}>{`We sent a 6-digit code to ${email.trim().toLowerCase()}. It can take a minute; check spam too.`}</Text>
                    <CrystalInput label="6-digit code" voice={voice} placeholder="123456" value={code} onChangeText={(t: string) => setCode(t.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" testID="reset-code" />
                    <CrystalInput label="New password" voice={voice} placeholder="At least 8 characters" value={password} onChangeText={setPassword} secureTextEntry testID="reset-password" />
                    <CrystalInput label="Type it again" voice={voice} placeholder="Same password" value={confirm} onChangeText={setConfirm} secureTextEntry testID="reset-confirm" />
                    {note ? <Text style={[st.note, { color: note.ok ? '#7EE2B8' : '#FF9A9E' }]} accessibilityLiveRegion="polite">{note.text}</Text> : null}
                    <CrystalButton title="Save new password" voice={voice} onPress={save} loading={busy} testID="reset-save" />
                    <View style={st.row}>
                        {link('Send a new code', () => { setCode(''); sendCode(); })}
                        {link('Use a different email', () => { setStep('email'); setNote(null); setCode(''); })}
                    </View>
                </>
            )}
        </RainLogin>
    );
}

const st = StyleSheet.create({
    help: { color: 'rgba(234,243,246,0.78)', fontSize: 14, lineHeight: 20, marginBottom: 12 },
    note: { fontSize: 13, lineHeight: 18, marginBottom: 10 },
    linkWrap: { paddingVertical: 8 },
    link: { fontSize: 14, fontWeight: '700' },
    row: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
});
