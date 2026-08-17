import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  useWindowDimensions, ActivityIndicator, Alert, ScrollView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '@gtaxi/core';
import { ENV } from '@g868/shared/env';
import { SURFACE, VOICES } from '@gtaxi/design-system';
import { ghostBorder, elevationGlow, glassSurface } from '@gtaxi/design-system/utils/style-rules';
import { AppScreenProps } from '../navigation/types';

const CYAN = '#06B6D4';
const EDGE_FN_URL = `${ENV.SUPABASE_URL}/functions/v1/rider_nfc_pay`;

type PayPhase = 'confirm' | 'processing' | 'success' | 'error';

export function NfcPayScreen({ navigation, route }: AppScreenProps<'NfcPay'>) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { merchantName, merchantTagUid } = route.params || {};

  const [amountText, setAmountText] = useState('20');
  const [phase, setPhase] = useState<PayPhase>('confirm');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);

  const amountCents = Math.round(parseFloat(amountText || '0') * 100);

  const handlePay = async () => {
    if (amountCents <= 0 || isNaN(amountCents)) {
      Alert.alert('Invalid Amount', 'Please enter a valid amount.');
      return;
    }
    if (amountCents > 200000) {
      Alert.alert('Amount Too High', 'Maximum is TTD $2,000.00 per transaction.');
      return;
    }

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setPhase('processing');
    setErrorMsg(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error('Not authenticated');
      }

      const res = await fetch(EDGE_FN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          merchant_tag_uid: merchantTagUid,
          amount_cents: amountCents,
        }),
      });

      const body = await res.json();

      if (!res.ok || !body.success) {
        throw new Error(body.error || body?.error_message || 'Payment failed');
      }

      setResult(body.data);
      setPhase('success');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: any) {
      setErrorMsg(err.message || 'Payment failed. Please try again.');
      setPhase('error');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const handleDone = () => {
    navigation.popToTop();
  };

  const handleRetry = () => {
    setPhase('confirm');
    setErrorMsg(null);
  };

  return (
    <View style={s.container}>
      <LinearGradient colors={['#1A0533', '#0D1B4B']} style={StyleSheet.absoluteFillObject} />

      <TouchableOpacity style={[s.backBtn, { top: insets.top + 8 }]} onPress={() => navigation.goBack()}>
        <Ionicons name="close" size={28} color="#EAF3F6" />
      </TouchableOpacity>

      <ScrollView contentContainerStyle={[s.content, { paddingTop: insets.top + 80, paddingBottom: insets.bottom + 40 }]}>
        {phase === 'confirm' && (
          <View style={s.card}>
            <View style={s.iconWrap}>
              <Ionicons name="storefront" size={40} color={VOICES.rider.accent} />
            </View>
            <Text style={s.merchantName}>{merchantName || 'Store'}</Text>
            <Text style={s.label}>Enter amount (TTD)</Text>
            <View style={s.amountRow}>
              <Text style={s.currencySign}>$</Text>
              <TextInput
                style={s.amountInput}
                value={amountText}
                onChangeText={setAmountText}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor="rgba(255,255,255,0.2)"
                autoFocus
              />
            </View>
            <TouchableOpacity style={s.payBtn} onPress={handlePay}>
              <Ionicons name="wallet" size={20} color="#EAF3F6" />
              <Text style={s.payBtnText}>Pay ${parseFloat(amountText || '0').toFixed(2)}</Text>
            </TouchableOpacity>
          </View>
        )}

        {phase === 'processing' && (
          <View style={s.card}>
            <ActivityIndicator size="large" color={VOICES.rider.accent} />
            <Text style={s.statusTitle}>Processing Payment...</Text>
            <Text style={s.statusSub}>${(amountCents / 100).toFixed(2)} to {merchantName}</Text>
          </View>
        )}

        {phase === 'success' && result && (
          <View style={s.card}>
            <View style={[s.iconWrap, { backgroundColor: 'rgba(50,215,75,0.15)' }]}>
              <Ionicons name="checkmark-circle" size={48} color="#32D74B" />
            </View>
            <Text style={s.statusTitle}>Payment Successful!</Text>
            <Text style={s.amountLabel}>TTD ${(result.amount_cents / 100).toFixed(2)}</Text>
            <Text style={s.merchantLabel}>{result.merchant_name}</Text>
            <View style={s.detailRow}>
              <Text style={s.detailLabel}>Balance</Text>
              <Text style={s.detailValue}>
                TTD ${(result.rider_balance_after / 100).toFixed(2)}
              </Text>
            </View>
            <View style={s.detailRow}>
              <Text style={s.detailLabel}>Reference</Text>
              <Text style={[s.detailValue, { fontSize: 12 }]} numberOfLines={1}>
                {result.transaction_id?.substring(0, 8)}...
              </Text>
            </View>
            <TouchableOpacity style={s.doneBtn} onPress={handleDone}>
              <Text style={s.doneBtnText}>Done</Text>
            </TouchableOpacity>
          </View>
        )}

        {phase === 'error' && (
          <View style={s.card}>
            <View style={[s.iconWrap, { backgroundColor: 'rgba(255,69,58,0.15)' }]}>
              <Ionicons name="close-circle" size={48} color="#FF454A" />
            </View>
            <Text style={s.statusTitle}>Payment Failed</Text>
            <Text style={s.errorMsg}>{errorMsg}</Text>
            <TouchableOpacity style={s.retryBtn} onPress={handleRetry}>
              <Ionicons name="refresh" size={20} color="#EAF3F6" />
              <Text style={s.retryBtnText}>Try Again</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.cancelBtn} onPress={handleDone}>
              <Text style={s.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: SURFACE.base },
  backBtn: {
    position: 'absolute', left: 16, zIndex: 10,
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center', alignItems: 'center',
  },
  content: { flex: 1, alignItems: 'center', paddingHorizontal: 24 },
  card: {
    width: '100%', borderRadius: 32, padding: 32, alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
    ...ghostBorder(),
  },
  iconWrap: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: 'rgba(191,64,255,0.12)',
    justifyContent: 'center', alignItems: 'center',
    marginBottom: 20,
  },
  merchantName: { fontSize: 24, fontWeight: '800', color: '#EAF3F6', marginBottom: 8 },
  label: { fontSize: 14, color: 'rgba(255,255,255,0.5)', marginBottom: 12, marginTop: 8 },
  amountRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    marginBottom: 32, gap: 4,
  },
  currencySign: { fontSize: 36, fontWeight: '700', color: '#EAF3F6' },
  amountInput: {
    fontSize: 42, fontWeight: '800', color: '#EAF3F6',
    textAlign: 'center', minWidth: 140,
    borderBottomWidth: 2, borderBottomColor: VOICES.rider.accent,
    paddingBottom: 4,
  },
  payBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: VOICES.rider.accent,
    paddingHorizontal: 32, paddingVertical: 16, borderRadius: 16,
  },
  payBtnText: { color: '#EAF3F6', fontSize: 18, fontWeight: '700' },
  statusTitle: { fontSize: 22, fontWeight: '800', color: '#EAF3F6', marginTop: 20, marginBottom: 8 },
  statusSub: { fontSize: 15, color: 'rgba(255,255,255,0.5)', marginBottom: 16 },
  amountLabel: { fontSize: 40, fontWeight: '800', color: '#EAF3F6', marginVertical: 8 },
  merchantLabel: { fontSize: 16, color: 'rgba(255,255,255,0.6)', marginBottom: 24 },
  detailRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    width: '100%', paddingVertical: 8,
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)',
  },
  detailLabel: { fontSize: 14, color: 'rgba(255,255,255,0.5)' },
  detailValue: { fontSize: 14, fontWeight: '700', color: '#EAF3F6' },
  doneBtn: {
    marginTop: 24, backgroundColor: '#32D74B',
    paddingHorizontal: 48, paddingVertical: 14, borderRadius: 16,
  },
  doneBtnText: { color: '#1A0533', fontSize: 16, fontWeight: '700' },
  errorMsg: { fontSize: 14, color: '#FF454A', textAlign: 'center', marginBottom: 24, lineHeight: 20 },
  retryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: VOICES.rider.accent,
    paddingHorizontal: 28, paddingVertical: 14, borderRadius: 16,
  },
  retryBtnText: { color: '#EAF3F6', fontSize: 16, fontWeight: '700' },
  cancelBtn: { marginTop: 12, padding: 12 },
  cancelBtnText: { color: 'rgba(255,255,255,0.5)', fontSize: 14 },
});
