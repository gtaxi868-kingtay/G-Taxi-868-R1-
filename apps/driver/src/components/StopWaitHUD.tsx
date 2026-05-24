import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useStopWaitTimer } from '../hooks/useStopWaitTimer';
import { SURFACE, VOICES, ANIMATION } from '@gtaxi/design-system';
import { ghostBorder, elevationGlow, glassSurface } from '@gtaxi/design-system/utils/style-rules';

interface StopWaitHUDProps {
    stopId: string;
    isActive: boolean;
}

export function StopWaitHUD({ stopId, isActive }: StopWaitHUDProps) {
    const { seconds, feeCents } = useStopWaitTimer(stopId, isActive);

    if (!isActive && seconds === 0) return null;

    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    const timeStr = `${mins}:${secs.toString().padStart(2, '0')}`;

    return (
        <View style={styles.container}>
            <View style={styles.left}>
                <View style={[styles.pulseDot, isActive && styles.pulseDotActive]} />
                <View>
                    <Text style={{fontSize: 11, fontWeight: '700', color: VOICES.driver.gold, letterSpacing: 1}}>
                        {isActive ? 'TRUTHFUL WAIT TIMER' : 'FINAL WAIT TIME'}
                    </Text>
                    <Text style={[styles.timerText, {fontWeight: '700', color: '#FFF'}]}>{timeStr}</Text>
                </View>
            </View>

            <View style={styles.right}>
                <View style={styles.feeBadge}>
                    <Text style={{fontSize: 11, fontWeight: '700', color: '#0A0718'}}>+${(feeCents / 100).toFixed(2)}</Text>
                </View>
                <Text style={{ marginTop: 4, fontSize: 11, fontWeight: '400', color: 'rgba(255,255,255,0.6)' }}>WAIT FEE</Text>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        backgroundColor: 'rgba(245,158,11,0.05)',
        borderRadius: 20,
        padding: 16,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        ...ghostBorder(0.1),
        marginBottom: 20,
    },
    left: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    pulseDot: {
        width: 8, height: 8, borderRadius: 4,
        backgroundColor: 'rgba(245,158,11,0.2)',
    },
    pulseDotActive: {
        backgroundColor: VOICES.driver.gold,
        ...elevationGlow(),
    },
    timerText: {
        fontSize: 28,
    },
    right: { alignItems: 'flex-end' },
    feeBadge: {
        backgroundColor: VOICES.driver.gold,
        paddingHorizontal: 12, paddingVertical: 6,
        borderRadius: 8,
    }
});
