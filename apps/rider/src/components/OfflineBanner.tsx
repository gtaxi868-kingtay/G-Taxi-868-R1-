import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { useNetInfo } from '@react-native-community/netinfo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SPACE, Txt, useTheme } from '../ui/kit';

// Small pill at the top: "No internet connection", then "Back online" for
// two seconds once it returns. Only shows "Back online" after a real outage.
export function OfflineBanner() {
    const m = useTheme();
    const netInfo = useNetInfo();
    const insets = useSafeAreaInsets();
    const [showReconnected, setShowReconnected] = useState(false);
    const wasOffline = useRef(false);

    const isOffline = netInfo.isConnected === false;

    useEffect(() => {
        if (netInfo.isConnected === false) { wasOffline.current = true; return; }
        if (netInfo.isConnected === true && wasOffline.current) {
            wasOffline.current = false;
            setShowReconnected(true);
            const timer = setTimeout(() => setShowReconnected(false), 2000);
            return () => clearTimeout(timer);
        }
    }, [netInfo.isConnected]);

    if (!isOffline && !showReconnected) return null;

    return (
        <View pointerEvents="none" style={{ position: 'absolute', top: insets.top + SPACE.sm, left: 0, right: 0, alignItems: 'center', zIndex: 900 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', height: 34, paddingHorizontal: SPACE.lg, borderRadius: 17, backgroundColor: m.sheet[1], borderWidth: 1, borderColor: m.sheetBorder }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, marginRight: SPACE.sm, backgroundColor: isOffline ? '#E5484D' : '#2FB57C' }} />
                <Txt variant="label">{isOffline ? 'No internet connection' : 'Back online'}</Txt>
            </View>
        </View>
    );
}
