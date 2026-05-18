import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import { useResponsive } from '../hooks/useResponsive';

interface ResponsiveContainerProps {
  children: React.ReactNode;
  style?: ViewStyle;
  backgroundColor?: string;
}

export function ResponsiveContainer({
  children,
  style,
  backgroundColor = '#0A0A15',
}: ResponsiveContainerProps) {
  const { isTablet, contentWidth } = useResponsive();

  return (
    <View style={[styles.container, { backgroundColor }, style]}>
      <View
        style={[
          styles.content,
          isTablet && {
            width: contentWidth,
            alignSelf: 'center',
          },
        ]}
      >
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    width: '100%',
  },
});
