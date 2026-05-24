import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ghostBorder, tokens } from './designTokens';

export function QuietRideBanner() {
  return (
    <View style={s.container}>
      <Ionicons name="volume-mute" size={14} color={tokens.colors.cyan} />
      <Text style={s.text}>QUIET RIDE PREFERRED</Text>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,229,255,0.06)',
    borderRadius: 12,
    padding: 10,
    marginBottom: 12,
    ...ghostBorder(0.12),
    gap: 8,
  },
  text: {
    fontSize: 11,
    fontWeight: '800',
    color: tokens.colors.cyan,
    letterSpacing: 0.5,
  },
});
