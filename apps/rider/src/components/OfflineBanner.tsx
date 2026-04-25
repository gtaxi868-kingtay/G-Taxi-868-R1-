import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useNetInfo } from '@react-native-community/netinfo';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export function OfflineBanner() {
  const netInfo = useNetInfo();
  const insets = useSafeAreaInsets();
  const [showReconnected, setShowReconnected] = useState(false);

  const isOffline = netInfo.isConnected === false;
  const wasOffline = netInfo.isConnected === true && showReconnected;

  useEffect(() => {
    if (netInfo.isConnected === true && showReconnected === false) {
      // We just came back online
      const hasBeenOfflineBefore = netInfo.details !== null;
      if (hasBeenOfflineBefore) {
        setShowReconnected(true);
        const timer = setTimeout(() => {
          setShowReconnected(false);
        }, 2000);
        return () => clearTimeout(timer);
      }
    }
  }, [netInfo.isConnected]);

  if (!isOffline && !showReconnected) return null;

  return (
    <View style={[styles.container, { paddingTop: Math.max(20, insets.top) }]}>
        <BlurView intensity={30} tint="dark" style={[
          styles.banner,
          showReconnected && !isOffline && styles.bannerReconnected
        ]}>
            <View style={[
              styles.dot,
              showReconnected && !isOffline && styles.dotReconnected
            ]} />
            <Text style={[
              styles.text,
              showReconnected && !isOffline && styles.textReconnected
            ]}>
              {isOffline ? 'No internet connection' : 'Reconnected'}
            </Text>
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
    backgroundColor: 'rgba(255, 77, 109, 0.9)',
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  bannerReconnected: {
    backgroundColor: 'rgba(0, 255, 148, 0.9)',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#FFFFFF',
  },
  dotReconnected: {
    backgroundColor: '#0D0B1E',
  },
  text: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  textReconnected: {
    color: '#0D0B1E',
  }
});
