import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
    View, Text, FlatList, TouchableOpacity, StyleSheet,
    ActivityIndicator, useWindowDimensions, TextInput,
    RefreshControl, ScrollView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { supabase } from '@gtaxi/core';
import { useAuth } from '../context/AuthContext';
import { ghostBorder, elevationGlow } from '@gtaxi/design-system/utils/style-rules';
import { SURFACE, VOICES, ANIMATION } from '@gtaxi/design-system';
import { formatTTDDollars } from '../utils/currency';

const CYAN = '#06B6D4';
const ORANGE = '#F97316';

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
    const { width } = useWindowDimensions();
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
                    .eq('user_id', user.id)
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
                r.name.toLowerCase().includes(q) ||
                r.address.toLowerCase().includes(q) ||
                r.category.toLowerCase().includes(q)
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

    const renderCard = useCallback(({ item }: { item: Restaurant }) => (
        <TouchableOpacity
            style={[s.card, !item.is_open && s.cardClosed]}
            activeOpacity={item.is_open ? 0.8 : 0.5}
            onPress={() => handlePickRestaurant(item)}
        >
            <View style={s.cardIconWrap}>
                <LinearGradient
                    colors={item.is_open
                        ? ['rgba(249,115,22,0.2)', 'rgba(249,115,22,0.06)']
                        : ['rgba(100,100,100,0.12)', 'rgba(100,100,100,0.04)']}
                    style={s.cardIconBg}
                >
                    <Ionicons
                        name="restaurant-sharp"
                        size={28}
                        color={item.is_open ? ORANGE : '#555'}
                    />
                </LinearGradient>
            </View>
            <View style={s.cardBody}>
                <View style={s.cardTitleRow}>
                    <Text style={[s.cardName, !item.is_open && s.cardNameClosed]} numberOfLines={1}>
                        {item.name}
                    </Text>
                    {!item.is_open && (
                        <View style={s.closedBadge}>
                            <Text style={s.closedBadgeText}>Closed</Text>
                        </View>
                    )}
                </View>
                <Text style={s.cardAddress} numberOfLines={1}>{item.address}</Text>
                <View style={s.cardMeta}>
                    <View style={s.metaChip}>
                        <Ionicons name="time-outline" size={11} color="#888" />
                        <Text style={s.metaText}>{etaLabel(item.avg_delivery_minutes)}</Text>
                    </View>
                    <View style={[s.metaChip, item.delivery_fee_cents === 0 && s.metaChipFree]}>
                        <Ionicons
                            name="bicycle-outline"
                            size={11}
                            color={item.delivery_fee_cents === 0 ? '#22C55E' : '#888'}
                        />
                        <Text style={[s.metaText, item.delivery_fee_cents === 0 && s.metaTextFree]}>
                            {feeLabel(item.delivery_fee_cents)}
                        </Text>
                    </View>
                    {item.distance_meters !== undefined && (
                        <Text style={s.metaDistance}>{distanceLabel(item.distance_meters)}</Text>
                    )}
                </View>
            </View>
            {item.is_open && (
                <Ionicons name="chevron-forward" size={18} color="#444" style={s.cardChevron} />
            )}
        </TouchableOpacity>
    ), [handlePickRestaurant]);

    const renderRecentChip = useCallback((item: RecentOrder) => {
        const restaurant = restaurants.find(r => r.id === item.merchant_id);
        return (
            <TouchableOpacity
                key={item.merchant_id}
                style={s.recentChip}
                activeOpacity={0.8}
                onPress={() => {
                    if (restaurant) handlePickRestaurant(restaurant);
                }}
            >
                <Ionicons name="refresh-outline" size={13} color={ORANGE} />
                <Text style={s.recentChipText} numberOfLines={1}>{item.merchant_name}</Text>
            </TouchableOpacity>
        );
    }, [restaurants, handlePickRestaurant]);

    if (loading) {
        return (
            <View style={[s.root, { paddingTop: insets.top }]}>
                <View style={s.header}>
                    <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()}>
                        <Ionicons name="arrow-back" size={22} color={VOICES.rider.accent} />
                    </TouchableOpacity>
                    <Text style={s.headerTitle}>Food Delivery</Text>
                </View>
                <ActivityIndicator color={ORANGE} style={{ marginTop: 40 }} />
            </View>
        );
    }

    return (
        <View style={[s.root, { paddingTop: insets.top }]}>
            <View style={s.header}>
                <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()}>
                    <Ionicons name="arrow-back" size={22} color={VOICES.rider.accent} />
                </TouchableOpacity>
                <Text style={s.headerTitle}>Food Delivery</Text>
                <View style={s.headerBadge}>
                    <Text style={s.headerBadgeText}>Beats foodDROP</Text>
                </View>
            </View>

            <View style={s.searchWrap}>
                <Ionicons name="search-outline" size={16} color="#666" style={s.searchIcon} />
                <TextInput
                    ref={searchRef}
                    style={s.searchInput}
                    placeholder="Search restaurants..."
                    placeholderTextColor="#555"
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    returnKeyType="search"
                />
                {searchQuery.length > 0 && (
                    <TouchableOpacity onPress={() => setSearchQuery('')}>
                        <Ionicons name="close-circle" size={16} color="#555" />
                    </TouchableOpacity>
                )}
            </View>

            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={s.cuisineRow}
            >
                {CUISINES.map(c => (
                    <TouchableOpacity
                        key={c.id}
                        style={[s.cuisineChip, selectedCuisine === c.id && s.cuisineChipActive]}
                        onPress={() => {
                            Haptics.selectionAsync();
                            setSelectedCuisine(c.id);
                        }}
                    >
                        <Text style={[s.cuisineLabel, selectedCuisine === c.id && s.cuisineLabelActive]}>
                            {c.label}
                        </Text>
                    </TouchableOpacity>
                ))}
            </ScrollView>

            {recentOrders.length > 0 && !searchQuery && (
                <View style={s.recentSection}>
                    <Text style={s.sectionLabel}>Order again</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                        {recentOrders.map(renderRecentChip)}
                    </ScrollView>
                </View>
            )}

            {fetchError ? (
                <View style={s.errorState}>
                    <Ionicons name="cloud-offline-outline" size={36} color="#555" />
                    <Text style={s.errorText}>{fetchError}</Text>
                    <TouchableOpacity style={s.retryBtn} onPress={fetchRestaurants}>
                        <Text style={s.retryText}>Try again</Text>
                    </TouchableOpacity>
                </View>
            ) : filtered.length === 0 ? (
                <View style={s.emptyState}>
                    <Ionicons name="restaurant-outline" size={36} color="#333" />
                    <Text style={s.emptyText}>No restaurants found</Text>
                    <Text style={s.emptySubText}>Try a different cuisine or search term</Text>
                </View>
            ) : (
                <FlatList
                    data={[...openRestaurants, ...closedRestaurants]}
                    keyExtractor={item => item.id}
                    renderItem={renderCard}
                    contentContainerStyle={s.list}
                    refreshControl={
                        <RefreshControl
                            refreshing={refreshing}
                            onRefresh={() => { setRefreshing(true); fetchRestaurants(); }}
                            tintColor={ORANGE}
                        />
                    }
                    ListHeaderComponent={
                        closedRestaurants.length > 0 && openRestaurants.length > 0 ? (
                            <View style={s.sectionHeader}>
                                <Text style={s.sectionLabel}>Open now — {openRestaurants.length} restaurants</Text>
                            </View>
                        ) : null
                    }
                    ListFooterComponent={
                        closedRestaurants.length > 0 ? (
                            <View style={s.sectionHeader}>
                                <Text style={s.sectionLabelClosed}>Closed · {closedRestaurants.length} restaurants</Text>
                            </View>
                        ) : null
                    }
                />
            )}

            <View style={[s.rateNote, { paddingBottom: insets.bottom + 12 }]}>
                <Ionicons name="checkmark-circle-outline" size={13} color="#22C55E" />
                <Text style={s.rateNoteText}>No booking fee · Flat delivery charge · foodDROP charges 5% extra</Text>
            </View>
        </View>
    );
}

