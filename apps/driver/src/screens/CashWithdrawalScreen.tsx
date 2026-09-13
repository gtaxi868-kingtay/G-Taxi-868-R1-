import React, { useState, useEffect } from 'react';
import {
  View, StyleSheet, TextInput, TouchableOpacity,
  ActivityIndicator, Alert, ScrollView, Text, KeyboardAvoidingView, Platform
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@gtaxi/core';
import { SURFACE, VOICES } from '@gtaxi/design-system';
import { elevationGlow, ghostBorder } from '@gtaxi/design-system/utils/style-rules';
import { LinearGradient } from 'expo-linear-gradient';

export function CashWithdrawalScreen({ navigation }: { navigation: { goBack: () => void } }) {
  const insets = useSafeAreaInsets();
  const [amount, setAmount] = useState('');
  const [phone, setPhone] = useState('');
  const [balance, setBalance] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [featureEnabled, setFeatureEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    checkConfig();
  }, []);

  const checkConfig = async () => {
    setLoading(true);
    try {
      const { data: config } = await supabase
        .from('system_config')
        .select('value')
        .eq('key', 'cash_withdrawal_config')
        .maybeSingle();

      if (!config?.value) {
        setFeatureEnabled(false);
        return;
      }

      const parsed = JSON.parse(config.value);
      if (!parsed.enabled) {
        setFeatureEnabled(false);
        return;
      }

      setFeatureEnabled(true);

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setFeatureEnabled(false); return; }

      // get_wallet_balance enforces p_user_id === auth.uid()
      const { data: balanceCents } = await supabase
        .rpc('get_wallet_balance', { p_user_id: session.user.id });
      setBalance((balanceCents || 0) / 100);
    } catch {
      setFeatureEnabled(false);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      Alert.alert('Invalid Amount', 'Enter a valid amount');
      return;
    }

    const phoneDigits = phone.replace(/[^\d]/g, '');
    if (phoneDigits.length < 7) {
      Alert.alert('Invalid Phone', 'Enter a valid T&T phone number');
      return;
    }

    const amountCents = Math.round(amountNum * 100);
    const feeCents = Math.round(amountCents * 0.02);
    const totalCents = amountCents + feeCents;

    if (totalCents > balance * 100) {
      Alert.alert('Insufficient Balance', `You need TTD $${(totalCents / 100).toFixed(2)} (amount + fee) but have TTD $${balance.toFixed(2)}`);
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSubmitting(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const { data, error } = await supabase.functions.invoke('request_cash_withdrawal', {
        body: { amount_ttd: amountCents, phone_number: phoneDigits },
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (error || !data?.success) {
        throw new Error(data?.error || error?.message || 'Withdrawal failed');
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        'Withdrawal Requested',
        `TTD $${(amountCents / 100).toFixed(2)} will be sent via SMS to ${phoneDigits}. Republic Bank will process the transfer and you will receive a confirmation code.`,
        [{ text: 'Done', onPress: () => navigation.goBack() }]
      );
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <View style={[s.root, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={VOICES.driver.accent} size="large" />
      </View>
    );
  }

  if (featureEnabled === false) {
    return (
      <View style={s.root}>
        <View style={[s.header, { paddingTop: insets.top + 10 }]}>
          <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()}>
            <Ionicons name="chevron-back" size={24} color="#EAF3F6" />
          </TouchableOpacity>
          <Text style={{ fontSize: 20, fontWeight: '700', color: '#EAF3F6', marginLeft: 16 }}>Cash Withdrawal</Text>
        </View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 }}>
          <View style={s.comingSoonCard}>
            <Ionicons name="time-outline" size={48} color={VOICES.driver.accent} />
            <Text style={{ fontSize: 18, fontWeight: '700', color: '#EAF3F6', textAlign: 'center', marginTop: 20 }}>
              Coming Soon
            </Text>
            <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', textAlign: 'center', marginTop: 8 }}>
              Cardless cash withdrawal via Republic Bank SMS is being set up by your admin. Check back soon.
            </Text>
          </View>
        </View>
      </View>
    );
  }

  const amountNum = parseFloat(amount) || 0;
  const amountCents = Math.round(amountNum * 100);
  const feeCents = Math.round(amountCents * 0.02);

  return (
    <View style={s.root}>
      <View style={[s.header, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={24} color="#EAF3F6" />
        </TouchableOpacity>
        <Text style={{ fontSize: 20, fontWeight: '700', color: '#EAF3F6', marginLeft: 16 }}>Cash Withdrawal</Text>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: insets.bottom + 40 }}>
          <LinearGradient colors={heroGradient} style={s.balanceCard}>
            <Text style={{ fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.6)', letterSpacing: 1 }}>Your Balance</Text>
            <Text style={{ fontSize: 40, fontWeight: '700', color: '#EAF3F6', fontFamily: 'CormorantGaramond_600SemiBold' }}>
              ${balance.toFixed(2)}
            </Text>
            <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>TTD</Text>
          </LinearGradient>

          <View style={s.inputCard}>
            <Text style={{ fontSize: 13, fontWeight: '700', color: '#EAF3F6', marginBottom: 8 }}>Amount</Text>
            <View style={s.amountRow}>
              <Text style={{ fontSize: 24, fontWeight: '700', color: 'rgba(255,255,255,0.3)' }}>$</Text>
              <TextInput
                style={s.amountInput}
                value={amount}
                onChangeText={setAmount}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor="rgba(255,255,255,0.2)"
              />
            </View>
            {amountNum > 0 && (
              <View style={s.feeRow}>
                <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>Fee (2%): TTD ${(feeCents / 100).toFixed(2)}</Text>
                <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>Total: TTD ${((amountCents + feeCents) / 100).toFixed(2)}</Text>
              </View>
            )}
          </View>

          <View style={s.inputCard}>
            <Text style={{ fontSize: 13, fontWeight: '700', color: '#EAF3F6', marginBottom: 8 }}>Phone Number (SMS delivery)</Text>
            <View style={s.phoneRow}>
              <Text style={{ fontSize: 16, color: 'rgba(255,255,255,0.3)' }}>+1</Text>
              <TextInput
                style={s.phoneInput}
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
                placeholder="8685550100"
                placeholderTextColor="rgba(255,255,255,0.2)"
              />
            </View>
            <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginTop: 4 }}>
              Republic Bank will send your withdrawal code via SMS to this number
            </Text>
          </View>

          <TouchableOpacity
            style={[s.submitBtn, (!amountNum || submitting) && { opacity: 0.5 }]}
            onPress={handleSubmit}
            disabled={!amountNum || submitting}
            activeOpacity={0.85}
          >
            <LinearGradient colors={heroGradient} style={StyleSheet.absoluteFillObject} />
            {submitting ? (
              <ActivityIndicator color="#EAF3F6" />
            ) : (
              <Text style={{ fontSize: 14, fontWeight: '700', color: SURFACE.base }}>
                Request Withdrawal
              </Text>
            )}
          </TouchableOpacity>

          <View style={s.infoCard}>
            <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', textAlign: 'center', lineHeight: 20 }}>
              Funds are sent via Republic Bank SMS transfer. You will receive a code on your phone to collect cash at any Republic Bank branch or ATM. Withdrawals expire after 48 hours.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const heroGradient: [string, string] = [VOICES.driver.accent, '#1a1a3e'];

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: SURFACE.base },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, marginBottom: 20 },
  backBtn: { width: 44, height: 44, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' },
  balanceCard: { borderRadius: 32, padding: 28, marginBottom: 24, ...elevationGlow(), gap: 6 },
  inputCard: { backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 24, padding: 20, marginBottom: 16, ...ghostBorder(0.15) },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  amountInput: { flex: 1, fontSize: 32, fontWeight: '700', color: '#EAF3F6', fontFamily: 'CormorantGaramond_600SemiBold', paddingVertical: 4 },
  feeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' },
  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  phoneInput: { flex: 1, fontSize: 18, fontWeight: '600', color: '#EAF3F6', paddingVertical: 8 },
  submitBtn: { height: 56, borderRadius: 20, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', marginTop: 8, ...elevationGlow() },
  infoCard: { marginTop: 24, padding: 20, backgroundColor: 'rgba(255,255,255,0.02)', borderRadius: 20 },
  comingSoonCard: { alignItems: 'center', padding: 32, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 32, ...ghostBorder(0.15) },
});
