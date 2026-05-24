import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { ghostBorder, tokens } from './designTokens';

interface LogisticsHudProps {
  items: { product_name: string; quantity: number }[];
}

export function LogisticsHud({ items }: LogisticsHudProps) {
  if (items.length === 0) return null;
  return (
    <View style={s.container}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {items.map((item, idx) => (
          <View key={idx} style={s.chip}>
            <Text style={s.chipText}>{item.product_name} x{item.quantity}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    marginBottom: 12,
  },
  chip: {
    backgroundColor: tokens.colors.containerLow,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    marginRight: 8,
    ...ghostBorder(0.15),
  },
  chipText: {
    fontSize: 13,
    fontWeight: '700',
    color: tokens.colors.text,
  },
});
