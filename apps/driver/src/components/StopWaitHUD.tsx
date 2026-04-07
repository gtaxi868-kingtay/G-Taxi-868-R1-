import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Txt } from '../design-system/primitives';
import { useStopWaitTimer } from '../hooks/useStopWaitTimer';
import { BRAND, VOICES, SEMANTIC } from '../design-system';

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
                    <Txt variant="caption" weight="heavy" color={SEMANTIC.warning} style={{ letterSpacing: 1 }}>
                        {isActive ? 'TRUTHFUL WAIT TIMER' : 'FINAL WAIT TIME'}
                    </Txt>
                    <Txt weight="heavy" color="#FFF" style={styles.timerText}>{timeStr}</Txt>
                </View>
            </View>

            <View style={styles.right}>
                <View style={styles.feeBadge}>
                    <Txt variant="caption" weight="heavy" color="#0A0718">+${(feeCents / 100).toFixed(2)}</Txt>
                </View>
                <Txt variant="caption" weight="regular" color={VOICES.driver.textMuted} style={{ marginTop: 4 }}>WAIT FEE</Txt>
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
        backgroundColor: SEMANTIC.warning,
        shadowColor: SEMANTIC.warning, shadowRadius: 6, shadowOpacity: 0.8,
    },
    timerText: {
        fontSize: 28,
    },
    right: { alignItems: 'flex-end' },
    feeBadge: {
        backgroundColor: SEMANTIC.warning,
        paddingHorizontal: 12, paddingVertical: 6,
        borderRadius: 8,
    }
});
