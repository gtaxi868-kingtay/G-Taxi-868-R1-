import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useNetInfo } from '@react-native-community/netinfo';

export function OfflineBanner() {
  const netInfo = useNetInfo();
  const isOffline = netInfo.isConnected === false;

  if (!isOffline) return null;

  return (
    <View style={styles.banner}>
      <Text style={styles.text}>⚠️  No connection — reconnecting...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    backgroundColor: '#EF4444',
    paddingTop: 50,
    paddingBottom: 12,
    alignItems: 'center',
    zIndex: 9999,
  },
  text: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.3,
  }
});
