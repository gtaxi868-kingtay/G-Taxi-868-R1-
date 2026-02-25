import React, { useEffect, useState } from 'react';
import { View, StyleSheet, FlatList, TouchableOpacity, SafeAreaView, Dimensions } from 'react-native';
import { Surface, Txt, Card } from '../design-system/primitives';
import { tokens } from '../design-system/tokens';
import { getRideHistory, formatCurrency } from '../services/api';
import { LinearGradient } from 'expo-linear-gradient';

const { width } = Dimensions.get('window');

export function TripsScreen({ navigation }: any) {
    const [trips, setTrips] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadTrips();
    }, []);

    const loadTrips = async () => {
        const history = await getRideHistory();
        setTrips(history);
        setLoading(false);
    };

    const renderItem = ({ item }: { item: any }) => {
        const date = new Date(item.created_at).toLocaleDateString('en-GB', {
            day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
        });

        // T&T Context: Show if it was Cash or Card
        const paymentLabel = item.payment_method === 'cash' ? '💵 Cash' : '💳 Card';
        const color = item.status === 'completed' ? tokens.colors.status.success : tokens.colors.status.error;

        return (
            <TouchableOpacity
                activeOpacity={0.7}
                style={{ marginBottom: 12 }}
                onPress={() => navigation.navigate('Receipt', { ride: item })}
            >
                <Card style={styles.card} padding="md" elevation="level1">
                    <View style={styles.row}>
                        <View style={styles.iconBox}>
                            <Txt style={{ fontSize: 20 }}>🚗</Txt>
                        </View>
                        <View style={{ flex: 1, marginLeft: 12 }}>
                            <Txt variant="bodyBold">{date}</Txt>
                            <Txt variant="caption" color={tokens.colors.text.secondary} numberOfLines={1}>
                                {item.dropoff_address}
                            </Txt>
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                            <Txt variant="bodyBold">{formatCurrency(item.total_fare_cents || item.estimated_fare_cents)}</Txt>
                            <Txt variant="small" style={{ color: color }}>{item.status.toUpperCase()}</Txt>
                        </View>
                    </View>

                    {/* Route Details Line */}
                    <View style={styles.routeLine}>
                        <View style={styles.dot} />
                        <Txt variant="small" color={tokens.colors.text.tertiary} style={{ flex: 1, marginLeft: 8 }} numberOfLines={1}>
                            {item.pickup_address || 'Current Location'}
                        </Txt>
                    </View>
                </Card>
            </TouchableOpacity>
        );
    };

    return (
        <View style={styles.container}>
            <LinearGradient
                colors={[tokens.colors.background.base, '#1A1A24']}
                style={StyleSheet.absoluteFill}
            />

            <SafeAreaView style={{ flex: 1 }}>
                {/* Header */}
                <View style={styles.header}>
                    <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
                        <Surface style={styles.backSurf} intensity={20}>
                            <Txt variant="headingM">←</Txt>
                        </Surface>
                    </TouchableOpacity>
                    <Txt variant="headingL" weight="bold">Your Trips</Txt>
                </View>

                {/* List */}
                <FlatList
                    data={trips}
                    renderItem={renderItem}
                    keyExtractor={item => item.id}
                    contentContainerStyle={styles.list}
                    refreshing={loading}
                    onRefresh={loadTrips}
                    ListEmptyComponent={
                        !loading ? (
                            <View style={styles.empty}>
                                <Txt style={{ fontSize: 40, marginBottom: 16 }}>📭</Txt>
                                <Txt variant="bodyBold">No trips yet</Txt>
                                <Txt variant="caption" color={tokens.colors.text.secondary}>Your ride history will appear here.</Txt>
                            </View>
                        ) : null
                    }
                />
            </SafeAreaView>
        </View>
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
        padding: 20,
    },
    backBtn: {
        marginRight: 16,
    },
    backSurf: {
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
    },
    list: {
        padding: 20,
    },
    card: {
        backgroundColor: 'rgba(255,255,255,0.03)',
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    iconBox: {
        width: 40,
        height: 40,
        borderRadius: 8,
        backgroundColor: 'rgba(255,255,255,0.1)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    routeLine: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 12,
        paddingTop: 12,
        borderTopWidth: 1,
        borderTopColor: 'rgba(255,255,255,0.05)',
    },
    dot: {
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: tokens.colors.primary.purple,
    },
    empty: {
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 100,
    }
});
