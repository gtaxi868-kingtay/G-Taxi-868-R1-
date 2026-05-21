import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';

const COLORS = {
  bg: '#0A0A0F',
  surface: 'rgba(255,255,255,0.06)',
  gold: '#F59E0B',
  goldDark: '#B45309',
  text: '#FFFFFF',
  textMuted: 'rgba(255,255,255,0.5)',
  border: 'rgba(245,158,11,0.2)',
  error: '#EF4444',
  glassBorder: 'rgba(255,255,255,0.08)',
};

export function LoginScreen({ navigation }: any) {
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
    } catch (err: any) {
      Alert.alert('Login Failed', err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={s.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <LinearGradient colors={['#0A0A0F', '#1C1510']} style={StyleSheet.absoluteFillObject} />
      <View style={s.content}>
        <View style={s.logoArea}>
          <View style={s.logoCircle}>
            <Ionicons name="storefront" size={40} color={COLORS.gold} />
          </View>
          <Text style={s.title}>G-Taxi Merchant</Text>
          <Text style={s.subtitle}>Partner Portal</Text>
        </View>

        <BlurView intensity={60} tint="dark" style={s.cardBlur}>
          <View style={s.card}>
            <TextInput style={s.input} placeholder="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholderTextColor={COLORS.textMuted} />
            <TextInput style={s.input} placeholder="Password" value={password} onChangeText={setPassword} secureTextEntry placeholderTextColor={COLORS.textMuted} />

            {loading ? (
              <ActivityIndicator size="large" color={COLORS.gold} style={{ marginTop: 16 }} />
            ) : (
              <TouchableOpacity style={s.loginBtn} onPress={handleLogin}>
                <LinearGradient colors={[COLORS.gold, COLORS.goldDark]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.loginGradient}>
                  <Text style={s.loginBtnText}>Sign In</Text>
                </LinearGradient>
              </TouchableOpacity>
            )}

            <TouchableOpacity style={s.registerLink} onPress={() => navigation.navigate('Register')}>
              <Text style={s.registerText}>Don't have an account? Register</Text>
            </TouchableOpacity>
          </View>
        </BlurView>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  content: { flex: 1, justifyContent: 'center', padding: 24 },
  logoArea: { alignItems: 'center', marginBottom: 40 },
  logoCircle: { width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(245,158,11,0.15)', justifyContent: 'center', alignItems: 'center', marginBottom: 16, borderWidth: 1, borderColor: 'rgba(245,158,11,0.3)' },
  title: { fontSize: 28, fontWeight: '800', color: COLORS.text, fontFamily: 'SpaceGrotesk' },
  subtitle: { fontSize: 14, color: COLORS.textMuted, marginTop: 4, fontFamily: 'Manrope' },
  cardBlur: { borderRadius: 24, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.glassBorder },
  card: { padding: 24 },
  input: { backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 12, padding: 16, fontSize: 16, color: COLORS.text, marginBottom: 12, borderWidth: 1, borderColor: COLORS.border, fontFamily: 'Manrope' },
  loginBtn: { borderRadius: 12, overflow: 'hidden', marginTop: 8 },
  loginGradient: { padding: 16, alignItems: 'center' },
  loginBtnText: { color: '#0A0A0F', fontSize: 16, fontWeight: '700', fontFamily: 'SpaceGrotesk' },
  registerLink: { alignItems: 'center', marginTop: 20 },
  registerText: { color: COLORS.gold, fontSize: 14, fontWeight: '600', fontFamily: 'Manrope' },
});
