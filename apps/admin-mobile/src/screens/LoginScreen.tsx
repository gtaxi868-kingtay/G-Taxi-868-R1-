import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { RainLogin, CrystalInput, CrystalButton } from '@gtaxi/design-system-native';

export function LoginScreen() {
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
    <View style={s.root}>
      <StatusBar style="light" />
      <RainLogin
        voice="admin"
        logoSource={require('../../assets/logo.png')}
        subtitle="Command Terminal"
        footer={<Text style={s.version}>v1.0.0 · Private APK</Text>}
      >
        <CrystalInput
          label="Admin Email"
          voice="admin"
          placeholder="admin@gtaxi.com"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
        />
        <CrystalInput
          label="Password"
          voice="admin"
          placeholder="••••••••"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        {error ? (
          <View style={s.errorBox}>
            <Ionicons name="alert-circle" size={14} color="#FF4D4D" />
            <Text style={s.errorText}>{error}</Text>
          </View>
        ) : null}

        <CrystalButton title="Authorize" voice="admin" onPress={handleLogin} loading={loading} />
      </RainLogin>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
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
  version: { fontSize: 10, color: 'rgba(234,243,246,0.25)', letterSpacing: 1 },
});
