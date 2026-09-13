import React, { useState, useEffect, useRef } from 'react';
import {
  View, StyleSheet, TextInput, TouchableOpacity,
  ActivityIndicator, Alert, ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@gtaxi/core';
import { SURFACE, VOICES } from '@gtaxi/design-system';
import { Txt } from '@/design-system/primitives';
import { elevationGlow, ghostBorder } from '@gtaxi/design-system/utils/style-rules';
import { LinearGradient } from 'expo-linear-gradient';

const CYAN = '#1DE0E6';
const MIN_CENTS = 5000;
const MAX_CENTS = 200000;

export function CashWithdrawalScreen({ navigation }: { navigation: { goBack: () => void } }) {
  const insets = useSafeAreaInsets();

  const [step, setStep] = useState<'driver' | 'amount' | 'confirm' | 'code'>('driver');
  const [phone, setPhone] = useState('');
  const [driver, setDriver] = useState<any>(null);
  const [searching, setSearching] = useState(false);
  const [amount, setAmount] = useState('');
  const [balance, setBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [generatedCode, setGeneratedCode] = useState('');
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [timeLeft, setTimeLeft] = useState('');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetchBalance();
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!expiresAt) return;
    timerRef.current = setInterval(() => {
      const diff = expiresAt.getTime() - Date.now();
      if (diff <= 0) {
        setTimeLeft('Expired');
        if (timerRef.current) clearInterval(timerRef.current);
        return;
      }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setTimeLeft(`${h}h ${m}m ${s}s`);
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [expiresAt]);

  const fetchBalance = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: balanceCents } = await supabase.rpc('get_wallet_balance', { p_user_id: user.id });
      setBalance((balanceCents || 0) / 100);
    } catch { } finally {
      setLoading(false);
    }
  };

  const handleSearchDriver = async () => {
    const digits = phone.replace(/[^\d]/g, '');
    if (digits.length < 7) {
      Alert.alert('Invalid Phone', 'Enter a valid T&T phone number');
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSearching(true);

    try {
      const { data: profiles, error } = await supabase
        .from('profiles')
        .select('id, full_name, phone')
        .eq('phone', digits)
        .limit(1);

      if (error || !profiles || profiles.length === 0) {
        Alert.alert('Not Found', 'No driver found with that phone number');
        return;
      }

      const profileId = profiles[0].id;
      const { data: drv } = await supabase
        .from('drivers')
        .select('id, status')
        .eq('user_id', profileId)
        .maybeSingle();

      if (!drv || drv.status !== 'active') {
        Alert.alert('Unavailable', 'This driver is not currently active');
        return;
      }

      setDriver({ ...drv, full_name: profiles[0].full_name, phone: digits });
      setStep('amount');
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Search failed');
    } finally {
      setSearching(false);
    }
  };

  const handleGenerateCode = async () => {
    const amountNum = parseFloat(amount);
    const amountCents = Math.round(amountNum * 100);

    if (isNaN(amountNum) || amountCents < MIN_CENTS) {
      Alert.alert('Minimum', 'Minimum withdrawal is TTD $50.00');
      return;
    }
    if (amountCents > MAX_CENTS) {
      Alert.alert('Maximum', 'Maximum withdrawal is TTD $2,000.00 per code');
      return;
    }
    if (amountCents > balance * 100) {
      Alert.alert('Insufficient Balance', `You have TTD $${balance.toFixed(2)} but need TTD $${amountNum.toFixed(2)} + $2.00 fee`);
      return;
    }

    setStep('confirm');
  };

  const handleSubmitCode = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSubmitting(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const amountCents = Math.round(parseFloat(amount) * 100);

      const { data, error } = await supabase.functions.invoke('generate_cash_code', {
        body: { driver_id: driver.id, amount_cents: amountCents },
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (error || !data?.success) {
        throw new Error(data?.error || error?.message || 'Failed to generate code');
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setGeneratedCode(data.data.code);
      setExpiresAt(new Date(data.data.expires_at));
      setStep('code');
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <View style={[s.root, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={CYAN} size="large" />
      </View>
    );
  }

  return (
    <View style={s.root}>
      <View style={[s.header, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={24} color="#EAF3F6" />
        </TouchableOpacity>
        <Txt variant="headingM" weight="heavy" color="#EAF3F6" style={{ marginLeft: 16 }}>
          {step === 'code' ? 'Your Code' : 'Cash Withdrawal'}
        </Txt>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: insets.bottom + 40 }}>

          {step === 'code' ? (
            <>
              <LinearGradient colors={[CYAN, '#a88be0']} style={s.codeHero}>
                <Txt variant="caption" weight="heavy" color="rgba(255,255,255,0.7)">Give this code to your driver</Txt>
                <Txt style={s.codeDisplay}>{generatedCode}</Txt>
                <View style={s.timerRow}>
                  <Ionicons name="time-outline" size={16} color="rgba(255,255,255,0.7)" />
                  <Txt variant="bodyBold" color="rgba(255,255,255,0.8)" style={{ marginLeft: 6 }}>{timeLeft}</Txt>
                </View>
              </LinearGradient>

              <View style={s.infoCard}>
                <Txt variant="bodyReg" color="rgba(255,255,255,0.5)" style={{ textAlign: 'center', lineHeight: 20 }}>
                  Driver {driver?.full_name} will enter this code in their app to receive TTD ${parseFloat(amount).toFixed(2)}. The $2.00 fee is non-refundable. Codes expire in 2 hours.
                </Txt>
              </View>

              <TouchableOpacity
                style={s.submitBtn}
                onPress={() => navigation.goBack()}
                activeOpacity={0.85}
              >
                <LinearGradient colors={[CYAN, VOICES.rider.accent]} style={StyleSheet.absoluteFillObject} />
                <Txt variant="bodyBold" weight="heavy" color="#0B0E12">Done</Txt>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <LinearGradient colors={['#1DE0E6', '#a88be0']} style={s.balanceCard}>
                <Txt variant="caption" weight="heavy" color="rgba(255,255,255,0.7)">Your Balance</Txt>
                <Txt variant="headingL" weight="heavy" color="#EAF3F6" style={{ fontSize: 40, fontFamily: 'CormorantGaramond_600SemiBold' }}>
                  ${balance.toFixed(2)}
                </Txt>
                <Txt variant="small" color="rgba(255,255,255,0.5)">TTD</Txt>
              </LinearGradient>

              {step === 'driver' && (
                <View style={s.inputCard}>
                  <Txt variant="bodyBold" color="#EAF3F6" style={{ fontSize: 13, marginBottom: 8 }}>Driver Phone Number</Txt>
                  <View style={s.phoneRow}>
                    <Txt variant="bodyReg" color="rgba(255,255,255,0.3)" style={{ fontSize: 16 }}>+1</Txt>
                    <TextInput
                      style={s.phoneInput}
                      value={phone}
                      onChangeText={setPhone}
                      keyboardType="phone-pad"
                      placeholder="8685550100"
                      placeholderTextColor="rgba(255,255,255,0.2)"
                      autoFocus
                    />
                  </View>
                  <TouchableOpacity
                    style={[s.submitBtn, (!phone.replace(/[^\d]/g, '').length || searching) && { opacity: 0.5 }]}
                    onPress={handleSearchDriver}
                    disabled={!phone.replace(/[^\d]/g, '').length || searching}
                    activeOpacity={0.85}
                  >
                    <LinearGradient colors={[CYAN, VOICES.rider.accent]} style={StyleSheet.absoluteFillObject} />
                    {searching ? (
                      <ActivityIndicator color="#EAF3F6" />
                    ) : (
                      <Txt variant="bodyBold" weight="heavy" color="#0B0E12">Find Driver</Txt>
                    )}
                  </TouchableOpacity>
                </View>
              )}

              {step === 'amount' && driver && (
                <View style={s.inputCard}>
                  <View style={s.driverBadge}>
                    <Ionicons name="person-circle-outline" size={28} color={CYAN} />
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Txt variant="bodyBold" color="#EAF3F6">{driver.full_name}</Txt>
                      <Txt variant="small" color="rgba(255,255,255,0.4)">+1 {driver.phone}</Txt>
                    </View>
                    <TouchableOpacity onPress={() => { setDriver(null); setStep('driver'); }}>
                      <Ionicons name="close-circle" size={22} color="rgba(255,255,255,0.4)" />
                    </TouchableOpacity>
                  </View>

                  <Txt variant="bodyBold" color="#EAF3F6" style={{ fontSize: 13, marginTop: 20, marginBottom: 8 }}>Amount (TTD $50 - $2,000)</Txt>
                  <View style={s.amountRow}>
                    <Txt variant="headingL" weight="heavy" color="rgba(255,255,255,0.3)" style={{ fontSize: 24 }}>$</Txt>
                    <TextInput
                      style={s.amountInput}
                      value={amount}
                      onChangeText={setAmount}
                      keyboardType="decimal-pad"
                      placeholder="0.00"
                      placeholderTextColor="rgba(255,255,255,0.2)"
                      autoFocus
                    />
                  </View>

                  {parseFloat(amount) > 0 && (
                    <View style={s.feeRow}>
                      <Txt variant="small" color="rgba(255,255,255,0.4)">Fee: TTD $2.00</Txt>
                      <Txt variant="small" color="rgba(255,255,255,0.6)">Driver gets: TTD ${(parseFloat(amount) - 2).toFixed(2)}</Txt>
                    </View>
                  )}

                  <TouchableOpacity
                    style={[s.submitBtn, (!parseFloat(amount) || submitting) && { opacity: 0.5 }]}
                    onPress={handleGenerateCode}
                    disabled={!parseFloat(amount)}
                    activeOpacity={0.85}
                  >
                    <LinearGradient colors={[CYAN, VOICES.rider.accent]} style={StyleSheet.absoluteFillObject} />
                    <Txt variant="bodyBold" weight="heavy" color="#0B0E12">Generate Code</Txt>
                  </TouchableOpacity>
                </View>
              )}

              {step === 'confirm' && (
                <View style={s.inputCard}>
                  <Txt variant="bodyBold" color="#EAF3F6" style={{ fontSize: 15, marginBottom: 16, textAlign: 'center' }}>Confirm Withdrawal</Txt>

                  <View style={s.confirmRow}>
                    <Txt variant="bodyReg" color="rgba(255,255,255,0.5)">Driver</Txt>
                    <Txt variant="bodyBold" color="#EAF3F6">{driver?.full_name}</Txt>
                  </View>
                  <View style={s.confirmRow}>
                    <Txt variant="bodyReg" color="rgba(255,255,255,0.5)">Amount</Txt>
                    <Txt variant="bodyBold" color="#EAF3F6">TTD ${parseFloat(amount).toFixed(2)}</Txt>
                  </View>
                  <View style={s.confirmRow}>
                    <Txt variant="bodyReg" color="rgba(255,255,255,0.5)">Fee</Txt>
                    <Txt variant="bodyBold" color="#FF6E84">TTD $2.00</Txt>
                  </View>
                  <View style={[s.confirmRow, { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)', paddingTop: 12 }]}>
                    <Txt variant="bodyBold" color="rgba(255,255,255,0.5)">Total Deducted</Txt>
                    <Txt variant="bodyBold" color="#EAF3F6">TTD ${(parseFloat(amount) + 2).toFixed(2)}</Txt>
                  </View>

                  <View style={s.confirmRow}>
                    <Txt variant="small" color="rgba(255,255,255,0.4)" style={{ textAlign: 'center', marginTop: 8 }}>
                      The amount (minus fee) will be credited to the driver when they enter the code. Unused codes are auto-refunded after 2 hours.
                    </Txt>
                  </View>

                  <View style={s.confirmActions}>
                    <TouchableOpacity
                      style={s.cancelBtn}
                      onPress={() => setStep('amount')}
                    >
                      <Txt variant="bodyBold" color="rgba(255,255,255,0.6)">Cancel</Txt>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[s.submitBtn, submitting && { opacity: 0.5 }]}
                      onPress={handleSubmitCode}
                      disabled={submitting}
                      activeOpacity={0.85}
                    >
                      <LinearGradient colors={[CYAN, VOICES.rider.accent]} style={StyleSheet.absoluteFillObject} />
                      {submitting ? (
                        <ActivityIndicator color="#EAF3F6" />
                      ) : (
                        <Txt variant="bodyBold" weight="heavy" color="#0B0E12">Confirm & Deduct</Txt>
                      )}
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
  balanceCard: { borderRadius: 32, padding: 28, marginBottom: 24, ...elevationGlow(), gap: 6 },
  inputCard: { backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 24, padding: 20, marginBottom: 16, ...ghostBorder(0.15) },
  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  phoneInput: { flex: 1, fontSize: 18, fontWeight: '600', color: '#EAF3F6', paddingVertical: 8 },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  amountInput: { flex: 1, fontSize: 32, fontWeight: '700', color: '#EAF3F6', fontFamily: 'CormorantGaramond_600SemiBold', paddingVertical: 4 },
  feeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' },
  driverBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 16, padding: 12 },
  submitBtn: { height: 56, borderRadius: 20, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', marginTop: 12, flex: 1, ...elevationGlow() },
  cancelBtn: { height: 56, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginTop: 12, flex: 1 },
  confirmRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 },
  confirmActions: { flexDirection: 'row', gap: 12, marginTop: 8 },
  infoCard: { marginTop: 24, padding: 20, backgroundColor: 'rgba(255,255,255,0.02)', borderRadius: 20 },
  codeHero: { borderRadius: 32, padding: 32, alignItems: 'center', marginBottom: 24, ...elevationGlow(), gap: 12 },
  codeDisplay: { fontSize: 40, fontWeight: '900', color: '#EAF3F6', letterSpacing: 8, fontFamily: 'CormorantGaramond_600SemiBold' },
  timerRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.3)', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 24 },
});
