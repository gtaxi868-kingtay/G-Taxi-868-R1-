import React, { useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, TouchableOpacity,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import { VOICES } from '@gtaxi/design-system';

const ACCENT = VOICES.admin.accent;
const BG = VOICES.admin.bg;

export function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async () => {
    if (!email.trim() || !password) {
      setError('Email and password are required');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await signIn(email.trim(), password);
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <LinearGradient colors={[BG, '#0B1120']} style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.inner}
      >
        <View style={[styles.content, { paddingTop: insets.top + 60 }]}>
          <View style={styles.iconContainer}>
            <Ionicons name="shield-checkmark" size={44} color={ACCENT} />
          </View>
          <Text style={styles.title}>G-Taxi Command</Text>
          <Text style={styles.subtitle}>Admin Terminal</Text>

          <View style={styles.form}>
            <View style={styles.inputGroup}>
              <Ionicons name="mail-outline" size={16} color="rgba(255,255,255,0.25)" style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="Admin email"
                placeholderTextColor="rgba(255,255,255,0.2)"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                autoCorrect={false}
              />
            </View>

            <View style={styles.inputGroup}>
              <Ionicons name="lock-closed-outline" size={16} color="rgba(255,255,255,0.25)" style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="Password"
                placeholderTextColor="rgba(255,255,255,0.2)"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
              />
            </View>

            {error ? (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle" size={14} color="#FF4D4D" />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            <TouchableOpacity
              style={[styles.loginBtn, loading && styles.loginBtnDisabled]}
              onPress={handleLogin}
              disabled={loading}
              activeOpacity={0.85}
            >
              {loading ? (
                <ActivityIndicator color="#FFF" size="small" />
              ) : (
                <Text style={styles.loginBtnText}>Authorize</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>

        <Text style={styles.version}>v1.0.0 · Private APK</Text>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  inner: { flex: 1, justifyContent: 'space-between' },
  content: { flex: 1, paddingHorizontal: 24, justifyContent: 'center' },
  iconContainer: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: `${ACCENT}15`,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 18,
    borderWidth: 1,
    borderColor: `${ACCENT}30`,
  },
  title: { fontSize: 26, fontWeight: '800', color: '#F1F5F9', textAlign: 'center' },
  subtitle: { fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.3)', textAlign: 'center', marginBottom: 40, letterSpacing: 2.5, textTransform: 'uppercase' },
  form: { gap: 12 },
  inputGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 48,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  inputIcon: { marginRight: 10 },
  input: { flex: 1, color: '#F1F5F9', fontSize: 15 },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,77,77,0.08)',
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,77,77,0.15)',
  },
  errorText: { color: '#FF6B6B', fontSize: 12, flex: 1 },
  loginBtn: {
    height: 48,
    borderRadius: 12,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  loginBtnDisabled: { opacity: 0.5 },
  loginBtnText: { color: '#FFF', fontSize: 15, fontWeight: '700', letterSpacing: 0.5 },
  version: { fontSize: 10, color: 'rgba(255,255,255,0.2)', textAlign: 'center', paddingBottom: 20 },
});
