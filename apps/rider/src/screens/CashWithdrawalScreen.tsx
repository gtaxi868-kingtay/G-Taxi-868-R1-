import React, { useState, useEffect, useRef } from 'react';
import { View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@gtaxi/core';
import { toast } from '../components/Toast';
import { Button, Card, Divider, Field, Loading, Row, Screen, Section, SPACE, Txt, useTheme } from '../ui/kit';

const MIN_CENTS = 5000;
const MAX_CENTS = 200000;

export function CashWithdrawalScreen({ navigation }: { navigation: { goBack: () => void } }) {

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
      const { data: balanceCents, error } = await supabase.rpc('get_wallet_balance', { p_user_id: user.id });
      if (error) throw error;
      setBalance((balanceCents || 0) / 100);
    } catch {
      // Don't show TT$0 and then "Insufficient balance" when the real
      // problem is that the balance never loaded.
      toast('Could not load your balance. Check your connection.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSearchDriver = async () => {
    const digits = phone.replace(/[^\d]/g, '');
    if (digits.length < 7) {
      toast('Enter a valid T&T phone number.', 'error');
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
        toast('No driver found with that number.', 'error');
        return;
      }

      const profileId = profiles[0].id;
      const { data: drv } = await supabase
        .from('drivers')
        .select('id, status')
        .eq('user_id', profileId)
        .maybeSingle();

      if (!drv || drv.status !== 'active') {
        toast('That driver is not active right now.', 'error');
        return;
      }

      setDriver({ ...drv, full_name: profiles[0].full_name, phone: digits });
      setStep('amount');
    } catch (err: any) {
      toast(err.message || 'Search failed. Please try again.', 'error');
    } finally {
      setSearching(false);
    }
  };

  const handleGenerateCode = async () => {
    const amountNum = parseFloat(amount);
    const amountCents = Math.round(amountNum * 100);

    if (isNaN(amountNum) || amountCents < MIN_CENTS) {
      toast('The minimum is TT$50.', 'error');
      return;
    }
    if (amountCents > MAX_CENTS) {
      toast('The most per code is TT$2,000.', 'error');
      return;
    }
    // The $2.00 fee comes on top (generate_cash_withdrawal_code deducts amount + fee).
    if (amountCents + 200 > Math.round(balance * 100)) {
      toast(`You need TT$${(amountNum + 2).toFixed(2)} (including the TT$2 fee) but have TT$${balance.toFixed(2)}.`, 'error');
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
      toast(err.message || 'Something went wrong. Please try again.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const m = useTheme();
  const amt = parseFloat(amount) || 0;
  const line = (label: string, value: string, strong?: boolean) => (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 }}>
      <Txt variant={strong ? 'headline' : 'body'} tone={strong ? 'ink' : 'dim'}>{label}</Txt>
      <Txt variant={strong ? 'headline' : 'bodyStrong'}>{value}</Txt>
    </View>
  );

  if (loading) return <Screen title="Cash withdrawal" onBack={() => navigation.goBack()}><Loading /></Screen>;

  if (step === 'code') {
    return (
      <Screen title="Your code" onBack={() => navigation.goBack()} footer={<Button title="Done" onPress={() => navigation.goBack()} />}>
        <Card style={{ alignItems: 'center', paddingVertical: SPACE.xxl, marginTop: SPACE.sm }}>
          <Txt variant="label" tone="dim">Show this code to {driver?.full_name || 'your driver'}</Txt>
          <Txt variant="hero" tone="accent" style={{ fontSize: 48, lineHeight: 56, letterSpacing: 8, marginTop: SPACE.md }}>{generatedCode}</Txt>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: SPACE.md }}>
            <Ionicons name="time-outline" size={16} color={m.dim} />
            <Txt variant="bodyStrong" tone="dim" style={{ marginLeft: 6 }}>{timeLeft || 'Valid for 2 hours'}</Txt>
          </View>
        </Card>
        <Txt variant="body" tone="dim" style={{ textAlign: 'center', marginTop: SPACE.lg }}>
          When the driver enters this code, they hand you TT${amt.toFixed(2)} in cash. The code works for 2 hours.
        </Txt>
      </Screen>
    );
  }

  return (
    <Screen
      title="Cash withdrawal"
      onBack={() => step === 'driver' ? navigation.goBack() : setStep(step === 'confirm' ? 'amount' : 'driver')}
      footer={
        step === 'driver' ? <Button title="Find driver" loading={searching} disabled={!phone.replace(/[^\d]/g, '').length} onPress={handleSearchDriver} />
        : step === 'amount' ? <Button title="Review" disabled={!(amt > 0)} onPress={handleGenerateCode} />
        : <Button title={`Confirm · TT$${(amt + 2).toFixed(2)} from your wallet`} loading={submitting} onPress={handleSubmitCode} />
      }
    >
      <Card style={{ alignItems: 'center', marginTop: SPACE.sm }}>
        <Txt variant="label" tone="dim">G-Coin balance</Txt>
        <Txt variant="hero" style={{ marginTop: SPACE.xs }}>${balance.toFixed(2)}</Txt>
      </Card>

      <Txt variant="body" tone="dim" style={{ marginTop: SPACE.lg }}>
        Turn G-Coin into cash: a G driver hands you the cash and gets the same amount in their wallet.
      </Txt>

      {step === 'driver' && (
        <Section title="Which driver?">
          <Field label="Driver's phone number" placeholder="868 555 0100" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoFocus />
        </Section>
      )}

      {step === 'amount' && driver && (
        <>
          <Section title="Driver">
            <Card style={{ paddingVertical: SPACE.xs }}>
              <Row icon="person-outline" title={driver.full_name || 'Driver'} subtitle={`+1 ${driver.phone}`}
                right={<Button title="Change" size="sm" variant="ghost" onPress={() => { setDriver(null); setStep('driver'); }} />} last />
            </Card>
          </Section>
          <Section title="How much cash?">
            <Field placeholder="50.00" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" autoFocus hint="Between TT$50 and TT$2,000" />
            {amt > 0 && <Txt variant="caption" tone="dim">You pay TT${(amt + 2).toFixed(2)} from your wallet (TT$2.00 fee). You get TT${amt.toFixed(2)} in cash.</Txt>}
          </Section>
        </>
      )}

      {step === 'confirm' && (
        <Section title="Check and confirm">
          <Card>
            {line('Driver', driver?.full_name || '—')}
            {line('Cash you receive', `TT$${amt.toFixed(2)}`)}
            {line('Fee', 'TT$2.00')}
            <Divider style={{ marginVertical: SPACE.sm }} />
            {line('Taken from your wallet', `TT$${(amt + 2).toFixed(2)}`, true)}
          </Card>
          <Txt variant="caption" tone="faint" style={{ marginTop: SPACE.md }}>The money leaves your wallet as soon as you confirm. The code works for 2 hours.</Txt>
        </Section>
      )}
    </Screen>
  );
}
