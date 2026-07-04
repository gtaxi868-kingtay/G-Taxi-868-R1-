import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert, Share } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '@gtaxi/core';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';

// Icon bridge: the apps use @expo/vector-icons (Ionicons), not lucide.
type IconProps = { color?: string; size?: number; style?: any };
const ShieldCheck = (p: IconProps) => <Ionicons name="shield-checkmark" {...p} />;
const ChevronLeft = (p: IconProps) => <Ionicons name="chevron-back" {...p} />;
const Users = (p: IconProps) => <Ionicons name="people" {...p} />;
const Store = (p: IconProps) => <Ionicons name="storefront" {...p} />;
const Radio = (p: IconProps) => <Ionicons name="radio" {...p} />;
const Activity = (p: IconProps) => <Ionicons name="pulse" {...p} />;

// Local token bridge mapped to the real @gtaxi/design-system palette.
// (The design system does not export COLORS/TYPOGRAPHY; these mirror tokens.ts.)
const COLORS = {
    primary: '#34E6EC',
    background: '#08090D',
    borderLight: 'rgba(255,255,255,0.10)',
    textPrimary: '#EAF3F6',
    textSecondary: 'rgba(242,245,248,0.68)',
    textTertiary: 'rgba(242,245,248,0.42)',
    success: '#10B981',
    error: '#EF4444',
};
const SURFACE = { base: '#08090D', elevated: '#141821' };
const TYPOGRAPHY = {
    h1: { fontSize: 28, fontWeight: '800' as const, color: COLORS.textPrimary },
    h2: { fontSize: 22, fontWeight: '800' as const, color: COLORS.textPrimary },
    h3: { fontSize: 18, fontWeight: '700' as const, color: COLORS.textPrimary },
    body1: { fontSize: 15, fontWeight: '400' as const },
    body2: { fontSize: 13, fontWeight: '400' as const },
    overline: { fontSize: 11, fontWeight: '600' as const },
};

interface PendingDriver {
    id: string;
    name: string | null;
    phone_number: string | null;
    created_at: string;
    profile?: { full_name: string | null; email: string | null; phone_number: string | null } | null;
}

