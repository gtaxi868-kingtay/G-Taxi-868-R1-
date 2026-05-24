import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Reanimated, {
  useSharedValue, withTiming, useAnimatedStyle,
} from 'react-native-reanimated';
import { TELEMETRY, ANIM, ghostBorder, tokens } from './designTokens';

interface TelemetryHUDProps {
  speedKmh: number;
  etaMinutes: number;
  distanceKm: number;
  elapsedMinutes: number;
}

export function TelemetryHUD({ speedKmh, etaMinutes, distanceKm, elapsedMinutes }: TelemetryHUDProps) {
  const opacity = useSharedValue(0);

  useEffect(() => {
    opacity.value = withTiming(1, ANIM.fadeIn);
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  const pills: { icon: keyof typeof Ionicons.glyphMap; value: string; unit: string }[] = [
    { icon: 'speedometer-outline', value: speedKmh.toFixed(0), unit: 'KM/H' },
    { icon: 'time-outline', value: String(etaMinutes), unit: 'MIN' },
    { icon: 'map-outline', value: distanceKm.toFixed(1), unit: 'KM' },
    { icon: 'timer-outline', value: String(elapsedMinutes), unit: 'MIN' },
  ];

  return (
    <Reanimated.View style={[s.strip, animatedStyle]}>
      {pills.map((p, i) => (
        <React.Fragment key={p.icon}>
          {i > 0 && <View style={s.divider} />}
          <View style={s.pill}>
            <Ionicons name={p.icon} size={16} color={tokens.colors.cyan} />
            <Text style={s.value}>{p.value}</Text>
            <Text style={s.unit}>{p.unit}</Text>
          </View>
        </React.Fragment>
      ))}
    </Reanimated.View>
  );
}

const s = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: TELEMETRY.stripBg,
    borderRadius: TELEMETRY.stripRadius,
    paddingVertical: TELEMETRY.stripPaddingV,
    paddingHorizontal: TELEMETRY.stripPaddingH,
    marginBottom: 16,
    ...ghostBorder(TELEMETRY.ghostBorderOpacity),
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 3,
    flex: 1,
    justifyContent: 'center',
    minWidth: 60,
  },
  value: {
    fontSize: TELEMETRY.valueSize,
    fontWeight: '800',
    color: tokens.colors.text,
    letterSpacing: -0.5,
    fontVariant: ['tabular-nums'],
  },
  unit: {
    fontSize: TELEMETRY.unitSize,
    fontWeight: '700',
    color: tokens.colors.textMuted,
    letterSpacing: 0.5,
  },
  divider: {
    width: 1,
    height: 20,
    backgroundColor: TELEMETRY.dividerColor,
  },
});
