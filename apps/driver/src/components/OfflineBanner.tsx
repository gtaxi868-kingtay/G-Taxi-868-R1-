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
    <View style={[styles.container, { paddingTop: Math.max(0, insets.top) }]}>
        <BlurView intensity={80} tint="dark" style={styles.banner}>
            <View style={styles.content}>
              <View style={styles.dot} />
              <Text style={styles.text}>NETWORK INTERRUPTED — SURVIVAL MODE ACTIVE</Text>
            </View>
        </BlurView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    zIndex: 999999, // Absolute top
  },
  banner: {
    paddingBottom: 12,
    paddingTop: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(239,68,68,0.3)',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#EF4444',
    shadowColor: '#EF4444',
    shadowOpacity: 1,
    shadowRadius: 10,
  },
  text: {
    color: '#EF4444',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 2,
  }
});
