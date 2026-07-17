import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../context/AuthContext';
import { VOICES } from '@gtaxi/design-system';
import { RainLogin, CrystalInput, CrystalButton } from '@gtaxi/design-system-native';

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

  const handleLogin = async () => {
    if (!email.trim() || !password) {
      Alert.alert('Required', 'Please enter email and password.');
      return;
    }
    setLoading(true);
    try {
      await signIn(email.trim(), password);
    } catch (err: unknown) {
      Alert.alert('Login Failed', err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

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
      </RainLogin>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  link: { paddingVertical: 8 },
  linkText: { color: 'rgba(234,243,246,0.55)', fontSize: 14, fontWeight: '500' },
  linkAccent: { color: VOICES.merchant.accent, fontWeight: '700' },
});
