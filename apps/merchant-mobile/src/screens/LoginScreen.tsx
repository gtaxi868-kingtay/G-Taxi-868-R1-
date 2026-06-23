import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import Reanimated, { FadeIn } from 'react-native-reanimated';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../context/AuthContext';
import { SURFACE, VOICES, ANIMATION } from '@gtaxi/design-system';
import { ghostBorder, elevationGlow, glassSurface } from '@gtaxi/design-system/utils/style-rules';

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
    <KeyboardAvoidingView style={s.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <LinearGradient colors={[SURFACE.base, '#1C1510']} style={StyleSheet.absoluteFillObject} />
      <Reanimated.View entering={FadeIn.springify().mass(ANIMATION.spring.mass).stiffness(ANIMATION.spring.stiffness).damping(ANIMATION.spring.damping)} style={s.content}>
        <View style={s.logoArea}>
          <View style={s.logoCircle}>
            <Ionicons name="storefront" size={40} color={VOICES.merchant.accent} />
          </View>
          <Text style={s.title}>G-Taxi Merchant</Text>
          <Text style={s.subtitle}>Partner Portal</Text>
        </View>

        <BlurView intensity={60} tint="dark" style={[s.cardBlur, glassSurface(60, 0.2)]}>
          <View style={s.card}>
            <TextInput style={s.input} placeholder="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholderTextColor="rgba(255,255,255,0.6)" />
            <TextInput style={s.input} placeholder="Password" value={password} onChangeText={setPassword} secureTextEntry placeholderTextColor="rgba(255,255,255,0.6)" />

            {loading ? (
              <ActivityIndicator size="large" color={VOICES.merchant.accent} style={{ marginTop: 16 }} />
            ) : (
              <TouchableOpacity style={s.loginBtn} onPress={handleLogin}>
                <LinearGradient colors={[VOICES.merchant.accent, VOICES.merchant.accentDark]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.loginGradient}>
                  <Text style={s.loginBtnText}>Sign In</Text>
                </LinearGradient>
              </TouchableOpacity>
            )}

            <TouchableOpacity style={s.registerLink} onPress={() => navigation.navigate('Register')}>
              <Text style={s.registerText}>Don't have an account? Register</Text>
            </TouchableOpacity>

            <TouchableOpacity style={s.registerLink} onPress={() => navigation.navigate('JoinWithCode')}>
              <Text style={s.registerText}>Have a G-Lead code? Join here</Text>
            </TouchableOpacity>
          </View>
        </BlurView>
      </Reanimated.View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  content: { flex: 1, justifyContent: 'center', padding: 24 },
  logoArea: { alignItems: 'center', marginBottom: 40 },
  logoCircle: { width: 80, height: 80, borderRadius: 40, backgroundColor: VOICES.merchant.accent + '26', justifyContent: 'center', alignItems: 'center', marginBottom: 16, ...ghostBorder(0.15) },
  title: { fontSize: 28, fontWeight: '800', color: '#FFF', fontFamily: 'SpaceGrotesk' },
  subtitle: { fontSize: 14, color: 'rgba(255,255,255,0.6)', marginTop: 4, fontFamily: 'Manrope' },
  cardBlur: { borderRadius: 24, overflow: 'hidden', ...ghostBorder(0.15) },
  card: { padding: 24 },
  input: { backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 12, padding: 16, fontSize: 16, color: '#FFF', marginBottom: 12, ...ghostBorder(0.15), fontFamily: 'Manrope' },
  loginBtn: { borderRadius: 12, overflow: 'hidden', marginTop: 8 },
  loginGradient: { padding: 16, alignItems: 'center' },
  loginBtnText: { color: SURFACE.base, fontSize: 16, fontWeight: '700', fontFamily: 'SpaceGrotesk' },
  registerLink: { alignItems: 'center', marginTop: 20 },
  registerText: { color: VOICES.merchant.accent, fontSize: 14, fontWeight: '600', fontFamily: 'Manrope' },
});
