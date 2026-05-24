import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { STATUS_BADGE, SIGNAL, GLASS, COLORS, ghostBorder, glassSurface, tokens } from './designTokens';

const SIGNAL_MAP: Record<string, { icon: keyof typeof Ionicons.glyphMap; color: string; label: string }> = {
  lock: { icon: 'radio-outline', color: COLORS.success, label: 'GPS LOCK' },
  dead_reckoning: { icon: 'pulse-outline', color: COLORS.warning, label: 'SIGNAL SURVIVAL' },
};

function statusLabel(status: string): string {
  switch (status) {
    case 'assigned': return 'EN ROUTE TO PICKUP';
    case 'arrived': return 'WAITING FOR RIDER';
    case 'in_progress': return 'HEADING TO DESTINATION';
    case 'completed': return 'TRIP COMPLETE';
    default: return '';
  }
}

function dotColor(status: string): string {
  if (status === 'assigned' || status === 'arrived') return COLORS.warning;
  return tokens.colors.cyan;
}

interface StatusBadgeProps {
  status: string;
  signalStatus?: string;
  top: number;
}

export function StatusBadge({ status, signalStatus, top }: StatusBadgeProps) {
  const sig = signalStatus ? SIGNAL_MAP[signalStatus] : null;
  return (
    <View style={[s.wrap, { top }]}>
      <BlurView intensity={GLASS.defaultIntensity} tint={GLASS.defaultTint} style={[s.badge, glassSurface(GLASS.defaultIntensity, GLASS.surfaceOpacity)]}>
        <View style={[s.dot, { backgroundColor: dotColor(status) }]} />
        <Text style={s.text}>{statusLabel(status)}</Text>
      </BlurView>
      {sig && (
        <View style={s.chip}>
          <Ionicons name={sig.icon} size={12} color={sig.color} />
          <Text style={[s.chipText, { color: sig.color }]}>{sig.label}</Text>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    position: 'absolute',
    alignSelf: 'center',
    zIndex: 20,
    alignItems: 'center',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: STATUS_BADGE.paddingH,
    paddingVertical: STATUS_BADGE.paddingV,
    backgroundColor: STATUS_BADGE.bg,
    borderRadius: STATUS_BADGE.radius,
    ...ghostBorder(0.15),
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  text: {
    fontSize: 12,
    fontWeight: '800',
    color: tokens.colors.text,
    letterSpacing: 1,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: SIGNAL.radius,
    backgroundColor: SIGNAL.bg,
    ...ghostBorder(0.15),
    gap: 4,
  },
  chipText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
});
