import React, { useEffect, useState } from 'react';
import { View, StyleSheet, FlatList, ActivityIndicator, SafeAreaView, TouchableOpacity } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { tokens } from '../design-system/tokens';
import { Txt, Surface } from '../design-system/primitives';
import { supabase } from '../../../../shared/supabase';
import { Alert } from 'react-native';

interface ScheduledRide {
    id: string;
    pickup_address: string;
    dropoff_address: string;
    total_fare_cents: number;
    scheduled_for: string;
}

export function ScheduledRidesScreen({ navigation }: any) {
    const [rides, setRides] = useState<ScheduledRide[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchScheduled = async () => {
            const { data } = await supabase
                .from('rides')
                .select('id, pickup_address, dropoff_address, total_fare_cents, scheduled_for')
                .eq('status', 'scheduled')
                // .gte('scheduled_for', new Date().toISOString()) // Optional filter for future
                .order('scheduled_for', { ascending: true })
                .limit(20);

            if (data) setRides(data);
            setLoading(false);
        };

        fetchScheduled();
    }, []);

    const handleClaim = (rideId: string) => {
        Alert.alert(
            "Claim Ride",
            "Are you sure you want to lock in this scheduled ride? You will be penalized if you are not online 15 minutes prior.",
            [
                { text: "Cancel", style: "cancel" },
                { text: "Confirm", style: "default", onPress: () => Alert.alert("Coming Soon", "Scheduled Dispatch assignment logic is slated for V2.") }
            ]
        );
    };

    const renderItem = ({ item }: { item: ScheduledRide }) => {
        const fare = (item.total_fare_cents / 100).toFixed(2);
        const dateObj = new Date(item.scheduled_for);
        const day = dateObj.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
        const time = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        return (
            <Surface style={styles.card} intensity={25}>
                <View style={styles.cardHeader}>
                    <View style={styles.timeBadge}>
                        <Txt variant="caption" weight="bold" color={tokens.colors.background.base}>{day}</Txt>
                        <Txt variant="bodyBold" weight="heavy" color={tokens.colors.background.base}>{time}</Txt>
                    </View>
                    <Txt variant="headingM" weight="bold" color={tokens.colors.primary.purple}>
                        ${fare}
                    </Txt>
                </View>

                <View style={styles.routeContainer}>
                    <View style={styles.routeLine}>
                        <View style={styles.dotPickup} />
                        <View style={styles.line} />
                        <View style={styles.dotDropoff} />
                    </View>
                    <View style={styles.addresses}>
                        <Txt variant="bodyBold" color={tokens.colors.text.primary} numberOfLines={1}>{item.pickup_address}</Txt>
                        <Txt variant="caption" color={tokens.colors.text.tertiary} style={{ marginBottom: 12 }}>Pickup</Txt>

                        <Txt variant="bodyBold" color={tokens.colors.text.primary} numberOfLines={1}>{item.dropoff_address}</Txt>
                        <Txt variant="caption" color={tokens.colors.text.tertiary}>Dropoff</Txt>
                    </View>
                </View>

                <TouchableOpacity
                    style={styles.claimBtn}
                    onPress={() => handleClaim(item.id)}
                >
                    <Txt variant="bodyBold" color={tokens.colors.background.base}>Claim Assignment</Txt>
                </TouchableOpacity>
            </Surface>
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
                <Txt variant="headingL" weight="bold" color={tokens.colors.text.primary}>Scheduled</Txt>
                <View style={{ width: 60 }} />
            </View>

            <View style={styles.infoBanner}>
                <Txt variant="caption" color={tokens.colors.status.warning} style={{ textAlign: 'center' }}>
                    Claiming a scheduled ride requires you to be online near the pickup zone 15 minutes before departure.
                </Txt>
            </View>

            {loading ? (
                <View style={styles.loader}>
                    <ActivityIndicator size="large" color={tokens.colors.primary.cyan} />
                </View>
            ) : (
                <FlatList
                    data={rides}
                    keyExtractor={t => t.id}
                    renderItem={renderItem}
                    contentContainerStyle={styles.listContent}
                    showsVerticalScrollIndicator={false}
                    ListEmptyComponent={
                        <View style={styles.emptyState}>
                            <Txt variant="bodyReg" color={tokens.colors.text.tertiary}>No scheduled rides available.</Txt>
                        </View>
                    }
                />
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
    infoBanner: {
        paddingHorizontal: 24,
        paddingBottom: 16,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255,255,255,0.05)',
    },
    listContent: {
        padding: 20,
        gap: 16,
    },
    card: {
        padding: 20,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.05)',
    },
    cardHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 20,
    },
    timeBadge: {
        backgroundColor: tokens.colors.primary.cyan,
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 12,
        alignItems: 'center',
    },
    routeContainer: {
        flexDirection: 'row',
        marginBottom: 24,
    },
    routeLine: {
        alignItems: 'center',
        marginRight: 16,
        marginTop: 6,
    },
    dotPickup: {
        width: 10,
        height: 10,
        borderRadius: 5,
        backgroundColor: tokens.colors.primary.purple,
    },
    line: {
        width: 2,
        flex: 1,
        backgroundColor: 'rgba(255,255,255,0.1)',
        marginVertical: 4,
    },
    dotDropoff: {
        width: 10,
        height: 10,
        backgroundColor: tokens.colors.status.warning,
    },
    addresses: {
        flex: 1,
        justifyContent: 'space-between',
    },
    claimBtn: {
        backgroundColor: tokens.colors.primary.cyan,
        paddingVertical: 14,
        borderRadius: 16,
        alignItems: 'center',
    },
    loader: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    emptyState: {
        padding: 60,
        alignItems: 'center',
    }
});
