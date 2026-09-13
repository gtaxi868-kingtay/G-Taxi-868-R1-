import React, { useState, useRef } from 'react';
import {
  View, StyleSheet, TextInput, TouchableOpacity,
  ActivityIndicator, Alert, ScrollView, KeyboardAvoidingView, Platform, Text,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@gtaxi/core';
import { SURFACE, VOICES } from '@gtaxi/design-system';
import { elevationGlow, ghostBorder } from '@gtaxi/design-system/utils/style-rules';
import { LinearGradient } from 'expo-linear-gradient';

const CYAN = '#1DE0E6';
const CARDS = ['input', 'confirm', 'success', 'error'] as const;
type Card = typeof CARDS[number];

export function RedeemCashCodeScreen({ navigation }: { navigation: { goBack: () => void } }) {
  const insets = useSafeAreaInsets();
  const codeRef = useRef<TextInput>(null);

  const [card, setCard] = useState<Card>('input');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [amountCents, setAmountCents] = useState(0);
  const [errorText, setErrorText] = useState('');

  const cleanCode = code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);

  const handleLookup = async () => {
    if (cleanCode.length < 6) { Alert.alert('Invalid', 'Enter a 6-character code'); return; }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setBusy(true);
    try {
      const { data: r, error } = await supabase
        .from('cash_withdrawal_codes')
        .select('amount_cents, status, expires_at')
        .eq('code', cleanCode)
        .maybeSingle();
      if (error || !r) { setErrorText('Code not found'); setCard('error'); return; }
      if (r.status !== 'active') { setErrorText('Code is ' + r.status); setCard('error'); return; }
      if (new Date(r.expires_at) < new Date()) { setErrorText('Code has expired'); setCard('error'); return; }
      setAmountCents(r.amount_cents);
      setCard('confirm');
    } catch { setErrorText('Lookup failed'); setCard('error'); }
    finally { setBusy(false); }
  };

  const handleRedeem = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');
      const { data, error } = await supabase.functions.invoke('redeem_cash_code', {
        body: { code: cleanCode },
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (error || !data?.success) throw new Error(data?.error || error?.message || 'Redemption failed');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setCard('success');
    } catch (err: any) { setErrorText(err.message || 'Redemption failed'); setCard('error'); }
    finally { setBusy(false); }
  };

  const handleReset = () => { setCode(''); setCard('input'); setErrorText(''); codeRef.current?.focus(); };

  return (
    <View style={s.root}>
      <View style={[s.header, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={24} color="#EAF3F6" />
        </TouchableOpacity>
        <Text style={{ fontSize: 20, fontWeight: '700', color: '#EAF3F6', marginLeft: 16 }}>
          {card === 'success' ? 'Code Redeemed!' : 'Redeem Cash Code'}
        </Text>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: insets.bottom + 40 }}>

          {card === 'success' ? (
            <>
              <LinearGradient colors={['#10B981', '#059669']} style={s.heroBox}>
                <View style={s.iconCircle}><Ionicons name="checkmark-circle" size={64} color="#EAF3F6" /></View>
                <Text style={{ fontSize: 24, fontWeight: '700', color: '#EAF3F6', marginTop: 12 }}>
                  TTD ${(amountCents / 100).toFixed(2)}
                </Text>
                <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)', marginTop: 4 }}>Credited to your wallet</Text>
              </LinearGradient>
              <View style={s.infoCard}>
                <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', textAlign: 'center', lineHeight: 20 }}>
                  The rider has been notified. Hand over TTD ${(amountCents / 100).toFixed(2)} in cash.
                </Text>
              </View>
              <TouchableOpacity style={s.btn} onPress={handleReset} activeOpacity={0.85}>
                <LinearGradient colors={[CYAN, VOICES.driver.accent]} style={StyleSheet.absoluteFillObject} />
                <Text style={{ fontSize: 14, fontWeight: '700', color: '#0B0E12' }}>Redeem Another Code</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.btn, { backgroundColor: 'transparent', marginTop: 8 }]} onPress={() => navigation.goBack()} activeOpacity={0.7}>
                <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)' }}>Back to Wallet</Text>
              </TouchableOpacity>
            </>
          ) : card === 'error' ? (
            <>
              <LinearGradient colors={['#EF4444', '#991B1B']} style={s.heroBox}>
                <Ionicons name="close-circle" size={64} color="#EAF3F6" />
                <Text style={{ fontSize: 18, fontWeight: '700', color: '#EAF3F6', marginTop: 12, textAlign: 'center' }}>{errorText}</Text>
              </LinearGradient>
              <TouchableOpacity style={s.btn} onPress={handleReset} activeOpacity={0.85}>
                <LinearGradient colors={[CYAN, VOICES.driver.accent]} style={StyleSheet.absoluteFillObject} />
                <Text style={{ fontSize: 14, fontWeight: '700', color: '#0B0E12' }}>Try Again</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <View style={s.heroBox}>
                <Ionicons name="cash-outline" size={48} color={CYAN} />
                <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', marginTop: 12, textAlign: 'center' }}>
                  Enter the 6-character code from your rider
                </Text>
              </View>

              <View style={s.inputCard}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: '#EAF3F6', marginBottom: 12, textAlign: 'center' }}>Cash Code</Text>
                <TextInput
                  ref={codeRef}
                  style={s.codeInput}
                  value={code}
                  onChangeText={(t) => setCode(t.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
                  keyboardType="default"
                  autoCapitalize="characters"
                  placeholder="X7K9M2"
                  placeholderTextColor="rgba(255,255,255,0.2)"
                  maxLength={6}
                  autoFocus
                />
                <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', textAlign: 'center', marginTop: 8 }}>
                  6 characters, numbers and letters
                </Text>
                <TouchableOpacity
                  style={[s.btn, (cleanCode.length < 6 || busy) && { opacity: 0.5 }]}
                  onPress={handleLookup}
                  disabled={cleanCode.length < 6 || busy}
                  activeOpacity={0.85}
                >
                  <LinearGradient colors={[CYAN, VOICES.driver.accent]} style={StyleSheet.absoluteFillObject} />
                  {busy ? <ActivityIndicator color="#EAF3F6" /> : <Text style={{ fontSize: 14, fontWeight: '700', color: '#0B0E12' }}>Look Up Code</Text>}
                </TouchableOpacity>
              </View>

              {card === 'confirm' && (
                <View style={s.inputCard}>
                  <Text style={{ fontSize: 15, fontWeight: '700', color: '#EAF3F6', marginBottom: 16, textAlign: 'center' }}>Confirm Redemption</Text>
                  <View style={s.row}><Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>Code</Text><Text style={{ fontSize: 14, fontWeight: '700', color: '#EAF3F6' }}>{cleanCode}</Text></View>
                  <View style={s.row}><Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>Amount</Text><Text style={{ fontSize: 24, fontWeight: '700', color: '#10B981' }}>TTD ${(amountCents / 100).toFixed(2)}</Text></View>
                  <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', textAlign: 'center', marginVertical: 12 }}>
                    Credited to your wallet. Give the rider TTD ${(amountCents / 100).toFixed(2)} in cash.
                  </Text>
                  <View style={s.btnRow}>
                    <TouchableOpacity style={[s.btn, { flex: 1, backgroundColor: 'transparent' }]} onPress={handleReset}><Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)' }}>Cancel</Text></TouchableOpacity>
                    <TouchableOpacity style={[s.btn, { flex: 1 }]} onPress={handleRedeem} disabled={busy} activeOpacity={0.85}>
                      <LinearGradient colors={[CYAN, VOICES.driver.accent]} style={StyleSheet.absoluteFillObject} />
                      {busy ? <ActivityIndicator color="#EAF3F6" /> : <Text style={{ fontSize: 14, fontWeight: '700', color: '#0B0E12' }}>Confirm & Credit</Text>}
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: SURFACE.base },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, marginBottom: 20 },
  backBtn: { width: 44, height: 44, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' },
  heroBox: { borderRadius: 32, padding: 32, alignItems: 'center', marginBottom: 24, backgroundColor: 'rgba(255,255,255,0.03)', ...ghostBorder(0.15) },
  inputCard: { backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 24, padding: 20, marginBottom: 16, ...ghostBorder(0.15) },
  codeInput: { fontSize: 36, fontWeight: '900', color: '#EAF3F6', textAlign: 'center', letterSpacing: 12, paddingVertical: 16, fontFamily: 'CormorantGaramond_600SemiBold' },
  btn: { height: 56, borderRadius: 20, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', marginTop: 12, ...elevationGlow() },
  btnRow: { flexDirection: 'row', gap: 12, marginTop: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8 },
  iconCircle: { width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  infoCard: { marginTop: 24, padding: 20, backgroundColor: 'rgba(255,255,255,0.02)', borderRadius: 20 },
});
