import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { GlassContainer } from '../components/GlassContainer';
import { VOICES } from '@gtaxi/design-system';

const BG = VOICES.admin.bg;

export function CommanderManagementScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Commander Management</Text>
      <GlassContainer>
        <Text style={styles.text}>Manage Pod Commanders and Territories</Text>
      </GlassContainer>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
    padding: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 20,
    marginTop: 40,
  },
  text: {
    color: '#fff',
  },
});