const s = StyleSheet.create({
    root: {
        flex: 1,
        backgroundColor: SURFACE.base,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
        gap: 12,
    },
    backBtn: {
        width: 36,
        height: 36,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 18,
        backgroundColor: 'rgba(0,255,255,0.08)',
    },
    headerTitle: {
        flex: 1,
        color: '#EAF3F6',
        fontSize: 20,
        fontWeight: '600',
    },
    headerBadge: {
        backgroundColor: 'rgba(34,197,94,0.15)',
        borderRadius: 10,
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderWidth: 0.5,
        borderColor: 'rgba(34,197,94,0.3)',
    },
    headerBadgeText: {
        color: '#22C55E',
        fontSize: 10,
        fontWeight: '500',
    },
    searchWrap: {
        flexDirection: 'row',
        alignItems: 'center',
        marginHorizontal: 16,
        marginBottom: 12,
        backgroundColor: 'rgba(255,255,255,0.06)',
        borderRadius: 10,
        borderWidth: 0.5,
        borderColor: 'rgba(255,255,255,0.12)',
        paddingHorizontal: 12,
        height: 42,
    },
    searchIcon: {
        marginRight: 8,
    },
    searchInput: {
        flex: 1,
        color: '#EAF3F6',
        fontSize: 14,
        height: 42,
    },
    cuisineRow: {
        paddingHorizontal: 16,
        gap: 8,
        paddingBottom: 12,
    },
    cuisineChip: {
        paddingHorizontal: 14,
        paddingVertical: 7,
        borderRadius: 20,
        borderWidth: 0.5,
        borderColor: 'rgba(255,255,255,0.15)',
        backgroundColor: 'rgba(255,255,255,0.05)',
    },
    cuisineChipActive: {
        backgroundColor: 'rgba(249,115,22,0.18)',
        borderColor: 'rgba(249,115,22,0.4)',
    },
    cuisineLabel: {
        color: '#888',
        fontSize: 13,
        fontWeight: '500',
    },
    cuisineLabelActive: {
        color: ORANGE,
    },
    recentSection: {
        paddingHorizontal: 16,
        marginBottom: 12,
    },
    sectionLabel: {
        color: '#888',
        fontSize: 11,
        fontWeight: '500',
        letterSpacing: 0.5,
        textTransform: 'uppercase',
        marginBottom: 8,
    },
    sectionLabelClosed: {
        color: '#555',
        fontSize: 11,
        fontWeight: '500',
        letterSpacing: 0.5,
        textTransform: 'uppercase',
        marginBottom: 8,
    },
    sectionHeader: {
        paddingHorizontal: 16,
        paddingTop: 8,
        paddingBottom: 4,
    },
    recentChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderRadius: 20,
        backgroundColor: 'rgba(249,115,22,0.1)',
        borderWidth: 0.5,
        borderColor: 'rgba(249,115,22,0.25)',
        maxWidth: 140,
    },
    recentChipText: {
        color: ORANGE,
        fontSize: 12,
        fontWeight: '500',
    },
    list: {
        paddingHorizontal: 16,
        paddingBottom: 80,
    },
    card: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(255,255,255,0.04)',
        borderRadius: 14,
        borderWidth: 0.5,
        borderColor: 'rgba(255,255,255,0.1)',
        marginBottom: 10,
        padding: 14,
    },
    cardClosed: {
        opacity: 0.5,
    },
    cardIconWrap: {
        marginRight: 14,
    },
    cardIconBg: {
        width: 52,
        height: 52,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    cardBody: {
        flex: 1,
    },
    cardTitleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginBottom: 3,
    },
    cardName: {
        color: '#EAF3F6',
        fontSize: 15,
        fontWeight: '600',
        flex: 1,
    },
    cardNameClosed: {
        color: '#666',
    },
    closedBadge: {
        backgroundColor: 'rgba(255,255,255,0.08)',
        borderRadius: 6,
        paddingHorizontal: 6,
        paddingVertical: 2,
    },
    closedBadgeText: {
        color: '#666',
        fontSize: 10,
        fontWeight: '500',
    },
    cardAddress: {
        color: '#666',
        fontSize: 12,
        marginBottom: 8,
    },
    cardMeta: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        flexWrap: 'wrap',
    },
    metaChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
    },
    metaChipFree: {},
    metaText: {
        color: '#888',
        fontSize: 11,
    },
    metaTextFree: {
        color: '#22C55E',
        fontWeight: '500',
    },
    metaDistance: {
        color: '#555',
        fontSize: 11,
        marginLeft: 'auto',
    },
    cardChevron: {
        marginLeft: 8,
    },
    emptyState: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
    },
    emptyText: {
        color: '#888',
        fontSize: 16,
        fontWeight: '500',
    },
    emptySubText: {
        color: '#555',
        fontSize: 13,
    },
    errorState: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
    },
    errorText: {
        color: '#888',
        fontSize: 14,
        textAlign: 'center',
        paddingHorizontal: 32,
    },
    retryBtn: {
        paddingHorizontal: 20,
        paddingVertical: 10,
        borderRadius: 20,
        backgroundColor: 'rgba(249,115,22,0.15)',
        borderWidth: 0.5,
        borderColor: 'rgba(249,115,22,0.3)',
    },
    retryText: {
        color: ORANGE,
        fontSize: 14,
        fontWeight: '500',
    },
    rateNote: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 16,
        paddingTop: 10,
        borderTopWidth: 0.5,
        borderTopColor: 'rgba(255,255,255,0.06)',
    },
    rateNoteText: {
        color: '#444',
        fontSize: 11,
    },
});
