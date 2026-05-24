import React, { useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, TouchableOpacity,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import Reanimated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import { SURFACE, VOICES, ANIMATION } from '@gtaxi/design-system';
import { ghostBorder } from '@gtaxi/design-system/utils/style-rules';

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
    <LinearGradient colors={[SURFACE.base, '#1A0A0A']} style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.inner}
      >
        <Reanimated.View
          entering={FadeIn.springify().mass(ANIMATION.spring.mass).stiffness(ANIMATION.spring.stiffness).damping(ANIMATION.spring.damping)}
          style={[styles.content, { paddingTop: insets.top + 60 }]}
        >
          <View style={styles.iconContainer}>
            <Ionicons name="shield-checkmark" size={48} color={VOICES.admin.accent} />
          </View>
          <Text style={styles.title}>G-Taxi Command</Text>
          <Text style={styles.subtitle}>Admin Terminal</Text>

          <View style={styles.form}>
            <View style={styles.inputGroup}>
              <Ionicons name="mail-outline" size={18} color="rgba(255,255,255,0.3)" style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="Admin email"
                placeholderTextColor="rgba(255,255,255,0.25)"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                autoCorrect={false}
              />
            </View>

            <View style={styles.inputGroup}>
              <Ionicons name="lock-closed-outline" size={18} color="rgba(255,255,255,0.3)" style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="Password"
                placeholderTextColor="rgba(255,255,255,0.25)"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
              />
            </View>

            {error ? (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle" size={16} color="#FF4D4D" />
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
        </Reanimated.View>

        <Text style={styles.version}>v1.0.0 · Private APK</Text>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  inner: { flex: 1, justifyContent: 'space-between' },
  content: { flex: 1, paddingHorizontal: 24 },
  iconContainer: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: VOICES.admin.accent + '1A',
    alignItems: 'center', justifyContent: 'center',
    alignSelf: 'center', marginBottom: 20,
    ...ghostBorder(0.15),
  },
  title: { fontSize: 28, fontWeight: '800', color: '#F1F5F9', textAlign: 'center' },
  subtitle: { fontSize: 14, fontWeight: '500', color: 'rgba(255,255,255,0.35)', textAlign: 'center', marginBottom: 48, letterSpacing: 2, textTransform: 'uppercase' },
  form: { gap: 16 },
  inputGroup: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 14,
    paddingHorizontal: 16, height: 52,
  },
  inputIcon: { marginRight: 12 },
  input: { flex: 1, color: '#F1F5F9', fontSize: 16 },
  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(255,77,77,0.1)',
    borderRadius: 10, padding: 12,
    ...ghostBorder(0.15),
  },
  errorText: { color: '#FF6B6B', fontSize: 13, flex: 1 },
  loginBtn: {
    height: 52, borderRadius: 14,
    backgroundColor: VOICES.admin.accent,
    alignItems: 'center', justifyContent: 'center',
    marginTop: 8,
  },
  loginBtnDisabled: { opacity: 0.5 },
  loginBtnText: { color: '#FFF', fontSize: 16, fontWeight: '700', letterSpacing: 0.5 },
  version: { fontSize: 11, color: 'rgba(255,255,255,0.2)', textAlign: 'center', paddingBottom: 20 },
});
