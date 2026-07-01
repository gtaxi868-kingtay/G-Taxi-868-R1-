import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ScalePress } from './ScalePress';
import { RIDER, ghostBorder, tokens } from './designTokens';

interface RiderInfoCardProps {
  name: string;
  paymentMethod: string | null | undefined;
  onChat?: () => void;
  onCall?: () => void;
}

export function RiderInfoCard({ name, paymentMethod, onChat, onCall }: RiderInfoCardProps) {
  const initial = (name || 'R').charAt(0).toUpperCase();
  const paymentLabel = paymentMethod === 'cash' ? 'CASH' : 'CARD';

  return (
    <View style={s.container}>
      <View style={s.avatar}>
        <Text style={s.avatarText}>{initial}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.name}>{name}</Text>
        <Text style={s.subtext}>
          <Ionicons name="star" size={12} color="#E6B450" /> 5.0 · {paymentLabel}
        </Text>
      </View>
      {onCall && (
        <ScalePress style={s.chatBtn} onPress={onCall}>
          <Ionicons name="call-outline" size={20} color="#EAF3F6" />
        </ScalePress>
      )}
      {onChat && (
        <ScalePress style={s.chatBtn} onPress={onChat}>
          <Ionicons name="chatbubble-outline" size={20} color="#EAF3F6" />
        </ScalePress>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: RIDER.avatarSize,
  },
  avatar: {
    width: RIDER.avatarSize,
    height: RIDER.avatarSize,
    borderRadius: RIDER.avatarRadius,
    backgroundColor: RIDER.avatarBg,
    alignItems: 'center',
    justifyContent: 'center',
    ...ghostBorder(0.2),
  },
  avatarText: {
    fontSize: 20,
    fontWeight: '800',
    color: tokens.colors.cyan,
  },
  name: {
    fontSize: 17,
    fontWeight: '800',
    color: tokens.colors.text,
    letterSpacing: -0.3,
  },
  subtext: {
    fontSize: 13,
    fontWeight: '500',
    color: tokens.colors.textMuted,
    marginTop: 2,
  },
  chatBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: tokens.colors.containerLow,
    alignItems: 'center',
    justifyContent: 'center',
    ...ghostBorder(0.2),
  },
});
