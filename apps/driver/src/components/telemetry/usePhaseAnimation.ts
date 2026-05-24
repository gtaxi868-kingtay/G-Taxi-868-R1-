import { useEffect } from 'react';
import {
  useSharedValue, withSpring, useAnimatedStyle,
} from 'react-native-reanimated';
import { PHASE_STATUS_MAP, ANIM, CARD } from './designTokens';

export function usePhaseAnimation(status: string) {
  const phaseIndex = PHASE_STATUS_MAP[status] ?? 0;
  const totalPhases = Object.keys(PHASE_STATUS_MAP).length - 1;
  const cardSlide = useSharedValue<number>(CARD.initialOffset);
  const phaseProgress = useSharedValue(phaseIndex / totalPhases);

  useEffect(() => {
    cardSlide.value = withSpring(0, ANIM.cardSlide);
  }, []);

  useEffect(() => {
    phaseProgress.value = withSpring(phaseIndex / totalPhases, ANIM.phaseProgress);
  }, [phaseIndex]);

  const cardAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: cardSlide.value }],
  }));

  const phaseBarAnimatedStyle = useAnimatedStyle(() => ({
    width: `${phaseProgress.value * 100}%` as any,
  }));

  return { phaseIndex, phaseProgress, cardAnimatedStyle, phaseBarAnimatedStyle };
}
