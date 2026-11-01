import React, { useState } from 'react';
import { View, TextInput } from 'react-native';
import * as Haptics from 'expo-haptics';
import { supabase } from '@gtaxi/core';
import { ENV } from '@g868/shared/env';
import { toast } from '../components/Toast';
import { BrandBadge, Button, Card, EmptyState, FONT, Loading, Row, Screen, SPACE, Txt, useTheme } from '../ui/kit';
import { AppScreenProps } from '../navigation/types';

const EDGE_FN_URL = `${ENV.SUPABASE_URL}/functions/v1/rider_nfc_pay`;

type PayPhase = 'confirm' | 'processing' | 'success' | 'error';

export function NfcPayScreen({ navigation, route }: AppScreenProps<'NfcPay'>) {
  const { merchantName, merchantTagUid } = route.params || {};

  const [amountText, setAmountText] = useState('20');
  const [phase, setPhase] = useState<PayPhase>('confirm');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);

  const amountCents = Math.round(parseFloat(amountText || '0') * 100);

  const handlePay = async () => {
    if (amountCents <= 0 || isNaN(amountCents)) {
      toast('Enter a valid amount.', 'error');
      return;
    }
    if (amountCents > 200000) {
      toast('The most you can pay at once is TT$2,000.', 'error');
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

  const m = useTheme();
  return (
    <Screen
      onBack={() => navigation.goBack()}
      title="Pay"
      footer={phase === 'confirm' ? <Button title={`Pay $${(isNaN(amountCents) ? 0 : amountCents / 100).toFixed(2)} with G-Coin`} icon="wallet-outline" onPress={handlePay} disabled={!(amountCents > 0)} />
        : phase === 'success' ? <Button title="Done" onPress={handleDone} />
        : phase === 'error' ? (
          <View>
            <Button title="Try again" icon="refresh" onPress={handleRetry} />
            <Button title="Cancel" variant="ghost" style={{ marginTop: SPACE.md }} onPress={handleDone} />
          </View>
        ) : undefined}
    >
      {phase === 'confirm' && (
        <View style={{ alignItems: 'center', paddingTop: SPACE.xl }}>
          <BrandBadge icon="storefront" size={72} round />
          <Txt variant="title" style={{ marginTop: SPACE.lg }}>{merchantName || 'Shop'}</Txt>
          <Txt variant="body" tone="dim" style={{ marginTop: SPACE.xs }}>How much are you paying?</Txt>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: SPACE.xl }}>
            <Txt variant="hero" tone="dim" style={{ fontSize: 40, lineHeight: 48 }}>$</Txt>
            <TextInput
              value={amountText}
              onChangeText={setAmountText}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor={m.faint}
              autoFocus
              accessibilityLabel="Amount in TTD"
              style={{ minWidth: 120, color: m.ink, fontFamily: FONT.serif, fontSize: 48, textAlign: 'center' }}
            />
          </View>
          <Txt variant="caption" tone="faint">TTD · up to $2,000 per payment</Txt>
        </View>
      )}

      {phase === 'processing' && (
        <View style={{ alignItems: 'center', paddingTop: SPACE.xxl }}>
          <Loading />
          <Txt variant="title">Paying…</Txt>
          <Txt variant="body" tone="dim" style={{ marginTop: SPACE.xs }}>${(amountCents / 100).toFixed(2)} to {merchantName || 'the shop'}</Txt>
        </View>
      )}

      {phase === 'success' && result && (
        <View style={{ paddingTop: SPACE.xl }}>
          <EmptyState icon="checkmark-circle" title="Payment sent" body={`TT$${(result.amount_cents / 100).toFixed(2)} to ${result.merchant_name}`} />
          <Card style={{ paddingVertical: SPACE.xs }}>
            <Row title="New balance" right={<Txt variant="bodyStrong">TT${(result.rider_balance_after / 100).toFixed(2)}</Txt>} />
            <Row title="Reference" right={<Txt variant="body" tone="dim">{result.transaction_id?.substring(0, 8).toUpperCase()}</Txt>} last />
          </Card>
        </View>
      )}

      {phase === 'error' && (
        <EmptyState icon="close-circle-outline" title="Payment did not go through" body={errorMsg || 'Please try again.'} />
      )}
    </Screen>
  );
}
