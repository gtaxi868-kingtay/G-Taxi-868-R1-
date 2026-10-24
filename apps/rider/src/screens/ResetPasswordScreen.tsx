import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '@gtaxi/core';
import { RainLogin, CrystalInput, CrystalButton } from '@gtaxi/design-system/native';
import { useAuth } from '../context/AuthContext';
import { toast } from '../components/Toast';

// Shown after the rider opens the password-reset email link (AuthContext
// turns the link into a short recovery session). Same crystal scaffold as
// the sign-in screen.
export function ResetPasswordScreen() {
    const { finishPasswordRecovery, signOut } = useAuth();
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const save = async () => {
        if (password.length < 8) { setError('Use at least 8 characters.'); return; }
        if (password !== confirm) { setError('The two passwords are different.'); return; }
        setError('');
        setSaving(true);
        const { error: updateError } = await supabase.auth.updateUser({ password });
        setSaving(false);
        if (updateError) { setError(updateError.message); return; }
        toast('Your new password is set', 'success');
        finishPasswordRecovery();
    };

    const cancel = async () => {
        finishPasswordRecovery();
        await signOut();
    };

    return (
        <View style={{ flex: 1 }}>
            <StatusBar style="light" />
            <RainLogin
                voice="rider"
                logoSource={require('../../assets/logo.png')}
                footer={
                    <Pressable accessibilityRole="button" onPress={cancel} style={{ alignItems: 'center', paddingVertical: 8 }}>
                        <Text style={s.linkText}>Cancel</Text>
                    </Pressable>
                }
            >
                <Text style={s.title}>Set a new password</Text>
                <Text style={s.body}>Choose one you have not used here before.</Text>
                {error ? <Text style={s.error}>{error}</Text> : null}
                <CrystalInput label="New password" voice="rider" placeholder="At least 8 characters" value={password} onChangeText={setPassword} secureTextEntry />
                <CrystalInput label="Confirm" voice="rider" placeholder="Type it again" value={confirm} onChangeText={setConfirm} secureTextEntry />
                <CrystalButton title="Save password" voice="rider" onPress={save} loading={saving} />
            </RainLogin>
        </View>
    );
}

const s = StyleSheet.create({
    title: { color: '#EAF3F6', fontSize: 22, fontWeight: '800', textAlign: 'center' },
    body: { color: 'rgba(234,243,246,0.7)', fontSize: 15, lineHeight: 21, textAlign: 'center', marginBottom: 4 },
    error: { color: '#FF6B6B', fontSize: 13, fontWeight: '600', textAlign: 'center' },
    linkText: { color: 'rgba(234,243,246,0.55)', fontSize: 14, fontWeight: '500' },
});
