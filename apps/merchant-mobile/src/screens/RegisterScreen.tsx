import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import Reanimated, { FadeIn } from 'react-native-reanimated';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../context/AuthContext';
import { SURFACE, VOICES, ANIMATION } from '@gtaxi/design-system';
import { ghostBorder, elevationGlow, glassSurface } from '@gtaxi/design-system/utils/style-rules';

type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
};

type RegisterNavProp = NativeStackNavigationProp<AuthStackParamList, 'Register'>;

export function RegisterScreen({ navigation }: { navigation: RegisterNavProp }) {
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
    } catch (err: unknown) {
      Alert.alert('Registration Failed', err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={s.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <LinearGradient colors={[SURFACE.base, '#1C1510']} style={StyleSheet.absoluteFillObject} />
      <Reanimated.View entering={FadeIn.springify().mass(ANIMATION.spring.mass).stiffness(ANIMATION.spring.stiffness).damping(ANIMATION.spring.damping)} style={s.content}>
        <Text style={s.title}>Create Account</Text>
        <Text style={s.subtitle}>Register your merchant business</Text>

        <BlurView intensity={60} tint="dark" style={s.cardBlur}>
          <View style={s.card}>
            <TextInput style={s.input} placeholder="Business Name" value={name} onChangeText={setName} placeholderTextColor="rgba(255,255,255,0.6)" />
            <TextInput style={s.input} placeholder="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholderTextColor="rgba(255,255,255,0.6)" />
            <TextInput style={s.input} placeholder="Password" value={password} onChangeText={setPassword} secureTextEntry placeholderTextColor="rgba(255,255,255,0.6)" />

            {loading ? (
              <ActivityIndicator size="large" color={VOICES.merchant.accent} style={{ marginTop: 16 }} />
            ) : (
              <TouchableOpacity style={s.registerBtn} onPress={handleRegister}>
                <LinearGradient colors={[VOICES.merchant.accent, VOICES.merchant.accentDark]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.registerGradient}>
                  <Text style={s.registerBtnText}>Register</Text>
                </LinearGradient>
              </TouchableOpacity>
            )}

            <TouchableOpacity style={s.loginLink} onPress={() => navigation.goBack()}>
              <Text style={s.loginText}>Already have an account? Sign In</Text>
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
  title: { fontSize: 28, fontWeight: '800', color: '#FFF', textAlign: 'center', marginBottom: 4, fontFamily: 'SpaceGrotesk' },
  subtitle: { fontSize: 14, color: 'rgba(255,255,255,0.6)', textAlign: 'center', marginBottom: 32, fontFamily: 'Manrope' },
  cardBlur: { borderRadius: 24, overflow: 'hidden', ...ghostBorder(0.15) },
  card: { padding: 24 },
  input: { backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 12, padding: 16, fontSize: 16, color: '#FFF', marginBottom: 12, ...ghostBorder(0.15), fontFamily: 'Manrope' },
  registerBtn: { borderRadius: 12, overflow: 'hidden', marginTop: 8 },
  registerGradient: { padding: 16, alignItems: 'center' },
  registerBtnText: { color: SURFACE.base, fontSize: 16, fontWeight: '700', fontFamily: 'SpaceGrotesk' },
  loginLink: { alignItems: 'center', marginTop: 20 },
  loginText: { color: VOICES.merchant.accent, fontSize: 14, fontWeight: '600', fontFamily: 'Manrope' },
});
