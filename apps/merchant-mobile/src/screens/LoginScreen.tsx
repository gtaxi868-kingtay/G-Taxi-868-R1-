import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../context/AuthContext';
import { VOICES } from '@gtaxi/design-system';
import { RainLogin, CrystalInput, CrystalButton, ForgotPasswordFlow } from '@gtaxi/design-system-native';
import { initializeSupabaseClient } from '@gtaxi/core';
import { requestPasswordReset, completePasswordReset, friendlySignInError, normaliseEmail } from '@g868/shared/passwordReset';

const { supabase } = initializeSupabaseClient('native');

type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
  JoinWithCode: undefined;
};

type LoginNavProp = NativeStackNavigationProp<AuthStackParamList, 'Login'>;

export function LoginScreen({ navigation }: { navigation: LoginNavProp }) {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showForgot, setShowForgot] = useState(false);

  const handleLogin = async () => {
    if (!email.trim() || !password) {
      Alert.alert('Required', 'Please enter email and password.');
      return;
    }
    setLoading(true);
    try {
      // Trim + lowercase: a keyboard-suggested email arrives with a trailing
      // space, which the server rejects as wrong credentials.
      await signIn(normaliseEmail(email), password);
    } catch (err: unknown) {
      const f = friendlySignInError(err instanceof Error ? err.message : '');
      Alert.alert(f.title, f.body, f.offerReset
        ? [{ text: 'Try again', style: 'cancel' }, { text: 'Reset password', onPress: () => setShowForgot(true) }]
        : [{ text: 'OK' }]);
    } finally {
      setLoading(false);
    }
  };

  if (showForgot) {
    return (
      <ForgotPasswordFlow
        voice="merchant"
        logoSource={require('../../assets/logo.png')}
        initialEmail={email}
        onBack={() => setShowForgot(false)}
        onRequestCode={(e: string) => requestPasswordReset(supabase as any, e)}
        onSetPassword={(e: string, c: string, p: string, p2: string) => completePasswordReset(supabase as any, e, c, p, p2)}
      />
    );
  }

  return (
    <View style={s.root}>
      <StatusBar style="light" />
      <RainLogin
        voice="merchant"
        logoSource={require('../../assets/logo.png')}
        subtitle="Partner Portal"
        footer={
          <>
            <TouchableOpacity style={s.link} onPress={() => navigation.navigate('Register')}>
              <Text style={s.linkText}>
                Don't have an account? <Text style={s.linkAccent}>Register</Text>
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.link} onPress={() => navigation.navigate('JoinWithCode')}>
              <Text style={s.linkText}>
                Have a G-Lead code? <Text style={s.linkAccent}>Join here</Text>
              </Text>
            </TouchableOpacity>
          </>
        }
      >
        <CrystalInput
          label="Email"
          voice="merchant"
          placeholder="you@business.com"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
        />
        <CrystalInput
          label="Password"
          voice="merchant"
          placeholder="••••••••"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />
        <CrystalButton title="Sign In" voice="merchant" onPress={handleLogin} loading={loading} />
        <TouchableOpacity style={s.forgot} onPress={() => setShowForgot(true)} accessibilityRole="button" accessibilityLabel="Forgot password">
          <Text style={s.linkAccent}>Forgot password?</Text>
        </TouchableOpacity>
      </RainLogin>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  link: { paddingVertical: 8 },
  forgot: { alignSelf: 'center', paddingVertical: 12, paddingHorizontal: 16 },
  linkText: { color: 'rgba(234,243,246,0.55)', fontSize: 14, fontWeight: '500' },
  linkAccent: { color: VOICES.merchant.accent, fontWeight: '700' },
});
