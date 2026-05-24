import React from 'react';
import { View, ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { GLASS, CARD, ghostBorder, glassSurface, tokens } from './designTokens';

interface GlassCardProps {
  children: React.ReactNode;
  style?: ViewStyle;
  intensity?: number;
}

export function GlassCard({
  children,
  style,
  intensity = GLASS.defaultIntensity,
}: GlassCardProps) {
  return (
    <BlurView
      intensity={intensity}
      tint={GLASS.defaultTint}
      style={[{
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        borderBottomLeftRadius: 0,
        borderBottomRightRadius: 0,
        overflow: 'hidden',
        ...ghostBorder(0.15),
      }, glassSurface(intensity, GLASS.surfaceOpacity), {
        shadowColor: tokens.colors.cyan,
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.08,
        shadowRadius: 24,
      }, style]}
    >
      <View style={{
        flex: 1,
        backgroundColor: CARD.innerBg,
        padding: CARD.innerPaddingH,
        paddingTop: CARD.innerPaddingV,
      }}>
        {children}
      </View>
    </BlurView>
  );
}
