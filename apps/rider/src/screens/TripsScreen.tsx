import React, { useEffect, useState } from 'react';
import { View, FlatList, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@gtaxi/core';
import { useAuth } from '../context/AuthContext';
import { useInTab } from '../navigation/useInTab';
import { Button, Card, EmptyState, GUTTER, Header, Loading, SPACE, Txt, useTheme } from '../ui/kit';

export function TripsScreen({ navigation }: any) {
    const inTab = useInTab(navigation);
    const { user } = useAuth();
    const insets = useSafeAreaInsets();

    const [trips, setTrips] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [loadError, setLoadError] = useState(false);

    useEffect(() => {
        if (user?.id) fetchTrips();
    }, [user?.id]);

    const fetchTrips = async () => {
        const { data, error } = await supabase
            .from('rides')
            .select('*')
            .eq('rider_id', user?.id)
            .order('created_at', { ascending: false })
            .limit(100); // older phones: don't draw an ever-growing history

        if (error) {
            setLoadError(true);
        } else if (data) {
            setLoadError(false);
            setTrips(data);
        }
        setLoading(false);
        setRefreshing(false);
    };

    const onRefresh = () => {
        setRefreshing(true);
        fetchTrips();
    };

    const m = useTheme();
    const statusText = (st: string) => ({
        completed: 'Completed', closed: 'Completed', payment_confirmed: 'Completed', cancelled: 'Cancelled', canceled: 'Cancelled',
        in_progress: 'In progress', assigned: 'Driver assigned', arrived: 'Driver arrived', searching: 'Searching', requested: 'Requested',
    } as Record<string, string>)[st] || st.replace(/_/g, ' ');

    const renderTrip = ({ item }: { item: any }) => {
        const date = new Date(item.created_at);
        const done = ['completed', 'closed', 'payment_confirmed'].includes(item.status);
        const cancelled = item.status === 'canceled' || item.status === 'cancelled';
        return (
            <Card style={{ marginBottom: SPACE.md }} onPress={() => { Haptics.selectionAsync(); navigation.navigate('Receipt', { rideId: item.id, ride: item }); }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Txt variant="caption" tone="dim">{date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} · {date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</Txt>
                    <Txt variant="headline">${((item.total_fare_cents || 0) / 100).toFixed(2)}</Txt>
                </View>
                <View style={{ marginTop: SPACE.sm }}>
                    <Txt variant="bodyStrong" numberOfLines={1}>{item.dropoff_address || 'Trip'}</Txt>
                    <Txt variant="caption" tone="dim" numberOfLines={1}>From {item.pickup_address || 'pickup'}</Txt>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: SPACE.md }}>
                    <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: done ? 'rgba(47,181,124,0.14)' : cancelled ? 'rgba(229,72,77,0.12)' : m.field }}>
                        <Txt variant="label" style={{ color: done ? '#2FB57C' : cancelled ? '#E5484D' : m.dim }}>{statusText(item.status)}</Txt>
                    </View>
                    <View style={{ flex: 1 }} />
                    <Ionicons name="chevron-forward" size={16} color={m.faint} />
                </View>
            </Card>
        );
    };

    return (
        <View style={{ flex: 1, backgroundColor: m.page }}>
            <StatusBar style={m.statusBar} />
            <Header title="Your trips" onBack={inTab ? undefined : () => navigation.goBack()} />
            {loading ? <Loading /> : (
                <FlatList<any>
                    data={trips}
                    keyExtractor={item => item.id}
                    renderItem={renderTrip}
                    contentContainerStyle={{ paddingHorizontal: GUTTER, paddingTop: SPACE.sm, paddingBottom: insets.bottom + SPACE.xxl }}
                    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={m.accent} colors={['#8B7CFF']} />}
                    ListEmptyComponent={
                        loadError
                            ? <EmptyState icon="cloud-offline-outline" title="Could not load your trips" body="Pull down to try again." />
                            : <EmptyState icon="car-outline" title="No trips yet" body="Your rides will show up here." action={<Button title="Book a ride" onPress={() => navigation.navigate('Home', { screen: 'Map' })} />} />
                    }
                />
            )}
        </View>
    );
}