export function CommanderDashboardScreen() {
    const navigation = useNavigation();
    const { user } = useAuth();

    const [loading, setLoading] = useState(true);
    const [isCommander, setIsCommander] = useState(false);
    const [territory, setTerritory] = useState<any>(null);
    const [onboardingCode, setOnboardingCode] = useState<string>('');
    const [pendingDrivers, setPendingDrivers] = useState<PendingDriver[]>([]);
    const [actioningId, setActioningId] = useState<string | null>(null);
    const [metrics, setMetrics] = useState({
        active_drivers: 0,
        total_drivers: 0,
        active_pucks: 0,
        total_pucks: 0,
        active_merchants: 0,
        weekly_rides: 0,
    });

    const loadQueue = useCallback(async () => {
        const { data, error } = await supabase.functions.invoke('commander_get_driver_queue');
        if (!error && data?.success) {
            setPendingDrivers(data.pending_drivers || []);
        }
    }, []);

    const loadDashboard = useCallback(async () => {
        if (!user) return;
        setLoading(true);
        try {
            const { data: profile } = await supabase
                .from('profiles')
                .select('role')
                .eq('id', user.id)
                .single();

            if (profile?.role !== 'pod_commander') {
                setIsCommander(false);
                return;
            }

            setIsCommander(true);

            const { data, error } = await supabase.functions.invoke('commander_get_territory');
            if (error || !data?.success) {
                throw new Error(data?.error || error?.message || 'Failed to fetch territory data');
            }

            setTerritory(data.territory);
            setOnboardingCode(data.commander?.onboarding_code || '');
            setMetrics({
                active_drivers: data.metrics?.active_drivers || 0,
                total_drivers: data.metrics?.total_drivers || 0,
                active_pucks: data.metrics?.active_pucks || 0,
                total_pucks: data.metrics?.total_pucks || 0,
                active_merchants: data.metrics?.active_merchants || 0,
                weekly_rides: data.metrics?.weekly_rides || 0,
            });

            await loadQueue();
        } catch (err: any) {
            Alert.alert('Access Error', err.message);
            setIsCommander(false);
        } finally {
            setLoading(false);
        }
    }, [user, loadQueue]);

    useEffect(() => {
        loadDashboard();
    }, [loadDashboard]);

    const shareCode = async () => {
        if (!onboardingCode) return;
        try {
            await Share.share({
                message: `Join my G-Taxi territory as a driver. Enter my G-Lead code when you sign up: ${onboardingCode}`,
            });
        } catch {
            // user dismissed the share sheet — nothing to do
        }
    };

    const handleDriverAction = async (driverId: string, action: 'approve' | 'reject') => {
        setActioningId(driverId);
        try {
            const { data, error } = await supabase.functions.invoke('commander_onboard_driver', {
                body: { driver_id: driverId, action },
            });
            if (error || !data?.success) {
                throw new Error(data?.error || error?.message || 'Action failed');
            }
            // Optimistically drop the row, then refresh territory metrics.
            setPendingDrivers((prev) => prev.filter((d) => d.id !== driverId));
            await loadDashboard();
        } catch (err: any) {
            Alert.alert('Could not update driver', err.message);
        } finally {
            setActioningId(null);
        }
    };

    if (loading) {
        return (
            <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
                <ActivityIndicator color={COLORS.primary} size="large" />
            </View>
        );
    }

    if (!isCommander) {
        return (
            <SafeAreaView style={styles.container}>
                <View style={styles.header}>
                    <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
                        <ChevronLeft color={COLORS.textPrimary} size={28} />
                    </TouchableOpacity>
                </View>
                <View style={styles.notCommanderContainer}>
                    <ShieldCheck color={COLORS.error} size={64} style={{ opacity: 0.5, marginBottom: 16 }} />
                    <Text style={styles.notCommanderTitle}>Access Denied</Text>
                    <Text style={styles.notCommanderText}>
                        Your account does not have G-Lead privileges.
                        If you believe this is an error, please contact HQ.
                    </Text>
                </View>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={styles.container} edges={['top']}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
                    <ChevronLeft color={COLORS.textPrimary} size={28} />
                </TouchableOpacity>
                <View style={styles.headerTitleContainer}>
                    <ShieldCheck color={COLORS.primary} size={20} />
                    <Text style={styles.headerTitle}>G-LEAD CENTER</Text>
                </View>
                <View style={{ width: 40 }} />
            </View>

            <ScrollView contentContainerStyle={styles.scrollContent}>
                <View style={styles.territoryCard}>
                    <Text style={styles.territoryLabel}>ACTIVE TERRITORY</Text>
                    <Text style={styles.territoryName}>{territory?.name || 'Unassigned'}</Text>
                    <Text style={styles.territoryCode}>{territory?.code || '—'}</Text>
                </View>

                <View style={styles.metricsGrid}>
                    <View style={styles.metricBox}>
                        <Users color={COLORS.primary} size={24} style={styles.metricIcon} />
                        <Text style={styles.metricValue}>{metrics.active_drivers}<Text style={styles.metricTotal}>/{metrics.total_drivers}</Text></Text>
                        <Text style={styles.metricLabel}>ACTIVE DRIVERS</Text>
                    </View>
                    <View style={styles.metricBox}>
                        <Store color={COLORS.primary} size={24} style={styles.metricIcon} />
                        <Text style={styles.metricValue}>{metrics.active_merchants}</Text>
                        <Text style={styles.metricLabel}>G-PARTNERS</Text>
                    </View>
                    <View style={styles.metricBox}>
                        <Radio color={COLORS.primary} size={24} style={styles.metricIcon} />
                        <Text style={styles.metricValue}>{metrics.active_pucks}<Text style={styles.metricTotal}>/{metrics.total_pucks}</Text></Text>
                        <Text style={styles.metricLabel}>G-TOUCH POINTS</Text>
                    </View>
                    <View style={styles.metricBox}>
                        <Activity color={COLORS.primary} size={24} style={styles.metricIcon} />
                        <Text style={styles.metricValue}>{metrics.weekly_rides}</Text>
                        <Text style={styles.metricLabel}>RIDES (7 DAYS)</Text>
                    </View>
                </View>

                {/* ─── Register a new spot ─── */}
                <TouchableOpacity style={[styles.consoleButton, styles.registerButton]} onPress={() => (navigation as any).navigate('CommanderRegisterNode')}>
                    <View style={[styles.consoleIcon, { backgroundColor: '#E6B45015' }]}>
                        <Ionicons name="add-circle" size={22} color="#E6B450" />
                    </View>
                    <View style={{ flex: 1 }}>
                        <Text style={styles.consoleTitle}>Register New Spot</Text>
                        <Text style={styles.consoleSub}>Tap a tag on-site, capture GPS, send the merchant invite</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color={COLORS.textTertiary} />
                </TouchableOpacity>

                {/* ─── Full console ─── */}
                <TouchableOpacity style={styles.consoleButton} onPress={() => (navigation as any).navigate('CommanderConsole')}>
                    <View style={styles.consoleIcon}>
                        <Ionicons name="grid" size={22} color={COLORS.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                        <Text style={styles.consoleTitle}>Territory Console</Text>
                        <Text style={styles.consoleSub}>Health, drivers, pucks, merchants &amp; succession</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color={COLORS.textTertiary} />
                </TouchableOpacity>

                {/* ─── Recruit code ─── */}
                <Text style={styles.sectionTitle}>RECRUIT DRIVERS</Text>
                <View style={styles.codeCard}>
                    <Text style={styles.codeLabel}>YOUR G-LEAD CODE</Text>
                    <Text style={styles.codeValue}>{onboardingCode || '—'}</Text>
                    <Text style={styles.codeHelp}>
                        New drivers enter this code when they sign up to join your territory.
                    </Text>
                    <TouchableOpacity style={styles.shareButton} onPress={shareCode} disabled={!onboardingCode}>
                        <Ionicons name="share-outline" size={18} color={COLORS.background} />
                        <Text style={styles.shareButtonText}>SHARE CODE</Text>
                    </TouchableOpacity>
                </View>

                {/* ─── Pending driver queue ─── */}
                <Text style={styles.sectionTitle}>
                    PENDING DRIVERS{pendingDrivers.length > 0 ? ` (${pendingDrivers.length})` : ''}
                </Text>

                {pendingDrivers.length === 0 ? (
                    <View style={styles.emptyQueue}>
                        <Ionicons name="checkmark-done-outline" size={28} color={COLORS.textTertiary} />
                        <Text style={styles.emptyQueueText}>No drivers waiting for approval</Text>
                    </View>
                ) : (
                    pendingDrivers.map((d) => {
                        const isBusy = actioningId === d.id;
                        const displayName = d.profile?.full_name || d.name || 'New driver';
                        const phone = d.phone_number || d.profile?.phone_number || '—';
                        return (
                            <View key={d.id} style={styles.queueRow}>
                                <View style={styles.queueInfo}>
                                    <Text style={styles.queueName}>{displayName}</Text>
                                    <Text style={styles.queueMeta}>{phone}</Text>
                                </View>
                                <View style={styles.queueActions}>
                                    {isBusy ? (
                                        <ActivityIndicator color={COLORS.primary} />
                                    ) : (
                                        <>
                                            <TouchableOpacity
                                                style={[styles.queueBtn, styles.rejectBtn]}
                                                onPress={() => handleDriverAction(d.id, 'reject')}
                                            >
                                                <Ionicons name="close" size={18} color={COLORS.error} />
                                            </TouchableOpacity>
                                            <TouchableOpacity
                                                style={[styles.queueBtn, styles.approveBtn]}
                                                onPress={() => handleDriverAction(d.id, 'approve')}
                                            >
                                                <Ionicons name="checkmark" size={18} color={COLORS.background} />
                                            </TouchableOpacity>
                                        </>
                                    )}
                                </View>
                            </View>
                        );
                    })
                )}

                <View style={{ height: 32 }} />
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: SURFACE.base,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: COLORS.borderLight,
    },
    backButton: {
        padding: 4,
    },
    headerTitleContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    headerTitle: {
        ...TYPOGRAPHY.h3,
        fontSize: 16,
        letterSpacing: 2,
    },
    scrollContent: {
        padding: 24,
    },
    territoryCard: {
        backgroundColor: SURFACE.elevated,
        padding: 24,
        borderRadius: 24,
        alignItems: 'center',
        marginBottom: 24,
        borderWidth: 1,
        borderColor: COLORS.primary + '30',
    },
    territoryLabel: {
        ...TYPOGRAPHY.overline,
        color: COLORS.primary,
        letterSpacing: 2,
        marginBottom: 8,
    },
    territoryName: {
        ...TYPOGRAPHY.h1,
        fontSize: 28,
        color: COLORS.textPrimary,
        marginBottom: 4,
    },
    territoryCode: {
        ...TYPOGRAPHY.body2,
        color: COLORS.textTertiary,
        letterSpacing: 1,
    },
    metricsGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        marginBottom: 32,
    },
    metricBox: {
        width: '48%',
        backgroundColor: SURFACE.elevated,
        padding: 16,
        borderRadius: 16,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: COLORS.borderLight,
    },
    metricIcon: {
        marginBottom: 12,
        opacity: 0.8,
    },
    metricValue: {
        ...TYPOGRAPHY.h2,
        fontSize: 24,
        color: COLORS.textPrimary,
        marginBottom: 4,
    },
    metricTotal: {
        fontSize: 16,
        color: COLORS.textTertiary,
    },
    metricLabel: {
        ...TYPOGRAPHY.overline,
        color: COLORS.textSecondary,
        fontSize: 10,
    },
    sectionTitle: {
        ...TYPOGRAPHY.overline,
        color: COLORS.textSecondary,
        letterSpacing: 2,
        marginBottom: 16,
    },
    consoleButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        backgroundColor: SURFACE.elevated,
        padding: 18,
        borderRadius: 18,
        marginBottom: 32,
        borderWidth: 1,
        borderColor: COLORS.borderLight,
    },
    consoleIcon: {
        width: 44,
        height: 44,
        borderRadius: 12,
        backgroundColor: COLORS.primary + '15',
        alignItems: 'center',
        justifyContent: 'center',
    },
    registerButton: {
        borderColor: '#E6B45030',
        marginBottom: 16,
    },
    consoleTitle: {
        ...TYPOGRAPHY.h3,
        fontSize: 16,
        color: COLORS.textPrimary,
        marginBottom: 2,
    },
    consoleSub: {
        ...TYPOGRAPHY.body2,
        color: COLORS.textSecondary,
    },
    codeCard: {
        backgroundColor: SURFACE.elevated,
        padding: 24,
        borderRadius: 20,
        marginBottom: 32,
        borderWidth: 1,
        borderColor: COLORS.primary + '30',
        alignItems: 'center',
    },
    codeLabel: {
        ...TYPOGRAPHY.overline,
        color: COLORS.textSecondary,
        letterSpacing: 2,
        marginBottom: 8,
    },
    codeValue: {
        ...TYPOGRAPHY.h1,
        fontSize: 34,
        color: COLORS.primary,
        letterSpacing: 6,
        marginBottom: 12,
    },
    codeHelp: {
        ...TYPOGRAPHY.body2,
        color: COLORS.textTertiary,
        textAlign: 'center',
        marginBottom: 20,
        lineHeight: 18,
    },
    shareButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        backgroundColor: COLORS.primary,
        paddingVertical: 14,
        paddingHorizontal: 28,
        borderRadius: 100,
    },
    shareButtonText: {
        ...TYPOGRAPHY.body1,
        fontWeight: '700',
        color: COLORS.background,
        letterSpacing: 1,
    },
    emptyQueue: {
        alignItems: 'center',
        paddingVertical: 32,
        gap: 10,
    },
    emptyQueueText: {
        ...TYPOGRAPHY.body2,
        color: COLORS.textTertiary,
    },
    queueRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: SURFACE.elevated,
        padding: 16,
        borderRadius: 16,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: COLORS.borderLight,
    },
    queueInfo: {
        flex: 1,
    },
    queueName: {
        ...TYPOGRAPHY.h3,
        fontSize: 16,
        color: COLORS.textPrimary,
        marginBottom: 2,
    },
    queueMeta: {
        ...TYPOGRAPHY.body2,
        color: COLORS.textSecondary,
    },
    queueActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        minWidth: 88,
        justifyContent: 'flex-end',
    },
    queueBtn: {
        width: 40,
        height: 40,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    approveBtn: {
        backgroundColor: COLORS.primary,
    },
    rejectBtn: {
        backgroundColor: 'rgba(239,68,68,0.12)',
        borderWidth: 1,
        borderColor: 'rgba(239,68,68,0.30)',
    },
    notCommanderContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 32,
    },
    notCommanderTitle: {
        ...TYPOGRAPHY.h1,
        fontSize: 24,
        color: COLORS.error,
        marginBottom: 12,
    },
    notCommanderText: {
        ...TYPOGRAPHY.body1,
        color: COLORS.textSecondary,
        textAlign: 'center',
        lineHeight: 24,
    }
});
