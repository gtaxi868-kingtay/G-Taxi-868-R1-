import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../context/AuthContext';
import { RainLogin, CrystalInput, CrystalButton } from '@gtaxi/design-system-native';

type AuthStackParamList = { Login: undefined; Signup: undefined };
type SignupNavProp = NativeStackNavigationProp<AuthStackParamList, 'Signup'>;

// Always creates a plain rider account — AuthContext.signUp sets role:
// 'rider'. The only path to admin access is an existing admin granting it
// via the "Users & Access" page on the web dashboard. This screen never
// pretends otherwise.
export function SignupScreen({ navigation }: { navigation: SignupNavProp }) {
  const { signUp } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const handleSignup = async () => {
    if (!name.trim() || !email.trim() || !password) {
      setError('Name, email, and password are required');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await signUp(email.trim(), password, name.trim());
      setDone(true);
    } catch (err: any) {
      setError(err.message || 'Could not create account');
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
        title="G-TAXI 868"
        subtitle="Create Account"
        footer={
          <TouchableOpacity onPress={() => navigation.navigate('Login')}>
            <Text style={s.link}>Already have access? Sign in</Text>
          </TouchableOpacity>
        }
      >
        {done ? (
          <View style={s.doneBox}>
            <Ionicons name="checkmark-circle" size={20} color="#8B5CF6" />
            <Text style={s.doneText}>
              Account created. You'll see "Access Denied" until an existing admin grants you
              access — that's expected, not an error.
            </Text>
            <CrystalButton title="Back to Sign In" voice="admin" onPress={() => navigation.navigate('Login')} />
          </View>
        ) : (
          <>
            <CrystalInput label="Full Name" voice="admin" placeholder="Jane Doe" value={name} onChangeText={setName} />
            <CrystalInput
              label="Email" voice="admin" placeholder="you@example.com" value={email}
              onChangeText={setEmail} keyboardType="email-address"
            />
            <CrystalInput
              label="Password" voice="admin" placeholder="••••••••" value={password}
              onChangeText={setPassword} secureTextEntry
            />

            {error ? (
              <View style={s.errorBox}>
                <Ionicons name="alert-circle" size={14} color="#FF4D4D" />
                <Text style={s.errorText}>{error}</Text>
              </View>
            ) : null}

            <CrystalButton title="Create Account" voice="admin" onPress={handleSignup} loading={loading} />
          </>
        )}
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
  doneBox: { gap: 12, alignItems: 'center' },
  doneText: { color: 'rgba(234,243,246,0.7)', fontSize: 13, textAlign: 'center', lineHeight: 19 },
  link: { color: 'rgba(234,243,246,0.4)', fontSize: 12, fontWeight: '600', textAlign: 'center', marginTop: 4 },
});
