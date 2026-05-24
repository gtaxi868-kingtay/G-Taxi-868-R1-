import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Reanimated, {
  useSharedValue, withTiming, withRepeat, withSequence,
  useAnimatedStyle, interpolate, Extrapolation,
} from 'react-native-reanimated';
import { SOS, CANCEL, COLORS, ANIM, ghostBorder, elevationGlow, tokens } from './designTokens';
import { ScalePress } from './ScalePress';

interface SOSButtonProps {
  onSOS?: () => void;
  onCancel?: () => void;
  top: number;
}

export function SOSButton({ onSOS, onCancel, top }: SOSButtonProps) {
  const ring = useSharedValue(0);

  useEffect(() => {
    ring.value = withRepeat(
      withSequence(
        withTiming(1, { duration: ANIM.sosRing.expand }),
        withTiming(0, { duration: ANIM.sosRing.contract }),
      ),
      -1, false,
    );
  }, []);

  const ringStyle = useAnimatedStyle(() => ({
    opacity: interpolate(ring.value, [0, 1], [0, 0.6], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(ring.value, [0, 1], [1, 1.6], Extrapolation.CLAMP) }],
  }));

  return (
    <>
      <View style={[s.sosWrap, { top }]}>
        <Reanimated.View style={[s.ring, ringStyle]} />
        <ScalePress style={s.sosBtn} onPress={onSOS}>
          <Text style={s.sosText}>SOS</Text>
        </ScalePress>
      </View>
      {onCancel && (
        <ScalePress style={[s.cancelBtn, { top }]} onPress={onCancel}>
          <Ionicons name="close" size={20} color={tokens.colors.textMuted} />
        </ScalePress>
      )}
    </>
  );
}

const s = StyleSheet.create({
  sosWrap: {
    position: 'absolute',
    right: 16,
    zIndex: 20,
  },
  ring: {
    position: 'absolute',
    width: SOS.buttonSize,
    height: SOS.buttonSize,
    borderRadius: SOS.buttonRadius,
    backgroundColor: COLORS.error,
  },
  sosBtn: {
    width: SOS.buttonSize,
    height: SOS.buttonSize,
    borderRadius: SOS.buttonRadius,
    backgroundColor: COLORS.error,
    alignItems: 'center',
    justifyContent: 'center',
    ...elevationGlow(),
  },
  sosText: {
    fontSize: 13,
    fontWeight: '800',
    color: tokens.colors.text,
    letterSpacing: 0.5,
  },
  cancelBtn: {
    position: 'absolute',
    left: 16,
    width: CANCEL.buttonSize,
    height: CANCEL.buttonSize,
    borderRadius: CANCEL.buttonRadius,
    backgroundColor: CANCEL.bg,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
    ...ghostBorder(0.15),
  },
});
