import React, { useState } from 'react';
import { View } from 'react-native';
import { supabase } from '@gtaxi/core';
import { useAuth } from '../context/AuthContext';
import { toast } from '../components/Toast';
import { Button, Field, LinkText, Screen, SPACE, Txt } from '../ui/kit';

// Shown after the rider opens the password-reset email link (AuthContext
// turns the link into a short recovery session). Sets the new password,
// then drops into the app as normal.
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
        <Screen
            hero={
                <View style={{ paddingTop: SPACE.xl }}>
                    <Txt variant="hero">Set a new password</Txt>
                    <Txt variant="body" tone="dim" style={{ marginTop: SPACE.xs }}>Choose one you have not used here before.</Txt>
                </View>
            }
            footer={
                <View>
                    <Button title="Save password" onPress={save} loading={saving} />
                    <LinkText onPress={cancel}>Cancel</LinkText>
                </View>
            }
        >
            <Field label="New password" placeholder="At least 8 characters" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" textContentType="newPassword" />
            <Field label="Confirm" placeholder="Type it again" value={confirm} onChangeText={setConfirm} secureTextEntry autoCapitalize="none" error={error || null} />
        </Screen>
    );
}
