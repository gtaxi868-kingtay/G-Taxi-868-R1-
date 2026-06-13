import React, { useEffect, useState, useCallback } from 'react';
import {
    View, Text, FlatList, TouchableOpacity, StyleSheet,
    Modal, TextInput, Switch, Alert, ActivityIndicator,
    KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import { initializeSupabaseClient } from '@gtaxi/core';
import { SURFACE, VOICES } from '@gtaxi/design-system';
import { glassSurface, ghostBorder } from '@gtaxi/design-system/utils/style-rules';

const { supabase } = initializeSupabaseClient('native');

// ── Types ─────────────────────────────────────────────────────────────────────

interface Product {
    id: string;
    merchant_id: string;
    name: string;
    description: string | null;
    price_cents: number;
    is_available: boolean;
    category: string | null;
    image_url: string | null;
    sort_order: number;
}

interface ProductForm {
    name: string;
    description: string;
    price: string;
    category: string;
    image_url: string;
    is_available: boolean;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const CATEGORIES = ['general', 'grocery', 'beverages', 'snacks', 'personal_care', 'household', 'pharmacy', 'laundry', 'other'];

const CATEGORY_LABELS: Record<string, string> = {
    general: 'General',
    grocery: 'Grocery',
    beverages: 'Beverages',
    snacks: 'Snacks',
    personal_care: 'Personal Care',
    household: 'Household',
    pharmacy: 'Pharmacy',
    laundry: 'Laundry',
    other: 'Other',
};

const ACCENT = VOICES.merchant.accent as string;
const EMPTY_FORM: ProductForm = {
    name: '',
    description: '',
    price: '',
    category: 'general',
    image_url: '',
    is_available: true,
};

// ── Component ─────────────────────────────────────────────────────────────────

export function ProductCatalogScreen() {
    const insets = useSafeAreaInsets();
    const { user } = useAuth();

    const [merchantId, setMerchantId] = useState<string | null>(null);
    const [products, setProducts] = useState<Product[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    // Modal state
    const [modalVisible, setModalVisible] = useState(false);
    const [editingProduct, setEditingProduct] = useState<Product | null>(null);
    const [form, setForm] = useState<ProductForm>(EMPTY_FORM);
    const [saving, setSaving] = useState(false);
    const [togglingId, setTogglingId] = useState<string | null>(null);

    // ── Load merchant ID ──────────────────────────────────────────────────────
    useEffect(() => {
        if (!user) return;
        resolveMerchantId();
    }, [user]);

    const resolveMerchantId = async () => {
        if (!user) return;
        const { data: merchant } = await supabase
            .from('merchants')
            .select('id')
            .eq('created_by', user.id)
            .maybeSingle();
        if (merchant) {
            setMerchantId(merchant.id);
            return;
        }
        const { data: staffRow } = await supabase
            .from('merchant_staff')
            .select('merchant_id')
            .eq('user_id', user.id)
            .maybeSingle();
        if (staffRow) setMerchantId(staffRow.merchant_id);
    };

    // ── Load products ─────────────────────────────────────────────────────────
    const loadProducts = useCallback(async () => {
        if (!merchantId) return;
        setRefreshing(true);
        const { data, error } = await supabase
            .from('products')
            .select('id, merchant_id, name, description, price_cents, is_available, category, image_url, sort_order')
            .eq('merchant_id', merchantId)
            .order('sort_order', { ascending: true })
            .order('name', { ascending: true });

        if (error) {
            Alert.alert('Error', 'Could not load products. Pull to refresh.');
        } else {
            setProducts((data || []) as Product[]);
        }
        setLoading(false);
        setRefreshing(false);
    }, [merchantId]);

    useEffect(() => {
        if (merchantId) loadProducts();
    }, [merchantId, loadProducts]);

    // ── Open add/edit modal ───────────────────────────────────────────────────
    const openAdd = () => {
        setEditingProduct(null);
        setForm(EMPTY_FORM);
        setModalVisible(true);
    };

    const openEdit = (p: Product) => {
        setEditingProduct(p);
        setForm({
            name: p.name,
            description: p.description ?? '',
            price: (p.price_cents / 100).toFixed(2),
            category: p.category ?? 'general',
            image_url: p.image_url ?? '',
            is_available: p.is_available,
        });
        setModalVisible(true);
    };

    // ── Save (create or update) ───────────────────────────────────────────────
    const saveProduct = async () => {
        if (!merchantId) return;
        if (!form.name.trim()) {
            Alert.alert('Validation', 'Product name is required');
            return;
        }
        const priceCents = Math.round(parseFloat(form.price) * 100);
        if (isNaN(priceCents) || priceCents < 1) {
            Alert.alert('Validation', 'Enter a valid price (e.g. 5.50)');
            return;
        }

        setSaving(true);
        const payload = {
            merchant_id: merchantId,
            name: form.name.trim(),
            description: form.description.trim() || null,
            price_cents: priceCents,
            is_available: form.is_available,
            category: form.category,
            image_url: form.image_url.trim() || null,
        };

        let error: { message: string } | null = null;

        if (editingProduct) {
            ({ error } = await supabase
                .from('products')
                .update(payload)
                .eq('id', editingProduct.id));
        } else {
            ({ error } = await supabase
                .from('products')
                .insert(payload));
        }

        if (error) {
            Alert.alert('Error', error.message);
        } else {
            setModalVisible(false);
            await loadProducts();
        }
        setSaving(false);
    };

    // ── Toggle availability ───────────────────────────────────────────────────
    const toggleAvailability = async (p: Product) => {
        setTogglingId(p.id);
        const { error } = await supabase
            .from('products')
            .update({ is_available: !p.is_available })
            .eq('id', p.id);
        if (error) {
            Alert.alert('Error', error.message);
        } else {
            setProducts(prev =>
                prev.map(x => x.id === p.id ? { ...x, is_available: !x.is_available } : x),
            );
        }
        setTogglingId(null);
    };

    // ── Delete ────────────────────────────────────────────────────────────────
    const deleteProduct = (p: Product) => {
        Alert.alert(
            'Delete Product',
            `Remove "${p.name}" from your catalog? This cannot be undone.`,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: async () => {
                        const { error } = await supabase.from('products').delete().eq('id', p.id);
                        if (error) {
                            Alert.alert('Error', error.message);
                        } else {
                            setProducts(prev => prev.filter(x => x.id !== p.id));
                        }
                    },
                },
            ],
        );
    };

    // ── Product row ───────────────────────────────────────────────────────────
    const renderProduct = ({ item }: { item: Product }) => (
        <View style={[s.productRow, glassSurface(0.12)]}>
            <View style={s.productInfo}>
                <View style={s.productHeader}>
                    <Text style={s.productName} numberOfLines={1}>{item.name}</Text>
                    {item.category && item.category !== 'general' && (
                        <View style={s.categoryBadge}>
                            <Text style={s.categoryBadgeText}>
                                {CATEGORY_LABELS[item.category] ?? item.category}
                            </Text>
                        </View>
                    )}
                </View>
                {item.description ? (
                    <Text style={s.productDesc} numberOfLines={1}>{item.description}</Text>
                ) : null}
                <Text style={s.productPrice}>TTD ${(item.price_cents / 100).toFixed(2)}</Text>
            </View>

            <View style={s.productActions}>
                {togglingId === item.id ? (
                    <ActivityIndicator size="small" color={ACCENT} />
                ) : (
                    <Switch
                        value={item.is_available}
                        onValueChange={() => toggleAvailability(item)}
                        trackColor={{ false: 'rgba(255,255,255,0.1)', true: ACCENT + '66' }}
                        thumbColor={item.is_available ? ACCENT : 'rgba(255,255,255,0.3)'}
                        ios_backgroundColor="rgba(255,255,255,0.1)"
                    />
                )}
                <TouchableOpacity onPress={() => openEdit(item)} style={s.iconBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Ionicons name="pencil" size={16} color="rgba(255,255,255,0.4)" />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => deleteProduct(item)} style={s.iconBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Ionicons name="trash-outline" size={16} color="#EF4444" />
                </TouchableOpacity>
            </View>
        </View>
    );

    // ── Empty state ───────────────────────────────────────────────────────────
    const renderEmpty = () => (
        <View style={s.emptyState}>
            <Ionicons name="storefront-outline" size={40} color="rgba(255,255,255,0.1)" />
            <Text style={s.emptyTitle}>No Products Yet</Text>
            <Text style={s.emptyDesc}>
                Add products so riders can browse your store and place orders through G-Taxi.
            </Text>
            <TouchableOpacity style={[s.emptyBtn, { backgroundColor: ACCENT + '22' }]} onPress={openAdd}>
                <Ionicons name="add" size={18} color={ACCENT} />
                <Text style={[s.emptyBtnText, { color: ACCENT }]}>Add First Product</Text>
            </TouchableOpacity>
        </View>
    );

    // ── Loading skeleton ──────────────────────────────────────────────────────
    if (loading) {
        return (
            <View style={[s.container, { paddingTop: insets.top }]}>
                <LinearGradient colors={[SURFACE.base, '#1C1510']} style={StyleSheet.absoluteFillObject} />
                <View style={s.loadingWrap}>
                    <ActivityIndicator size="large" color={ACCENT} />
                    <Text style={s.loadingText}>Loading catalog</Text>
                </View>
            </View>
        );
    }

    return (
        <View style={[s.container, { paddingTop: insets.top }]}>
            <LinearGradient colors={[SURFACE.base, '#1C1510']} style={StyleSheet.absoluteFillObject} />

            {/* Header */}
            <View style={s.header}>
                <View>
                    <Text style={s.screenTitle}>Product Catalog</Text>
                    <Text style={s.productCount}>
                        {products.length} {products.length === 1 ? 'item' : 'items'} ·{' '}
                        {products.filter(p => p.is_available).length} available
                    </Text>
                </View>
                <TouchableOpacity style={[s.addBtn, { backgroundColor: ACCENT }]} onPress={openAdd} activeOpacity={0.8}>
                    <Ionicons name="add" size={22} color="#000" />
                </TouchableOpacity>
            </View>

            {/* Product list */}
            <FlatList
                data={products}
                keyExtractor={item => item.id}
                renderItem={renderProduct}
                ListEmptyComponent={renderEmpty}
                contentContainerStyle={[
                    s.listContent,
                    products.length === 0 && s.listContentEmpty,
                ]}
                onRefresh={loadProducts}
                refreshing={refreshing}
                showsVerticalScrollIndicator={false}
            />

            {/* Add/Edit Modal */}
            <Modal
                visible={modalVisible}
                animationType="slide"
                presentationStyle="pageSheet"
                onRequestClose={() => setModalVisible(false)}
            >
                <KeyboardAvoidingView
                    style={s.modalOuter}
                    behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                >
                    <LinearGradient colors={['#0F0C1A', SURFACE.base]} style={StyleSheet.absoluteFillObject} />

                    {/* Modal header */}
                    <View style={s.modalHeader}>
                        <Text style={s.modalTitle}>
                            {editingProduct ? 'Edit Product' : 'Add Product'}
                        </Text>
                        <TouchableOpacity
                            onPress={() => setModalVisible(false)}
                            style={s.modalClose}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                            <Ionicons name="close" size={22} color="rgba(255,255,255,0.5)" />
                        </TouchableOpacity>
                    </View>

                    <ScrollView style={s.modalScroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

                        {/* Name */}
                        <View style={s.field}>
                            <Text style={s.fieldLabel}>Name *</Text>
                            <TextInput
                                style={s.input}
                                value={form.name}
                                onChangeText={t => setForm(f => ({ ...f, name: t }))}
                                placeholder="e.g. Fresh Orange Juice 1L"
                                placeholderTextColor="rgba(255,255,255,0.2)"
                                returnKeyType="next"
                                maxLength={100}
                            />
                        </View>

                        {/* Description */}
                        <View style={s.field}>
                            <Text style={s.fieldLabel}>Description</Text>
                            <TextInput
                                style={[s.input, s.inputMultiline]}
                                value={form.description}
                                onChangeText={t => setForm(f => ({ ...f, description: t }))}
                                placeholder="Optional — shown to riders on the product page"
                                placeholderTextColor="rgba(255,255,255,0.2)"
                                multiline
                                numberOfLines={3}
                                maxLength={300}
                            />
                        </View>

                        {/* Price */}
                        <View style={s.field}>
                            <Text style={s.fieldLabel}>Price (TTD) *</Text>
                            <View style={s.priceRow}>
                                <Text style={s.currencyPrefix}>TTD $</Text>
                                <TextInput
                                    style={[s.input, s.priceInput]}
                                    value={form.price}
                                    onChangeText={t => setForm(f => ({ ...f, price: t }))}
                                    placeholder="0.00"
                                    placeholderTextColor="rgba(255,255,255,0.2)"
                                    keyboardType="decimal-pad"
                                    returnKeyType="next"
                                />
                            </View>
                        </View>

                        {/* Category */}
                        <View style={s.field}>
                            <Text style={s.fieldLabel}>Category</Text>
                            <ScrollView
                                horizontal
                                showsHorizontalScrollIndicator={false}
                                contentContainerStyle={s.categoryRow}
                            >
                                {CATEGORIES.map(cat => (
                                    <TouchableOpacity
                                        key={cat}
                                        onPress={() => setForm(f => ({ ...f, category: cat }))}
                                        style={[
                                            s.categoryChip,
                                            form.category === cat && { backgroundColor: ACCENT + '33', borderColor: ACCENT },
                                        ]}
                                    >
                                        <Text style={[
                                            s.categoryChipText,
                                            form.category === cat && { color: ACCENT },
                                        ]}>
                                            {CATEGORY_LABELS[cat]}
                                        </Text>
                                    </TouchableOpacity>
                                ))}
                            </ScrollView>
                        </View>

                        {/* Image URL */}
                        <View style={s.field}>
                            <Text style={s.fieldLabel}>Image URL</Text>
                            <TextInput
                                style={s.input}
                                value={form.image_url}
                                onChangeText={t => setForm(f => ({ ...f, image_url: t }))}
                                placeholder="https://..."
                                placeholderTextColor="rgba(255,255,255,0.2)"
                                keyboardType="url"
                                autoCapitalize="none"
                                returnKeyType="done"
                            />
                        </View>

                        {/* Availability */}
                        <View style={[s.field, s.availRow]}>
                            <View>
                                <Text style={s.fieldLabel}>Available for ordering</Text>
                                <Text style={s.availHint}>
                                    Toggle off to hide this product from riders without deleting it
                                </Text>
                            </View>
                            <Switch
                                value={form.is_available}
                                onValueChange={v => setForm(f => ({ ...f, is_available: v }))}
                                trackColor={{ false: 'rgba(255,255,255,0.1)', true: ACCENT + '66' }}
                                thumbColor={form.is_available ? ACCENT : 'rgba(255,255,255,0.3)'}
                                ios_backgroundColor="rgba(255,255,255,0.1)"
                            />
                        </View>

                        {/* Save button */}
                        <TouchableOpacity
                            style={[s.saveBtn, { backgroundColor: ACCENT }, saving && s.saveBtnDisabled]}
                            onPress={saveProduct}
                            disabled={saving}
                            activeOpacity={0.8}
                        >
                            {saving ? (
                                <ActivityIndicator size="small" color="#000" />
                            ) : (
                                <>
                                    <Ionicons
                                        name={editingProduct ? 'checkmark' : 'add'}
                                        size={18}
                                        color="#000"
                                    />
                                    <Text style={s.saveBtnText}>
                                        {editingProduct ? 'Save Changes' : 'Add to Catalog'}
                                    </Text>
                                </>
                            )}
                        </TouchableOpacity>

                        <View style={{ height: 40 }} />
                    </ScrollView>
                </KeyboardAvoidingView>
            </Modal>
        </View>
    );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: SURFACE.base },

    // Header
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 24,
        paddingVertical: 16,
    },
    screenTitle: {
        fontSize: 22,
        fontWeight: '800',
        color: '#FFFFFF',
        fontFamily: 'SpaceGrotesk',
    },
    productCount: {
        fontSize: 12,
        color: VOICES.merchant.textMuted,
        marginTop: 2,
        fontFamily: 'Manrope',
    },
    addBtn: {
        width: 44,
        height: 44,
        borderRadius: 22,
        justifyContent: 'center',
        alignItems: 'center',
    },

    // List
    listContent: { paddingHorizontal: 24, paddingBottom: 100 },
    listContentEmpty: { flex: 1 },

    // Product row
    productRow: {
        borderRadius: 16,
        padding: 16,
        marginBottom: 10,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        ...ghostBorder(0.12),
    },
    productInfo: { flex: 1, minWidth: 0 },
    productHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' },
    productName: { fontSize: 15, fontWeight: '700', color: '#FFFFFF', fontFamily: 'SpaceGrotesk', flex: 1 },
    categoryBadge: {
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 6,
        backgroundColor: 'rgba(255,255,255,0.08)',
    },
    categoryBadgeText: {
        fontSize: 10,
        fontWeight: '700',
        color: 'rgba(255,255,255,0.4)',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        fontFamily: 'Manrope',
    },
    productDesc: { fontSize: 12, color: VOICES.merchant.textMuted, marginBottom: 4, fontFamily: 'Manrope' },
    productPrice: {
        fontSize: 14,
        fontWeight: '700',
        color: VOICES.merchant.accent,
        fontFamily: 'SpaceGrotesk',
    },
    productActions: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 0 },
    iconBtn: {
        width: 32,
        height: 32,
        borderRadius: 8,
        backgroundColor: 'rgba(255,255,255,0.05)',
        justifyContent: 'center',
        alignItems: 'center',
    },

    // Empty
    emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, paddingTop: 80 },
    emptyTitle: { fontSize: 18, fontWeight: '700', color: '#FFFFFF', marginTop: 16, fontFamily: 'SpaceGrotesk' },
    emptyDesc: {
        fontSize: 14,
        color: VOICES.merchant.textMuted,
        textAlign: 'center',
        marginTop: 8,
        lineHeight: 20,
        fontFamily: 'Manrope',
    },
    emptyBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginTop: 24,
        paddingHorizontal: 20,
        paddingVertical: 12,
        borderRadius: 12,
    },
    emptyBtnText: { fontSize: 14, fontWeight: '700', fontFamily: 'SpaceGrotesk' },

    // Loading
    loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
    loadingText: {
        fontSize: 13,
        color: VOICES.merchant.textMuted,
        fontFamily: 'Manrope',
        textTransform: 'uppercase',
        letterSpacing: 1,
    },

    // Modal
    modalOuter: { flex: 1 },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 24,
        paddingTop: 20,
        paddingBottom: 16,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255,255,255,0.06)',
    },
    modalTitle: {
        fontSize: 18,
        fontWeight: '800',
        color: '#FFFFFF',
        fontFamily: 'SpaceGrotesk',
    },
    modalClose: {
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: 'rgba(255,255,255,0.06)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    modalScroll: { flex: 1, paddingHorizontal: 24, paddingTop: 8 },

    // Form fields
    field: { marginTop: 20 },
    fieldLabel: {
        fontSize: 11,
        fontWeight: '700',
        color: 'rgba(255,255,255,0.35)',
        textTransform: 'uppercase',
        letterSpacing: 1,
        marginBottom: 8,
        fontFamily: 'Manrope',
    },
    input: {
        backgroundColor: 'rgba(255,255,255,0.07)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.1)',
        borderRadius: 14,
        paddingHorizontal: 16,
        paddingVertical: 14,
        color: '#FFFFFF',
        fontSize: 15,
        fontFamily: 'Manrope',
    },
    inputMultiline: { minHeight: 80, textAlignVertical: 'top', paddingTop: 14 },
    priceRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    currencyPrefix: {
        fontSize: 15,
        fontWeight: '700',
        color: 'rgba(255,255,255,0.4)',
        fontFamily: 'SpaceGrotesk',
    },
    priceInput: { flex: 1 },

    // Category chips
    categoryRow: { gap: 8 },
    categoryChip: {
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.12)',
        backgroundColor: 'rgba(255,255,255,0.04)',
    },
    categoryChipText: {
        fontSize: 12,
        fontWeight: '600',
        color: 'rgba(255,255,255,0.4)',
        fontFamily: 'Manrope',
    },

    // Availability
    availRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 24 },
    availHint: {
        fontSize: 11,
        color: 'rgba(255,255,255,0.2)',
        marginTop: 2,
        maxWidth: '80%',
        fontFamily: 'Manrope',
    },

    // Save button
    saveBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        marginTop: 32,
        height: 52,
        borderRadius: 16,
    },
    saveBtnDisabled: { opacity: 0.6 },
    saveBtnText: {
        fontSize: 15,
        fontWeight: '800',
        color: '#000',
        fontFamily: 'SpaceGrotesk',
    },
});
