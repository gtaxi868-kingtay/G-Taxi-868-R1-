import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { VOICES, RADIUS } from '@gtaxi/design-system-native';

interface WalletCardProps {
  balanceCents: number;
  currency?: string;
  onTopUp?: () => void;
  variant?: 'rider' | 'driver';
}

export function WalletCard({
  balanceCents,
  currency = 'TTD',
  onTopUp,
  variant = 'rider',
}: WalletCardProps) {
  const isDriver = variant === 'driver';
  const accent = isDriver ? VOICES.driver.accent : VOICES.rider.accent;
  const bg = isDriver ? VOICES.driver.bg : VOICES.rider.bg;
  const textMuted = isDriver ? VOICES.driver.textMuted : VOICES.rider.textMuted;
  const balance = (balanceCents / 100).toFixed(2);
  const balanceFormatted = balance.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  return (
    <BlurView
      intensity={20}
      tint="dark"
      style={[
        s.container,
        {
          borderColor: `${accent}20`,
          backgroundColor: `${bg}CC`,
        },
      ]}
    >
      <View style={s.topRow}>
        <View style={[s.iconWrap, { backgroundColor: `${accent}15` }]}>
          <Ionicons name="wallet-outline" size={20} color={accent} />
        </View>
        <Text style={[s.label, { color: textMuted }]}>WALLET BALANCE</Text>
      </View>

      <Text style={[s.balance, { color: accent }]}>
        {currency} {balanceFormatted}
      </Text>

      {onTopUp && (
        <TouchableOpacity
          style={[s.topUpBtn, { backgroundColor: accent }]}
          onPress={onTopUp}
          activeOpacity={0.85}
        >
          <Ionicons name="add-circle-outline" size={16} color={bg} />
          <Text style={[s.topUpText, { color: bg }]}>TOP UP</Text>
        </TouchableOpacity>
      )}
    </BlurView>
  );
}

const s = StyleSheet.create({
  container: {
    borderRadius: RADIUS.lg,
    padding: 20,
    borderWidth: 1,
    overflow: 'hidden',
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: RADIUS.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  balance: {
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginBottom: 16,
  },
  topUpBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 44,
    borderRadius: RADIUS.sm,
  },
  topUpText: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
});
