import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useStopWaitTimer } from '../hooks/useStopWaitTimer';

// Blueberry Luxe — Gold Edition (Driver)
const COLORS = {
    gold: '#FFD700',
    goldDark: '#B8860B',
    textMuted: 'rgba(255,255,255,0.4)',
};

interface StopWaitHUDProps {
    stopId: string;
    isActive: boolean;
}

/**
 * StopWaitHUD - Visual HUD for Truthful Multi-Stop Waiting
 */
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
                    <Text style={{fontSize: 11, fontWeight: '700', color: COLORS.gold, letterSpacing: 1}}>
                        {isActive ? 'TRUTHFUL WAIT TIMER' : 'FINAL WAIT TIME'}
                    </Text>
                    <Text style={[styles.timerText, {fontWeight: '700', color: '#FFF'}]}>{timeStr}</Text>
                </View>
            </View>

            <View style={styles.right}>
                <View style={styles.feeBadge}>
                    <Text style={{fontSize: 11, fontWeight: '700', color: '#0A0718'}}>+${(feeCents / 100).toFixed(2)}</Text>
                </View>
                <Text style={{ marginTop: 4, fontSize: 11, fontWeight: '400', color: COLORS.textMuted }}>WAIT FEE</Text>
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
        borderWidth: 1,
        borderColor: 'rgba(245,158,11,0.1)',
        marginBottom: 20,
    },
    left: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    pulseDot: {
        width: 8, height: 8, borderRadius: 4,
        backgroundColor: 'rgba(245,158,11,0.2)',
    },
    pulseDotActive: {
        backgroundColor: COLORS.gold,
        shadowColor: COLORS.gold, shadowRadius: 6, shadowOpacity: 0.8,
    },
    timerText: {
        fontSize: 28,
    },
    right: { alignItems: 'flex-end' },
    feeBadge: {
        backgroundColor: COLORS.gold,
        paddingHorizontal: 12, paddingVertical: 6,
        borderRadius: 8,
    }
});
