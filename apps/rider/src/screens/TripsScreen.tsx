import React, { useEffect, useState } from 'react';
import { View, StyleSheet, FlatList, SafeAreaView, ActivityIndicator } from 'react-native';
import { supabase } from '../../../../shared/supabase';
import { useAuth } from '../context/AuthContext';
import { tokens } from '../design-system/tokens';
import { Txt, Surface } from '../design-system/primitives';
import { Ionicons } from '@expo/vector-icons';

export function TripsScreen() {
    const { user } = useAuth();
    const [trips, setTrips] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (user?.id) {
            supabase
                .from('rides')
                .select('*')
                .eq('rider_id', user.id)
                .order('created_at', { ascending: false })
                .then(({ data, error }) => {
                    if (data && !error) setTrips(data);
                    setLoading(false);
                });
        }
    }, [user?.id]);

    if (loading) {
        return (
            <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
                <ActivityIndicator color={tokens.colors.primary.cyan} size="large" />
            </View>
        );
    }

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.header}>
                <Txt variant="headingL" weight="bold" color={tokens.colors.text.primary}>Your Trips</Txt>
            </View>

            {trips.length === 0 ? (
                <View style={styles.emptyState}>
                    <Ionicons name="car-outline" size={64} color={tokens.colors.text.tertiary} />
                    <Txt variant="bodyBold" color={tokens.colors.text.secondary} style={{ marginTop: 16 }}>No trips yet.</Txt>
                </View>
            ) : (
                <FlatList
                    data={trips}
                    keyExtractor={item => item.id}
                    contentContainerStyle={{ padding: 20 }}
                    renderItem={({ item }) => {
                        const date = new Date(item.created_at);
                        const statusColor = item.status === 'completed' || item.status === 'closed' ? tokens.colors.status.success :
                            item.status === 'canceled' ? tokens.colors.status.error : tokens.colors.primary.cyan;

                        return (
                            <Surface intensity={30} style={styles.tripCard}>
                                <View style={styles.tripHeader}>
                                    <Txt variant="caption" weight="bold" color={tokens.colors.text.secondary}>
                                        {date.toLocaleDateString()} at {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </Txt>
                                    <Txt variant="caption" weight="bold" color={statusColor}>
                                        {item.status.toUpperCase()}
                                    </Txt>
                                </View>

                                <View style={styles.routeContainer}>
                                    <View style={styles.routeTimeline}>
                                        <View style={[styles.dot, { backgroundColor: tokens.colors.primary.purple }]} />
                                        <View style={styles.line} />
                                        <View style={[styles.dot, { backgroundColor: tokens.colors.primary.cyan }]} />
                                    </View>
                                    <View style={styles.routeDetails}>
                                        <Txt variant="bodyReg" color={tokens.colors.text.primary} numberOfLines={1} style={{ marginBottom: 16 }}>
                                            {item.pickup_address || 'Pickup'}
                                        </Txt>
                                        <Txt variant="bodyReg" color={tokens.colors.text.primary} numberOfLines={1}>
                                            {item.dropoff_address || 'Dropoff'}
                                        </Txt>
                                    </View>
                                </View>

                                <View style={styles.tripFooter}>
                                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                        <Txt style={{ fontSize: 16 }}>
                                            {item.payment_method === 'cash' ? '💵' : item.payment_method === 'wallet' ? '👛' : '💳'}
                                        </Txt>
                                        <Txt variant="caption" color={tokens.colors.text.secondary}>
                                            {item.payment_method?.toUpperCase() || 'UNKNOWN'}
                                        </Txt>
                                    </View>
                                    <Txt variant="bodyBold" weight="bold" color={tokens.colors.text.primary}>
                                        ${((item.total_fare_cents || 0) / 100).toFixed(2)}
                                    </Txt>
                                </View>
                            </Surface>
                        );
                    }}
                />
            )}
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: tokens.colors.background.base },
    header: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 10 },
    emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    tripCard: { borderRadius: 16, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: tokens.colors.border.subtle },
    tripHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
    routeContainer: { flexDirection: 'row' },
    routeTimeline: { width: 24, alignItems: 'center', marginRight: 8, paddingVertical: 4 },
    dot: { width: 8, height: 8, borderRadius: 4 },
    line: { flex: 1, width: 2, backgroundColor: tokens.colors.border.subtle, marginVertical: 4 },
    routeDetails: { flex: 1, paddingVertical: 2 },
    tripFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: tokens.colors.border.subtle },
});
