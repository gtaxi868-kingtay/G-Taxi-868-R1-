import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { View, TextInput, Pressable, RefreshControl, ScrollView } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { supabase } from '@gtaxi/core';
import { useAuth } from '../context/AuthContext';
import { Button, Card, Chip, EmptyState, FONT, GUTTER, Header, Loading, RADIUS, Row, Section, SPACE, Txt, useTheme } from '../ui/kit';
import { formatTTDDollars } from '../utils/currency';


const CUISINES = [
    { id: 'all',      label: 'All',      icon: 'grid-outline' },
    { id: 'local',    label: 'Trini',    icon: 'flag-outline' },
    { id: 'indian',   label: 'Indian',   icon: 'restaurant-outline' },
    { id: 'chinese',  label: 'Chinese',  icon: 'restaurant-outline' },
    { id: 'american', label: 'American', icon: 'fast-food-outline' },
    { id: 'pizza',    label: 'Pizza',    icon: 'pizza-outline' },
    { id: 'seafood',  label: 'Seafood',  icon: 'fish-outline' },
    { id: 'bakery',   label: 'Bakery',   icon: 'cafe-outline' },
    { id: 'creole',   label: 'Creole',   icon: 'leaf-outline' },
] as const;

interface Restaurant {
    id: string;
    name: string;
    category: string;
    address: string;
    delivery_fee_cents: number;
    avg_delivery_minutes: number;
    is_open: boolean;
    distance_meters?: number;
    order_count?: number;
}

interface RecentOrder {
    merchant_id: string;
    merchant_name: string;
    last_ordered_at: string;
}

function etaLabel(mins: number): string {
    if (mins <= 0) return '—';
    return `${mins}–${mins + 10} min`;
}

function feeLabel(cents: number): string {
    if (cents === 0) return 'Free delivery';
    return `${formatTTDDollars(cents)} delivery`;
}

function distanceLabel(meters?: number): string {
    if (!meters) return '';
    if (meters < 1000) return `${Math.round(meters)}m`;
    return `${(meters / 1000).toFixed(1)}km`;
}

