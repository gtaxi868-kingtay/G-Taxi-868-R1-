import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, Linking } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import Reanimated, { FadeIn } from 'react-native-reanimated';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { initializeSupabaseClient } from '@gtaxi/core';
import { SURFACE, VOICES, ANIMATION } from '@gtaxi/design-system';
import { ghostBorder } from '@gtaxi/design-system/utils/style-rules';

const { supabase } = initializeSupabaseClient('native');

const LEGAL_BASE = 'https://ffbbuafgeypvkpcuvdnv.supabase.co/storage/v1/object/public/web/legal';

type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
  JoinWithCode: undefined;
};

type JoinNavProp = NativeStackNavigationProp<AuthStackParamList, 'JoinWithCode'>;

// Commander-recruited merchant onboarding. merchant_register_with_code is a
// public edge function that creates the account + merchant record (pending)
// linked to the commander's territory. The commander activates them from the
// Command Center, then the merchant signs in.
export function JoinWithCodeScreen({ navigation }: { navigation: JoinNavProp }) {
  const [businessName, setBusinessName] = useState('');
  const [contactName, setContactName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [commanderCode, setCommanderCode] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleJoin = async () => {
    if (!businessName.trim() || !email.trim() || !password || !commanderCode.trim()) {
      Alert.alert('Required', 'Business name, email, password and G-Lead code are required.');
      return;
    }
    if (password.length < 6) {
      Alert.alert('Weak Password', 'Password must be at least 6 characters.');
      return;
    }
    if (!acceptedTerms) {
      Alert.alert('Terms Required', 'You must accept the Merchant Terms, Terms of Service, and Privacy Policy to continue.');
      return;
    }
    setLoading(true);
    try {
      // merchant_register_with_code rejects any request without accepted_terms.
      const { data, error } = await supabase.functions.invoke('merchant_register_with_code', {
        body: {
          business_name: businessName.trim(),
          email: email.trim().toLowerCase(),
          password,
          commander_code: commanderCode.trim().toUpperCase(),
          name: contactName.trim() || businessName.trim(),
          accepted_terms: acceptedTerms,
        },
      });
      if (error || !data?.success) {
        throw new Error(data?.error || error?.message || 'Could not register with that code');
      }
      Alert.alert(
        'Business Registered',
        'Your business has joined the territory. Your G-Lead will activate you shortly — then sign in to get started.',
        [{ text: 'OK', onPress: () => navigation.navigate('Login') }]
      );
    } catch (err: unknown) {
      Alert.alert('Registration Failed', err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={s.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <LinearGradient colors={[SURFACE.base, '#1C1510']} style={StyleSheet.absoluteFillObject} />
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <Reanimated.View entering={FadeIn.springify().mass(ANIMATION.spring.mass).stiffness(ANIMATION.spring.stiffness).damping(ANIMATION.spring.damping)} style={s.content}>
          <View style={s.badge}>
            <Ionicons name="shield-checkmark" size={18} color={VOICES.merchant.accent} />
            <Text style={s.badgeText}>G-PARTNER</Text>
          </View>
          <Text style={s.title}>Join with a Code</Text>
          <Text style={s.subtitle}>Register your business under your local G-Lead</Text>

          <BlurView intensity={60} tint="dark" style={s.cardBlur}>
            <View style={s.card}>
              <TextInput style={s.input} placeholder="G-Lead Code" value={commanderCode} onChangeText={setCommanderCode} autoCapitalize="characters" placeholderTextColor="rgba(255,255,255,0.6)" />
              <TextInput style={s.input} placeholder="Business Name" value={businessName} onChangeText={setBusinessName} placeholderTextColor="rgba(255,255,255,0.6)" />
              <TextInput style={s.input} placeholder="Contact Name (optional)" value={contactName} onChangeText={setContactName} placeholderTextColor="rgba(255,255,255,0.6)" />
              <TextInput style={s.input} placeholder="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholderTextColor="rgba(255,255,255,0.6)" />
              <TextInput style={s.input} placeholder="Password" value={password} onChangeText={setPassword} secureTextEntry placeholderTextColor="rgba(255,255,255,0.6)" />

              <TouchableOpacity style={s.termsRow} onPress={() => setAcceptedTerms(!acceptedTerms)}>
                <View style={[s.checkbox, acceptedTerms && { backgroundColor: VOICES.merchant.accent, borderColor: VOICES.merchant.accent }]}>
                  {acceptedTerms && <Ionicons name="checkmark" size={14} color={SURFACE.base} />}
                </View>
                <Text style={s.termsText}>
                  I accept the{' '}
                  <Text style={s.termsLink} onPress={() => Linking.openURL(`${LEGAL_BASE}/merchant_terms.html`)}>Merchant Terms</Text>
                  {', '}
                  <Text style={s.termsLink} onPress={() => Linking.openURL(`${LEGAL_BASE}/terms_of_service.html`)}>Terms of Service</Text>
                  {', and '}
                  <Text style={s.termsLink} onPress={() => Linking.openURL(`${LEGAL_BASE}/privacy_policy.html`)}>Privacy Policy</Text>
                </Text>
              </TouchableOpacity>

              {loading ? (
                <ActivityIndicator size="large" color={VOICES.merchant.accent} style={{ marginTop: 16 }} />
              ) : (
                <TouchableOpacity style={s.registerBtn} onPress={handleJoin} disabled={!acceptedTerms}>
                  <LinearGradient colors={[VOICES.merchant.accent, VOICES.merchant.accentDark]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[s.registerGradient, !acceptedTerms && { opacity: 0.5 }]}>
                    <Text style={s.registerBtnText}>Join Territory</Text>
                  </LinearGradient>
                </TouchableOpacity>
              )}

              <TouchableOpacity style={s.loginLink} onPress={() => navigation.navigate('Login')}>
                <Text style={s.loginText}>Already have an account? Sign In</Text>
              </TouchableOpacity>
            </View>
          </BlurView>
        </Reanimated.View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center' },
  content: { padding: 24 },
  badge: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 12 },
  badgeText: { fontSize: 11, fontWeight: '700', letterSpacing: 2, color: VOICES.merchant.accent, fontFamily: 'Manrope' },
  title: { fontSize: 28, fontWeight: '800', color: '#E9F5F3', textAlign: 'center', marginBottom: 4, fontFamily: 'SpaceGrotesk' },
  subtitle: { fontSize: 14, color: 'rgba(255,255,255,0.6)', textAlign: 'center', marginBottom: 32, fontFamily: 'Manrope' },
  cardBlur: { borderRadius: 24, overflow: 'hidden', ...ghostBorder(0.15) },
  card: { padding: 24 },
  input: { backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 12, padding: 16, fontSize: 16, color: '#E9F5F3', marginBottom: 12, ...ghostBorder(0.15), fontFamily: 'Manrope' },
  termsRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 4, marginBottom: 4 },
  checkbox: { width: 20, height: 20, borderRadius: 6, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', alignItems: 'center', justifyContent: 'center', marginRight: 10, marginTop: 1 },
  termsText: { flex: 1, fontSize: 12, lineHeight: 18, color: 'rgba(255,255,255,0.6)', fontFamily: 'Manrope' },
  termsLink: { color: VOICES.merchant.accent, fontWeight: '600' },
  registerBtn: { borderRadius: 12, overflow: 'hidden', marginTop: 8 },
  registerGradient: { padding: 16, alignItems: 'center' },
  registerBtnText: { color: SURFACE.base, fontSize: 16, fontWeight: '700', fontFamily: 'SpaceGrotesk' },
  loginLink: { alignItems: 'center', marginTop: 20 },
  loginText: { color: VOICES.merchant.accent, fontSize: 14, fontWeight: '600', fontFamily: 'Manrope' },
});
