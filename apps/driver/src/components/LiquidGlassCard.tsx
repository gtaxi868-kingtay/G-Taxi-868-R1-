import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';

interface LiquidGlassCardProps {
  children: React.ReactNode;
  style?: ViewStyle;
  blurIntensity?: number;
  accentColor?: string;
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function LiquidGlassCard({
  children,
  style,
  blurIntensity = 25,
  accentColor,
}: LiquidGlassCardProps) {
  const borderRgba = accentColor ? hexToRgba(accentColor, 0.25) : undefined;
  const glowRgba = accentColor ? hexToRgba(accentColor, 0.08) : undefined;
  return (
    <View style={[
      styles.liquidContainer,
      style,
      accentColor ? {
        borderTopColor: borderRgba,
        borderLeftColor: borderRgba,
      } : undefined,
    ]}>
      <BlurView intensity={blurIntensity} tint="dark" style={StyleSheet.absoluteFill} />
      <LinearGradient
        colors={['rgba(255,255,255,0.15)', 'rgba(255,255,255,0.0)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.5, y: 0.5 }}
        style={StyleSheet.absoluteFill}
      />
      {accentColor && glowRgba && (
        <LinearGradient
          colors={[glowRgba, 'rgba(255,255,255,0.0)']}
          start={{ x: 1, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
      )}
      <View style={styles.innerContent}>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  liquidContainer: {
    borderRadius: 24,
    overflow: 'hidden',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 0.5,
    borderBottomWidth: 0.5,
    borderTopColor: 'rgba(255, 255, 255, 0.2)',
    borderLeftColor: 'rgba(255, 255, 255, 0.15)',
    borderRightColor: 'rgba(0, 0, 0, 0.3)',
    borderBottomColor: 'rgba(0, 0, 0, 0.5)',
    backgroundColor: 'transparent',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 15 },
    shadowOpacity: 0.8,
    shadowRadius: 25,
    elevation: 15,
  },
  innerContent: {
    padding: 24,
    alignItems: 'center',
    zIndex: 1,
  },
});
