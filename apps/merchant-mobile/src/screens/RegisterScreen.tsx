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
  glassBorder: 'rgba(255,255,255,0.08)',
};

export function RegisterScreen({ navigation }: any) {
  const { signUp } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleRegister = async () => {
    if (!name.trim() || !email.trim() || !password) {
      Alert.alert('Required', 'Please fill in all fields.');
      return;
    }
    if (password.length < 6) {
      Alert.alert('Weak Password', 'Password must be at least 6 characters.');
      return;
    }
    setLoading(true);
    try {
      await signUp(email.trim(), password, name.trim());
      Alert.alert('Check Email', 'Please check your email for a confirmation link.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (err: any) {
      Alert.alert('Registration Failed', err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={s.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <LinearGradient colors={['#0A0A0F', '#1C1510']} style={StyleSheet.absoluteFillObject} />
      <View style={s.content}>
        <Text style={s.title}>Create Account</Text>
        <Text style={s.subtitle}>Register your merchant business</Text>

        <BlurView intensity={60} tint="dark" style={s.cardBlur}>
          <View style={s.card}>
            <TextInput style={s.input} placeholder="Business Name" value={name} onChangeText={setName} placeholderTextColor={COLORS.textMuted} />
            <TextInput style={s.input} placeholder="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholderTextColor={COLORS.textMuted} />
            <TextInput style={s.input} placeholder="Password" value={password} onChangeText={setPassword} secureTextEntry placeholderTextColor={COLORS.textMuted} />

            {loading ? (
              <ActivityIndicator size="large" color={COLORS.gold} style={{ marginTop: 16 }} />
            ) : (
              <TouchableOpacity style={s.registerBtn} onPress={handleRegister}>
                <LinearGradient colors={[COLORS.gold, COLORS.goldDark]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.registerGradient}>
                  <Text style={s.registerBtnText}>Register</Text>
                </LinearGradient>
              </TouchableOpacity>
            )}

            <TouchableOpacity style={s.loginLink} onPress={() => navigation.goBack()}>
              <Text style={s.loginText}>Already have an account? Sign In</Text>
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
  title: { fontSize: 28, fontWeight: '800', color: COLORS.text, textAlign: 'center', marginBottom: 4, fontFamily: 'SpaceGrotesk' },
  subtitle: { fontSize: 14, color: COLORS.textMuted, textAlign: 'center', marginBottom: 32, fontFamily: 'Manrope' },
  cardBlur: { borderRadius: 24, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.glassBorder },
  card: { padding: 24 },
  input: { backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 12, padding: 16, fontSize: 16, color: COLORS.text, marginBottom: 12, borderWidth: 1, borderColor: COLORS.border, fontFamily: 'Manrope' },
  registerBtn: { borderRadius: 12, overflow: 'hidden', marginTop: 8 },
  registerGradient: { padding: 16, alignItems: 'center' },
  registerBtnText: { color: '#0A0A0F', fontSize: 16, fontWeight: '700', fontFamily: 'SpaceGrotesk' },
  loginLink: { alignItems: 'center', marginTop: 20 },
  loginText: { color: COLORS.gold, fontSize: 14, fontWeight: '600', fontFamily: 'Manrope' },
});
