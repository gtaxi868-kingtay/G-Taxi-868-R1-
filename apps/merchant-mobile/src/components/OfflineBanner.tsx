import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNetInfo } from '@react-native-community/netinfo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// The shop app had no offline handling at all: a save while offline just
// failed with a technical error. This tells the business plainly that
// nothing will save until the connection is back, and when it is.
export function bannerText(isConnected: boolean | null, wasOffline: boolean): string | null {
  if (isConnected === false) return "You're offline. Changes won't save until you reconnect.";
  if (isConnected === true && wasOffline) return 'Back online.';
  return null;
}

export function OfflineBanner() {
  const net = useNetInfo();
  const insets = useSafeAreaInsets();
  const wasOffline = useRef(false);
  const [showBack, setShowBack] = useState(false);

  useEffect(() => {
    if (net.isConnected === false) { wasOffline.current = true; setShowBack(false); return; }
    if (net.isConnected === true && wasOffline.current) {
      setShowBack(true);
      const t = setTimeout(() => { setShowBack(false); wasOffline.current = false; }, 2500);
      return () => clearTimeout(t);
    }
  }, [net.isConnected]);

  const text = bannerText(net.isConnected, showBack);
  if (!text) return null;
  const offline = net.isConnected === false;
  return (
    <View pointerEvents="none" style={[st.wrap, { paddingTop: insets.top }]} accessibilityLiveRegion="polite">
      <View style={[st.bar, { backgroundColor: offline ? 'rgba(239,68,68,0.95)' : 'rgba(34,197,94,0.95)' }]}>
        <Text style={st.text}>{text}</Text>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 1000 },
  bar: { minHeight: 36, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  text: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
});
