import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { WAIT, COLORS, TELEMETRY, ghostBorder, tokens } from './designTokens';

interface WaitFeeDisplayProps {
  arrivedAt: string;
}

export function WaitFeeDisplay({ arrivedAt }: WaitFeeDisplayProps) {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!arrivedAt) return;
    const start = new Date(arrivedAt).getTime();
    const id = setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(id);
  }, [arrivedAt]);

  const isGrace = seconds < WAIT.graceSeconds;
  const billable = Math.max(0, seconds - WAIT.graceSeconds);
  const fee = (billable / 60 * WAIT.feePerMinuteCents) / 100;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;

  return (
    <View style={s.container}>
      <View style={s.iconBox}>
        <Ionicons
          name={isGrace ? 'time-outline' : 'alarm-outline'}
          size={18}
          color={isGrace ? tokens.colors.cyan : COLORS.warning}
        />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[s.label, { color: isGrace ? tokens.colors.cyan : COLORS.warning }]}>
          {isGrace ? 'ARRIVAL GRACE' : 'PICKUP WAITING'}
        </Text>
        <Text style={s.timer}>{mins}:{secs.toString().padStart(2, '0')}</Text>
      </View>
      <View style={[s.badge, isGrace && { backgroundColor: 'rgba(0,229,255,0.1)' }]}>
        <Text style={[s.badgeText, { color: isGrace ? tokens.colors.cyan : tokens.colors.bg }]}>
          {isGrace ? 'FREE' : `+$${fee.toFixed(2)}`}
        </Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: WAIT.bg,
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
    ...ghostBorder(0.15),
  },
  iconBox: {
    width: WAIT.iconSize,
    height: WAIT.iconSize,
    borderRadius: 10,
    backgroundColor: WAIT.iconBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  label: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  timer: {
    fontSize: 22,
    fontWeight: '800',
    color: tokens.colors.text,
    letterSpacing: -0.5,
  },
  badge: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: COLORS.warning,
  },
  badgeText: {
    fontSize: 13,
    fontWeight: '800',
  },
});
