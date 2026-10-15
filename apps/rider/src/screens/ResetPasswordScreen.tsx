import React, { useState } from 'react';
import {
    View, Text, TextInput, TouchableOpacity, StyleSheet, Alert,
    ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '@gtaxi/core';
import { VOICES } from '@gtaxi/design-system';
import { useAuth } from '../context/AuthContext';

// Shown after the rider opens the password-reset email link (AuthContext
// turns the link into a short recovery session). Sets the new password,
// then drops into the app as normal.
export function ResetPasswordScreen() {
    const insets = useSafeAreaInsets();
    const { finishPasswordRecovery, signOut } = useAuth();
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [saving, setSaving] = useState(false);

    const save = async () => {
        if (password.length < 8) {
            Alert.alert('Too short', 'Use at least 8 characters.');
            return;
        }
        if (password !== confirm) {
            Alert.alert("Doesn't match", 'The two passwords are different.');
            return;
        }
        setSaving(true);
        const { error } = await supabase.auth.updateUser({ password });
        setSaving(false);
        if (error) {
            Alert.alert('Could not change password', error.message);
            return;
        }
        Alert.alert('Password changed', 'Your new password is set.');
        finishPasswordRecovery();
    };

    const cancel = async () => {
        finishPasswordRecovery();
        await signOut();
    };

    return (
        <View style={s.root}>
            <StatusBar style="light" />
            <LinearGradient colors={['#1A0533', '#0D1B4B']} style={StyleSheet.absoluteFillObject} />
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={[s.content, { paddingTop: insets.top + 60 }]}>
                <View style={s.iconCircle}>
                    <Ionicons name="key-outline" size={32} color={VOICES.rider.accent} />
                </View>
                <Text style={s.title}>Set a new password</Text>
                <Text style={s.subtitle}>Choose a password you haven't used here before.</Text>

                <Text style={s.label}>NEW PASSWORD</Text>
                <TextInput
                    style={s.input}
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry
                    autoCapitalize="none"
                    placeholder="At least 8 characters"
                    placeholderTextColor="rgba(255,255,255,0.4)"
                />
                <Text style={s.label}>CONFIRM</Text>
                <TextInput
                    style={s.input}
                    value={confirm}
                    onChangeText={setConfirm}
                    secureTextEntry
                    autoCapitalize="none"
                    placeholder="Type it again"
                    placeholderTextColor="rgba(255,255,255,0.4)"
                />

                <TouchableOpacity style={s.button} onPress={save} disabled={saving}>
                    <LinearGradient colors={[VOICES.rider.accent, VOICES.rider.accentDark]} style={s.buttonFill}>
                        {saving ? <ActivityIndicator color="#FFF" /> : <Text style={s.buttonText}>Save password</Text>}
                    </LinearGradient>
                </TouchableOpacity>
                <TouchableOpacity onPress={cancel} style={{ marginTop: 18, alignSelf: 'center' }}>
                    <Text style={s.cancel}>Cancel</Text>
                </TouchableOpacity>
            </KeyboardAvoidingView>
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1 },
    content: { flex: 1, paddingHorizontal: 24 },
    iconCircle: {
        width: 72, height: 72, borderRadius: 36, alignSelf: 'center',
        alignItems: 'center', justifyContent: 'center',
        backgroundColor: 'rgba(255,255,255,0.06)', marginBottom: 20,
    },
    title: { color: '#EAF3F6', fontSize: 26, fontWeight: '700', textAlign: 'center' },
    subtitle: { color: 'rgba(255,255,255,0.6)', fontSize: 14, textAlign: 'center', marginTop: 8, marginBottom: 28 },
    label: { color: 'rgba(255,255,255,0.5)', fontSize: 11, letterSpacing: 1.5, marginBottom: 8, marginTop: 6 },
    input: {
        backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
        borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14, color: '#FFF', fontSize: 16, marginBottom: 12,
    },
    button: { marginTop: 16, borderRadius: 16, overflow: 'hidden' },
    buttonFill: { paddingVertical: 16, alignItems: 'center' },
    buttonText: { color: '#FFF', fontSize: 16, fontWeight: '700' },
    cancel: { color: 'rgba(255,255,255,0.5)', fontSize: 14 },
});
