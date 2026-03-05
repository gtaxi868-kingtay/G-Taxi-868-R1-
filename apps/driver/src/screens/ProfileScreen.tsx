import React, { useEffect, useState } from 'react';
import { View, StyleSheet, SafeAreaView, TouchableOpacity, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { tokens } from '../design-system/tokens';
import { Txt, Surface } from '../design-system/primitives';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../../../../shared/supabase';

interface DriverProfile {
    name: string;
    vehicle_model: string;
    plate_number: string;
    vehicle_type: string;
    lifetime_trips: number;
    lifetime_earnings: number;
    cancellation_count: number;
}

export function ProfileScreen({ navigation }: any) {
    const { driver, signOut } = useAuth();
    const [profile, setProfile] = useState<DriverProfile | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!driver?.id) return;

        const loadProfileData = async () => {
            try {
                // 1. Fetch Vehicle Data from drivers table
                const { data: driverData } = await supabase
                    .from('drivers')
                    .select('name, vehicle_model, plate_number, vehicle_type')
                    .eq('id', driver.id)
                    .single();

                // 2. Fetch Lifetime metrics from rides table
                const { data: ridesData } = await supabase
                    .from('rides')
                    .select('total_fare_cents')
                    .eq('driver_id', driver.id)
                    .eq('status', 'completed');

                // 3. Fetch Cancellation count from profiles
                const { data: profileData } = await supabase
                    .from('profiles')
                    .select('cancellation_count')
                    .eq('id', driver.id)
                    .single();

                const totalTrips = ridesData ? ridesData.length : 0;
                // Driver keeps 85%
                const totalEarningsCents = ridesData ? ridesData.reduce((acc, r) => acc + (r.total_fare_cents || 0), 0) * 0.85 : 0;

                setProfile({
                    name: driverData?.name || driver.name || 'Driver',
                    vehicle_model: driverData?.vehicle_model || 'Unknown Model',
                    plate_number: driverData?.plate_number || 'UNKNOWN',
                    vehicle_type: driverData?.vehicle_type || 'STANDARD',
                    lifetime_trips: totalTrips,
                    lifetime_earnings: totalEarningsCents / 100,
                    cancellation_count: profileData?.cancellation_count || 0
                });
            } catch (err) {
                console.error("Error loading profile:", err);
            } finally {
                setLoading(false);
            }
        };

        loadProfileData();
    }, [driver?.id]);

    const handleLogout = () => {
        Alert.alert(
            'Log Out',
            'Are you sure you want to log out?',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Log Out',
                    style: 'destructive',
                    onPress: async () => {
                        await signOut();
                        // AuthContext will handle state change -> navigation reset
                    },
                },
            ]
        );
    };

    return (
        <SafeAreaView style={styles.container}>
            <StatusBar style="light" />

            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
                    <Surface style={styles.backSurface} intensity={40}>
                        <Txt variant="bodyBold" color={tokens.colors.text.primary}>← Back</Txt>
                    </Surface>
                </TouchableOpacity>
                <Txt variant="headingL" weight="bold" color={tokens.colors.text.primary}>Profile</Txt>
                <View style={{ width: 60 }} />
            </View>

            {loading ? (
                <View style={styles.loader}>
                    <ActivityIndicator size="large" color={tokens.colors.primary.purple} />
                </View>
            ) : (
                <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

                    {/* Identity Card */}
                    <View style={styles.identitySection}>
                        <View style={{ width: 96, height: 96, borderRadius: 48, backgroundColor: 'rgba(0, 200, 150, 0.15)', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: tokens.colors.primary.purple }}>
                            <Txt variant="displayXL" weight="bold" color={tokens.colors.primary.purple}>
                                {profile?.name?.charAt(0)?.toUpperCase() || 'D'}
                            </Txt>
                        </View>
                        <Txt variant="headingL" weight="bold" color={tokens.colors.text.primary} style={{ marginTop: 16 }}>
                            {profile?.name}
                        </Txt>
                        <View style={styles.ratingBadge}>
                            <Txt variant="bodyBold" weight="bold" color={tokens.colors.background.base}>★ 5.00</Txt>
                        </View>
                    </View>

                    {/* Operational Metrics */}
                    <View style={styles.metricsGrid}>
                        <Surface style={styles.metricCard} intensity={20}>
                            <Txt variant="headingL" weight="bold" color={tokens.colors.primary.cyan}>
                                {profile?.lifetime_trips}
                            </Txt>
                            <Txt variant="caption" color={tokens.colors.text.secondary} style={{ marginTop: 4 }}>
                                LIFETIME TRIPS
                            </Txt>
                        </Surface>

                        <Surface style={styles.metricCard} intensity={20}>
                            <Txt variant="headingL" weight="bold" color={tokens.colors.primary.purple}>
                                ${profile?.lifetime_earnings.toFixed(2)}
                            </Txt>
                            <Txt variant="caption" color={tokens.colors.text.secondary} style={{ marginTop: 4 }}>
                                TOTAL EARNED
                            </Txt>
                        </Surface>
                    </View>

                    <Surface style={[styles.metricCard, { marginTop: 16 }]} intensity={20}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                            <Txt variant="bodyBold" color={tokens.colors.text.primary}>Cancellation Rate</Txt>
                            <Txt variant="headingM" weight="bold" color={profile && profile.cancellation_count > 5 ? tokens.colors.status.error : tokens.colors.status.success}>
                                {profile?.cancellation_count} Faults
                            </Txt>
                        </View>
                    </Surface>

                    {/* Vehicle Details */}
                    <Txt variant="bodyBold" color={tokens.colors.text.secondary} style={styles.sectionTitle}>
                        REGISTERED VEHICLE
                    </Txt>

                    <Surface style={styles.vehicleCard} intensity={25}>
                        <View style={styles.vehicleRow}>
                            <Txt variant="caption" color={tokens.colors.text.tertiary}>MODEL</Txt>
                            <Txt variant="bodyBold" color={tokens.colors.text.primary}>{profile?.vehicle_model}</Txt>
                        </View>
                        <View style={styles.divider} />
                        <View style={styles.vehicleRow}>
                            <Txt variant="caption" color={tokens.colors.text.tertiary}>LICENSE PLATE</Txt>
                            <View style={styles.plateBadge}>
                                <Txt variant="headingM" weight="heavy" color="#000" style={{ letterSpacing: 2 }}>
                                    {profile?.plate_number}
                                </Txt>
                            </View>
                        </View>
                        <View style={styles.divider} />
                        <View style={styles.vehicleRow}>
                            <Txt variant="caption" color={tokens.colors.text.tertiary}>CLASS</Txt>
                            <View style={styles.classBadge}>
                                <Txt variant="caption" weight="heavy" color={tokens.colors.primary.purple}>
                                    {profile?.vehicle_type.toUpperCase()}
                                </Txt>
                            </View>
                        </View>
                    </Surface>

                    {/* Log Out Button */}
                    <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} activeOpacity={0.8}>
                        <Txt variant="bodyBold" color={tokens.colors.status.error}>Log Out</Txt>
                    </TouchableOpacity>

                    <View style={{ height: 40 }} />
                </ScrollView>
            )}
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: tokens.colors.background.base,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        paddingVertical: 16,
    },
    backBtn: {
        shadowColor: tokens.colors.primary.purple,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2,
        shadowRadius: 12,
        elevation: 8,
    },
    backSurface: {
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: 20,
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: tokens.colors.border.subtle,
    },
    loader: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    scrollContent: {
        padding: 24,
    },
    identitySection: {
        alignItems: 'center',
        marginBottom: 32,
    },
    avatar: {
        width: 96,
        height: 96,
        borderRadius: 48,
        backgroundColor: tokens.colors.background.surface,
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 2,
        borderColor: tokens.colors.border.subtle,
    },
    ratingBadge: {
        backgroundColor: tokens.colors.primary.cyan,
        paddingHorizontal: 16,
        paddingVertical: 6,
        borderRadius: 20,
        marginTop: 12,
        shadowColor: tokens.colors.primary.cyan,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 4,
    },
    metricsGrid: {
        flexDirection: 'row',
        gap: 16,
    },
    metricCard: {
        flex: 1,
        padding: 24,
        borderRadius: 20,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.05)',
    },
    sectionTitle: {
        marginTop: 32,
        marginBottom: 16,
        letterSpacing: 1,
    },
    vehicleCard: {
        borderRadius: 20,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.05)',
        paddingVertical: 8,
    },
    vehicleRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingVertical: 16,
    },
    divider: {
        height: 1,
        backgroundColor: 'rgba(255,255,255,0.05)',
    },
    plateBadge: {
        backgroundColor: tokens.colors.status.warning,
        paddingHorizontal: 12,
        paddingVertical: 4,
        borderRadius: 8,
    },
    classBadge: {
        backgroundColor: 'rgba(159, 85, 255, 0.15)',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: tokens.colors.primary.purple,
    },
    logoutBtn: {
        marginTop: 32,
        paddingVertical: 16,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: 'rgba(255, 69, 58, 0.3)',
        backgroundColor: 'rgba(255, 69, 58, 0.08)',
        alignItems: 'center',
        justifyContent: 'center',
    },
});