export function FoodDeliveryScreen({ navigation }: any) {
    const insets = useSafeAreaInsets();
    const { user } = useAuth();

    const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
    const [recentOrders, setRecentOrders] = useState<RecentOrder[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [fetchError, setFetchError] = useState<string | null>(null);
    const [selectedCuisine, setSelectedCuisine] = useState<string>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);

    const searchRef = useRef<TextInput>(null);

    useEffect(() => {
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
            .then(loc => setUserLocation({ lat: loc.coords.latitude, lng: loc.coords.longitude }))
            .catch(() => {});
    }, []);

    const fetchRestaurants = useCallback(async () => {
        try {
            setFetchError(null);
            const query = supabase
                .from('merchants')
                .select('id, name, category, address, delivery_fee_cents, avg_delivery_minutes, is_open')
                .in('category', ['restaurant', 'local', 'indian', 'chinese', 'american', 'pizza', 'seafood', 'bakery', 'creole'])
                .eq('is_active', true)
                .order('is_open', { ascending: false })
                .order('name', { ascending: true });

            const { data, error } = await query;
            if (error) throw error;

            setRestaurants((data || []) as Restaurant[]);

            if (user?.id) {
                const { data: orders } = await supabase
                    .from('orders')
                    .select('merchant_id, created_at, merchants(name)')
                    .eq('rider_id', user.id)
                    .order('created_at', { ascending: false })
                    .limit(20);

                if (orders && orders.length > 0) {
                    const seen = new Set<string>();
                    const recent: RecentOrder[] = [];
                    for (const o of orders) {
                        if (!seen.has(o.merchant_id)) {
                            seen.add(o.merchant_id);
                            recent.push({
                                merchant_id: o.merchant_id,
                                merchant_name: (o.merchants as any)?.name ?? 'Restaurant',
                                last_ordered_at: o.created_at,
                            });
                        }
                        if (recent.length >= 4) break;
                    }
                    setRecentOrders(recent);
                }
            }
        } catch (err) {
            setFetchError('Could not load restaurants. Check your connection.');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [user?.id]);

    useEffect(() => { fetchRestaurants(); }, [fetchRestaurants]);

    const filtered = useMemo(() => {
        let list = restaurants;
        if (selectedCuisine !== 'all') {
            list = list.filter(r => r.category === selectedCuisine);
        }
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            list = list.filter(r =>
                // address (and possibly others) can be NULL on live shops;
                // calling toLowerCase on null crashed the search box.
                (r.name || '').toLowerCase().includes(q) ||
                (r.address || '').toLowerCase().includes(q) ||
                (r.category || '').toLowerCase().includes(q)
            );
        }
        return list;
    }, [restaurants, selectedCuisine, searchQuery]);

    const openRestaurants = useMemo(() => filtered.filter(r => r.is_open), [filtered]);
    const closedRestaurants = useMemo(() => filtered.filter(r => !r.is_open), [filtered]);

    const handlePickRestaurant = useCallback((restaurant: Restaurant) => {
        if (!restaurant.is_open) {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            return;
        }
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        navigation.navigate('ProductListing', { merchant: restaurant });
    }, [navigation]);

    const m = useTheme();

    const renderCard = ({ item, index, last }: { item: Restaurant; index: number; last: boolean }) => (
        <Row
            key={item.id}
            icon="restaurant-outline"
            title={item.name}
            subtitle={[item.is_open ? etaLabel(item.avg_delivery_minutes) : 'Closed now', item.address, distanceLabel(item.distance_meters)].filter(Boolean).join(' · ')}
            last={last}
            onPress={item.is_open ? () => handlePickRestaurant(item) : undefined}
            right={item.is_open ? undefined : <Txt variant="label" tone="faint">Closed</Txt>}
        />
    );

    const header = (
        <>
            <View style={{ flexDirection: 'row', alignItems: 'center', height: 52, borderRadius: RADIUS.pill, backgroundColor: m.field, paddingHorizontal: SPACE.lg, marginTop: SPACE.sm }}>
                <Ionicons name="search" size={18} color={m.searchIcon} />
                <TextInput
                    ref={searchRef}
                    style={{ flex: 1, height: '100%', marginLeft: SPACE.sm, color: m.ink, fontFamily: FONT.medium, fontSize: 16 }}
                    placeholder="Search restaurants"
                    placeholderTextColor={m.faint}
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    returnKeyType="search"
                    accessibilityLabel="Search restaurants"
                />
                {searchQuery.length > 0 && (
                    <Pressable accessibilityRole="button" accessibilityLabel="Clear search" hitSlop={8} onPress={() => setSearchQuery('')}>
                        <Ionicons name="close-circle" size={18} color={m.faint} />
                    </Pressable>
                )}
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -GUTTER, marginTop: SPACE.md }} contentContainerStyle={{ paddingHorizontal: GUTTER }}>
                {CUISINES.map(c => (
                    <Chip key={c.id} label={c.label} selected={selectedCuisine === c.id} onPress={() => { Haptics.selectionAsync(); setSelectedCuisine(c.id); }} />
                ))}
            </ScrollView>

            {recentOrders.length > 0 && !searchQuery && (
                <Section title="Order again" style={{ marginTop: SPACE.md }}>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                        {recentOrders.map(o => {
                            const r = restaurants.find(x => x.id === o.merchant_id);
                            return <Chip key={o.merchant_id} icon="refresh-outline" label={o.merchant_name} onPress={() => r && handlePickRestaurant(r)} />;
                        })}
                    </View>
                </Section>
            )}
        </>
    );

    return (
        <View style={{ flex: 1, backgroundColor: m.page }}>
            <StatusBar style={m.statusBar} />
            <Header title="Food" onBack={() => navigation.goBack()} />
            {loading ? <Loading /> : (
                <ScrollView
                    contentContainerStyle={{ paddingHorizontal: GUTTER, paddingBottom: insets.bottom + SPACE.xxl }}
                    keyboardShouldPersistTaps="handled"
                    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchRestaurants(); }} tintColor={m.accent} />}
                >
                    {header}
                    {fetchError ? (
                        <EmptyState icon="cloud-offline-outline" title="Could not load restaurants" body="Check your connection and try again."
                            action={<Button title="Try again" variant="secondary" onPress={fetchRestaurants} />} />
                    ) : filtered.length === 0 ? (
                        <EmptyState icon="restaurant-outline" title={restaurants.length ? 'No matches' : 'No restaurants yet'}
                            body={restaurants.length ? 'Try another cuisine or search.' : 'Restaurants near you will show up here.'} />
                    ) : (
                        <>
                            {openRestaurants.length > 0 && (
                                <Section title={`Open now · ${openRestaurants.length}`}>
                                    <Card style={{ paddingVertical: SPACE.xs }}>
                                        {openRestaurants.map((r, i) => renderCard({ item: r, index: i, last: i === openRestaurants.length - 1 }))}
                                    </Card>
                                </Section>
                            )}
                            {closedRestaurants.length > 0 && (
                                <Section title={`Closed · ${closedRestaurants.length}`}>
                                    <Card style={{ paddingVertical: SPACE.xs, opacity: 0.7 }}>
                                        {closedRestaurants.map((r, i) => renderCard({ item: r, index: i, last: i === closedRestaurants.length - 1 }))}
                                    </Card>
                                </Section>
                            )}
                            <Txt variant="caption" tone="faint" style={{ textAlign: 'center', marginTop: SPACE.lg }}>Delivery is priced by distance and shown before you order.</Txt>
                        </>
                    )}
                </ScrollView>
            )}
        </View>
    );
}
