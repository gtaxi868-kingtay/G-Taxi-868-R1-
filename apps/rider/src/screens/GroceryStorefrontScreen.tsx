import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
    View, Text, FlatList, TouchableOpacity, StyleSheet,
    ActivityIndicator, useWindowDimensions, ScrollView, RefreshControl,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { supabase } from '@gtaxi/core';
import { useAuth } from '../context/AuthContext';
import { LoadingOverlay } from '@gtaxi/design-system/native';
import { ghostBorder, elevationGlow } from '@gtaxi/design-system/utils/style-rules';
import { SURFACE, VOICES, ANIMATION } from '@gtaxi/design-system';

const CYAN = '#06B6D4';

interface Merchant {
    id: string;
    name: string;
    category: string;
    address: string;
    is_active: boolean;
    delivery_fee_cents: number;
}

interface RegularItem {
    id: string;
    name: string;
    count: number;
    merchant_id: string;
    merchant_name: string;
}

const CATEGORY_ICONS: Record<string, string> = {
    grocery: '🛒',
    laundry: '🧺',
    pharmacy: '💊',
    bakery: '🥐',
    drinks: '🥤',
    default: '🏪',
};

export function GroceryStorefrontScreen({ navigation }: any) {
    const { width } = useWindowDimensions();
    const { user } = useAuth();
    const insets = useSafeAreaInsets();

    const [merchants, setMerchants] = useState<Merchant[]>([]);
    const [regularItems, setRegularItems] = useState<RegularItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [fetchError, setFetchError] = useState<string | null>(null);
    const [selectedCategory, setSelectedCategory] = useState<string>('all');

    const categories = useMemo(
        () => Array.from(new Set(merchants.map(m => m.category))),
        [merchants]
    );

    const fetchMerchants = useCallback(async () => {
        try {
            const { data, error } = await supabase
                .from('merchants')
                .select('id, name, category, address, is_active, delivery_fee_cents')
                .eq('is_active', true)
                .order('name', { ascending: true });

            if (error) throw error;

            const list = (data || []) as Merchant[];
            setMerchants(list);

            if (user?.id) {
                const { data: orders } = await supabase
                    .from('order_items')
                    .select('product_name, product_id, merchant_id, merchants(name)')
                    .limit(100);

                if (orders && orders.length > 0) {
                    const counts: Record<string, any> = {};
                    orders.forEach((o: any) => {
                        const key = o.product_name;
                        if (!counts[key]) {
                            counts[key] = { 
                                name: key, 
                                id: o.product_id, 
                                merchant_id: o.merchant_id,
                                merchant_name: o.merchants?.name,
                                count: 0 
                            };
                        }
                        counts[key].count += 1;
                    });

                    const sorted = Object.values(counts)
                        .sort((a, b) => b.count - a.count)
                        .slice(0, 8);
                    
                    setRegularItems(sorted as RegularItem[]);
                }
            }
        } catch (err: any) {
            console.error('[GroceryStorefront] fetch error:', err);
            setFetchError(err?.message || 'Could not load stores. Pull down to retry.');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    useEffect(() => { fetchMerchants(); }, [fetchMerchants]);

    const onRefresh = useCallback(() => {
        setRefreshing(true);
        fetchMerchants();
    }, [fetchMerchants]);

    const filteredMerchants = selectedCategory === 'all'
        ? merchants
        : merchants.filter(m => m.category === selectedCategory);

    const handleMerchantPress = (merchant: Merchant) => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        navigation.navigate('ProductListing', { merchant });
    };

    const renderMerchant = ({ item }: { item: Merchant }) => (
        <TouchableOpacity
            style={s.merchantCard}
            onPress={() => handleMerchantPress(item)}
            activeOpacity={0.85}
        >
            <View style={s.merchantIcon}>
                <Text style={s.iconEmoji}>
                    {CATEGORY_ICONS[item.category] || CATEGORY_ICONS.default}
                </Text>
            </View>
            <View style={s.merchantInfo}>
                <Text style={s.merchantName}>{item.name}</Text>
                <Text style={s.merchantMeta}>
                    {item.category.charAt(0).toUpperCase() + item.category.slice(1)}
                    {item.address ? `  •  ${item.address}` : ''}
                </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={VOICES.rider.accent} />
        </TouchableOpacity>
    );

    return (
        <LinearGradient colors={['#0A0A1F', '#12122A']} style={s.container}>
            <View style={[s.header, { paddingTop: insets.top + 8 }]}>
                <TouchableOpacity
                    onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); navigation.goBack(); }}
                    style={s.backBtn}
                >
                    <Ionicons name="arrow-back" size={22} color="#FFF" />
                </TouchableOpacity>
                <Text style={s.headerTitle}>Stores Near You</Text>
                <View style={{ width: 38 }} />
            </View>

            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={s.catScroll}
                contentContainerStyle={s.catContent}
            >
                {['all', ...categories].map(cat => (
                    <TouchableOpacity
                        key={cat}
                        onPress={() => { setSelectedCategory(cat); Haptics.selectionAsync(); }}
                        style={[s.catChip, selectedCategory === cat && s.catChipActive]}
                    >
                        <Text style={[s.catChipText, selectedCategory === cat && s.catChipTextActive]}>
                            {cat === 'all' ? 'All' : cat.charAt(0).toUpperCase() + cat.slice(1)}
                        </Text>
                    </TouchableOpacity>
                ))}
            </ScrollView>

            {regularItems.length > 0 && (
                <View style={s.regularsContainer}>
                    <View style={s.sectionHeader}>
                        <Ionicons name="flash" size={14} color={CYAN} />
                        <Text style={s.sectionTitle}>THE REGULARS</Text>
                    </View>
                    <ScrollView 
                        horizontal 
                        showsHorizontalScrollIndicator={false} 
                        contentContainerStyle={s.regularsScroll}
                    >
                        {regularItems.map((item, idx) => (
                            <TouchableOpacity 
                                key={idx} 
                                style={s.regularCard}
                                onPress={() => {
                                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                                    navigation.navigate('ProductDetail', { 
                                        productId: item.id, 
                                        merchantId: item.merchant_id 
                                    });
                                }}
                            >
                                <View style={s.itemIcon}>
                                    <Text style={{ fontSize: 20 }}>📦</Text>
                                </View>
                                <Text style={s.itemName} numberOfLines={1}>{item.name}</Text>
                                <Text style={s.itemMerchant} numberOfLines={1}>{item.merchant_name}</Text>
                            </TouchableOpacity>
                        ))}
                    </ScrollView>
                </View>
            )}

            {loading && <LoadingOverlay message="Loading..." color={CYAN} />}

            {!loading && fetchError ? (
                <View style={s.center}>
                    <Text style={s.emptyEmoji}>⚠️</Text>
                    <Text style={[s.emptyText, { color: '#EF4444' }]}>Failed to load stores</Text>
                    <Text style={s.emptySubtext}>{fetchError}</Text>
                </View>
            ) : !loading && filteredMerchants.length === 0 ? (
                <View style={s.center}>
                    <Text style={s.emptyEmoji}>🏪</Text>
                    <Text style={s.emptyText}>No stores available right now.</Text>
                    <Text style={s.emptySubtext}>Pull down to refresh.</Text>
                </View>
            ) : (
                <FlatList<Merchant>
                    data={filteredMerchants}
                    keyExtractor={item => item.id}
                    renderItem={renderMerchant}
                    contentContainerStyle={s.listContent}
                    showsVerticalScrollIndicator={false}
                    refreshControl={
                        <RefreshControl
                            refreshing={refreshing}
                            onRefresh={onRefresh}
                            tintColor={CYAN}
                        />
                    }
                />
            )}
        </LinearGradient>
    );
}

