import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useNetInfo } from '@react-native-community/netinfo';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export function OfflineBanner() {
  const netInfo = useNetInfo();
  const insets = useSafeAreaInsets();
  const isOffline = netInfo.isConnected === false;

  if (!isOffline) return null;

  return (
    <View style={[styles.container, { paddingTop: Math.max(20, insets.top) }]}>
        <BlurView intensity={30} tint="dark" style={styles.banner}>
            <View style={styles.dot} />
            <Text style={styles.text}>NETWORK DISCONNECTED — RETRYING...</Text>
        </BlurView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    zIndex: 99999,
  },
  banner: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(239,68,68,0.2)',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#EF4444',
  },
  text: {
    color: '#EF4444',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 2.5,
  }
});
