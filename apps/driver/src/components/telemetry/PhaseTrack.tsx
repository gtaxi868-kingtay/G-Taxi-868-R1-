import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Reanimated from 'react-native-reanimated';
import { PHASES, PHASE_TRACK, tokens } from './designTokens';

interface PhaseTrackProps {
  phaseBarAnimatedStyle: { width: any };
  phaseIndex: number;
}

export function PhaseTrack({ phaseBarAnimatedStyle, phaseIndex }: PhaseTrackProps) {
  return (
    <View style={s.container}>
      <View style={s.bg} />
      <Reanimated.View style={[s.fill, phaseBarAnimatedStyle]} />
      <View style={s.dots}>
        {PHASES.map((label, i) => {
          const active = i <= phaseIndex;
          const isCurrent = i === phaseIndex;
          const dotSize = isCurrent ? PHASE_TRACK.activeDot : PHASE_TRACK.defaultDot;
          return (
            <View key={label} style={s.dotItem}>
              <View style={[s.dot, {
                backgroundColor: active ? tokens.colors.cyan : tokens.colors.containerLow,
                borderColor: active ? tokens.colors.cyan : tokens.colors.containerHigh,
                width: dotSize,
                height: dotSize,
                borderRadius: dotSize / 2,
              }]} />
              <Text style={[s.label, {
                color: active ? tokens.colors.cyan : tokens.colors.textMuted,
                fontWeight: active ? '800' : '500',
              }]}>{label.toUpperCase()}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    marginBottom: 14,
    paddingHorizontal: 2,
  },
  bg: {
    height: PHASE_TRACK.barHeight,
    backgroundColor: tokens.colors.containerLow,
    borderRadius: 1.5,
  },
  fill: {
    position: 'absolute',
    top: 0,
    left: 0,
    height: PHASE_TRACK.barHeight,
    backgroundColor: tokens.colors.cyan,
    borderRadius: 1.5,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  dotItem: {
    alignItems: 'center',
  },
  dot: {
    borderWidth: 2,
  },
  label: {
    fontSize: 9,
    letterSpacing: 0.8,
    marginTop: 4,
  },
});
