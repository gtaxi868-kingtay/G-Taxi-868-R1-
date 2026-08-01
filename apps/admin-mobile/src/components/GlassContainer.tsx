import React from 'react';
import { View, StyleSheet, ViewStyle, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import { liquidGlass } from '@gtaxi/design-system/utils/style-rules';

interface GlassContainerProps {
  children: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
  intensity?: number;
}

export const GlassContainer = ({ children, style, intensity = 20 }: GlassContainerProps) => {
  const isWeb = Platform.OS === 'web';

  if (!isWeb) {
    return (
      <View style={[styles.nativeWrapper, style]}>
        <BlurView intensity={intensity} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={styles.content}>{children}</View>
      </View>
    );
  }

  return (
    <View style={[styles.webContainer, style]}>
      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  nativeWrapper: {
    overflow: 'hidden',
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
    borderRadius: 16,
  },
  content: {
    padding: 16,
    zIndex: 1,
  },
  webContainer: {
    ...liquidGlass(0.05, 20),
    padding: 16,
    borderRadius: 16,
  },
});
