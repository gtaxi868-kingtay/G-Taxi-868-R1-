import React, { useCallback } from 'react';
import { TouchableOpacity, TouchableOpacityProps } from 'react-native';
import Reanimated, {
  useSharedValue, useAnimatedStyle, withSpring,
} from 'react-native-reanimated';

interface ScalePressProps extends TouchableOpacityProps {
  children: React.ReactNode;
  scaleTo?: number;
}

const AnimatedTouchable = Reanimated.createAnimatedComponent(TouchableOpacity);

export function ScalePress({ children, scaleTo = 0.96, style, onPress, ...rest }: ScalePressProps) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = useCallback(() => {
    scale.value = withSpring(scaleTo, { damping: 15, stiffness: 200, mass: 0.5 });
  }, [scaleTo]);

  const handlePressOut = useCallback(() => {
    scale.value = withSpring(1, { damping: 15, stiffness: 200, mass: 0.5 });
  }, []);

  return (
    <AnimatedTouchable
      activeOpacity={1}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={onPress}
      style={[animatedStyle, style]}
      {...rest}
    >
      {children}
    </AnimatedTouchable>
  );
}