const s = StyleSheet.create({
    container: { flex: 1 },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        paddingBottom: 12,
    },
    backBtn: {
        width: 38, height: 38, borderRadius: 19,
        backgroundColor: 'rgba(255,255,255,0.1)',
        alignItems: 'center', justifyContent: 'center',
    },
    headerTitle: {
        fontSize: 20, fontWeight: '700', color: '#FFF', letterSpacing: 0.2,
    },
    catScroll: { maxHeight: 52 },
    catContent: { paddingHorizontal: 20, paddingBottom: 8, gap: 10, alignItems: 'center' },
    catChip: {
        paddingHorizontal: 18, paddingVertical: 8, borderRadius: 50,
        backgroundColor: 'rgba(255,255,255,0.08)',
        ...ghostBorder(0.12),
    },
    catChipActive: {
        backgroundColor: VOICES.rider.accent,
        borderColor: VOICES.rider.accent,
    },
    catChipText: { fontSize: 13, color: 'rgba(255,255,255,0.6)', fontWeight: '300' },
    catChipTextActive: { color: '#FFF', fontWeight: '700' },
    listContent: { padding: 20, gap: 14 },
    merchantCard: {
        flexDirection: 'row', alignItems: 'center',
        borderRadius: 20, overflow: 'hidden',
        ...ghostBorder(0.12),
        padding: 16, gap: 14,
        backgroundColor: 'rgba(255,255,255,0.05)',
    },
    merchantIcon: {
        width: 52, height: 52, borderRadius: 16,
        backgroundColor: `${VOICES.rider.accent}33`,
        alignItems: 'center', justifyContent: 'center',
    },
    iconEmoji: { fontSize: 26 },
    merchantInfo: { flex: 1 },
    merchantName: { fontSize: 16, fontWeight: '700', color: '#FFF' },
    merchantMeta: { fontSize: 13, color: 'rgba(255,255,255,0.5)', marginTop: 3 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
    loadingText: { color: 'rgba(255,255,255,0.5)', marginTop: 12, fontSize: 14 },
    emptyEmoji: { fontSize: 48, marginBottom: 16 },
    emptyText: { color: '#FFF', fontSize: 18, fontWeight: '700' },
    emptySubtext: { color: 'rgba(255,255,255,0.4)', fontSize: 14, marginTop: 6 },

    regularsContainer: { marginTop: 12, marginBottom: 24 },
    sectionHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, marginBottom: 12, gap: 6 },
    sectionTitle: { fontSize: 11, fontWeight: '900', color: CYAN, letterSpacing: 2 },
    regularsScroll: { paddingHorizontal: 20, gap: 12 },
    regularCard: { width: 140, padding: 16, borderRadius: 20, overflow: 'hidden', ...ghostBorder(0.2), backgroundColor: 'rgba(255,255,255,0.03)' },
    itemIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: 'rgba(0,255,255,0.1)', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
    itemName: { fontSize: 14, fontWeight: '700', color: '#FFF' },
    itemMerchant: { fontSize: 10, color: 'rgba(255,255,255,0.4)', marginTop: 2, fontWeight: '300' },
});
