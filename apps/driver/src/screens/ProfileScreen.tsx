import React, { useEffect, useState, useCallback } from 'react';
import {
    View, StyleSheet, TouchableOpacity, ScrollView,
    ActivityIndicator, Alert, TextInput, Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import Reanimated, {
    useSharedValue, withSpring, withTiming,
    useAnimatedStyle,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../../../../shared/supabase';
import { Txt } from '../design-system/primitives';
import { GlassCard, BRAND, VOICES, SEMANTIC, RADIUS, GRADIENTS } from '../design-system';

const { width } = Dimensions.get('window');

interface ProfileStats {
    trips_today: number;
    total_trips: number;
    member_since: string;
}

export function ProfileScreen({ navigation }: any) {
    const insets = useSafeAreaInsets();
    const { driver, user, signOut } = useAuth();

    const [stats, setStats] = useState<ProfileStats>({ trips_today: 0, total_trips: 0, member_since: '...' });
    const [loading, setLoading] = useState(true);
    const [isEditing, setIsEditing] = useState(false);
    const [editModel, setEditModel] = useState('');
    const [editPlate, setEditPlate] = useState('');
    const [saving, setSaving] = useState(false);

    const loadProfileData = useCallback(async () => {
        if (!driver?.id || !user?.id) return;
        try {
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const [
                { data: driverData },
                { data: tripsTodayData },
                { data: totalTripsData },
                { data: userData }
            ] = await Promise.all([
                supabase.from('drivers').select('*').eq('user_id', user.id).single(),
                supabase.from('rides').select('id', { count: 'exact' }).eq('driver_id', driver.id).eq('status', 'completed').gte('created_at', today.toISOString()),
                supabase.from('rides').select('id', { count: 'exact' }).eq('driver_id', driver.id).eq('status', 'completed'),
                supabase.from('profiles').select('created_at').eq('id', user.id).single()
            ]);

            setStats({
                trips_today: tripsTodayData?.length || 0,
                total_trips: totalTripsData?.length || 0,
                member_since: userData?.created_at ? new Date(userData.created_at).toLocaleDateString([], { month: 'short', year: 'numeric' }) : '...'
            });

            setEditModel(driverData?.vehicle_model || driver.vehicle_model || '');
            setEditPlate(driverData?.plate_number || driver.plate_number || '');
        } catch (err) {
            console.error("Error loading profile:", err);
        } finally {
            setLoading(false);
        }
    }, [driver?.id, user?.id]);

    useEffect(() => { loadProfileData(); }, [loadProfileData]);

    const handleLogout = () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        Alert.alert('Log Out', 'Are you sure you want to log out?', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Log Out', style: 'destructive', onPress: async () => { await signOut(); } }
        ]);
    };

    const handleSave = async () => {
        if (!editModel.trim() || !editPlate.trim()) return;
        setSaving(true);
        const { error } = await supabase.from('drivers').update({ vehicle_model: editModel, plate_number: editPlate }).eq('user_id', user?.id);
        setSaving(false);
        if (!error) {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            setIsEditing(false);
        }
    };

    if (loading) return <View style={[s.root, s.center]}><ActivityIndicator color={BRAND.cyan} /></View>;

    return (
        <View style={s.root}>
            <StatusBar style="light" />

            <BlurView tint="dark" intensity={90} style={[s.header, { paddingTop: insets.top }]}>
                <View style={s.headerInner}>
                    <TouchableOpacity
                        style={s.headerBtn}
                        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); navigation.goBack(); }}
                    >
                        <Ionicons name="chevron-back" size={24} color="#FFF" />
                    </TouchableOpacity>
                    <Txt variant="headingM" weight="heavy" color="#FFF">Operator Profile</Txt>
                    <View style={{ width: 44 }} />
                </View>
            </BlurView>

            <ScrollView contentContainerStyle={{ paddingTop: insets.top + 80, paddingHorizontal: 24 }}>
                <View style={s.identity}>
                    <LinearGradient colors={['#1F2937', '#0A0718']} style={s.avatar}>
                        <Txt weight="heavy" color={BRAND.cyan} style={{ fontSize: 32 }}>
                            {driver?.name?.charAt(0).toUpperCase()}
                        </Txt>
                    </LinearGradient>

                    <Txt variant="headingL" weight="heavy" color="#FFF" style={{ marginTop: 20 }}>
                        {driver?.name}
                    </Txt>
                    <Txt variant="caption" weight="heavy" color={VOICES.driver.textMuted} style={{ marginTop: 6, letterSpacing: 1 }}>
                        {driver?.vehicle_model?.toUpperCase()} · {driver?.plate_number?.toUpperCase()}
                    </Txt>

                    <View style={s.ratingBadge}>
                        <Ionicons name="star" size={16} color="#0A0718" />
                        <Txt variant="bodyBold" weight="heavy" color="#0A0718" style={{ marginLeft: 6 }}>
                            {(driver?.rating || 5.0).toFixed(1)}
                        </Txt>
                    </View>
                </View>

                <View style={s.statsRow}>
                    <View style={s.statItem}>
                        <Txt variant="headingM" weight="heavy" color="#FFF">{stats.trips_today}</Txt>
                        <Txt variant="caption" weight="heavy" color={VOICES.driver.textMuted}>TODAY</Txt>
                    </View>
                    <View style={s.statDivider} />
                    <View style={s.statItem}>
                        <Txt variant="headingM" weight="heavy" color="#FFF">{stats.total_trips}</Txt>
                        <Txt variant="caption" weight="heavy" color={VOICES.driver.textMuted}>TOTAL</Txt>
                    </View>
                    <View style={s.statDivider} />
                    <View style={s.statItem}>
                        <Txt variant="bodyBold" weight="heavy" color="#FFF">{stats.member_since}</Txt>
                        <Txt variant="caption" weight="heavy" color={VOICES.driver.textMuted}>SINCE</Txt>
                    </View>
                </View>

                <View style={s.mainDivider} />

                <TouchableOpacity style={s.kycCard} activeOpacity={0.7}>
                    <View style={[s.rowIcon, { backgroundColor: 'rgba(0,255,194,0.05)' }]}>
                        <Ionicons
                            name={driver?.verified_status === 'approved' ? "shield-checkmark" : "shield-outline"}
                            size={20}
                            color={driver?.verified_status === 'approved' ? SEMANTIC.success : SEMANTIC.warning}
                        />
                    </View>
                    <View style={{ flex: 1, marginLeft: 16 }}>
                        <Txt variant="bodyBold" weight="heavy" color="#FFF">SECURITY STATUS</Txt>
                        <Txt variant="caption" weight="heavy" color={driver?.verified_status === 'approved' ? SEMANTIC.success : SEMANTIC.warning}>
                            {driver?.verified_status === 'approved' ? 'LOGISTICS AUTHORIZED' :
                                driver?.verified_status === 'pending' ? 'UNDER REVIEW' :
                                    'COMPLIANCE REQUIRED'}
                        </Txt>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color={VOICES.driver.textMuted} />
                </TouchableOpacity>

                <View style={s.mainDivider} />

                <TouchableOpacity
                    style={s.menuRow}
                    onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setIsEditing(!isEditing);
                    }}
                >
                    <View style={[s.rowIcon, { backgroundColor: 'rgba(255,255,255,0.03)' }]}>
                        <Ionicons name="car-outline" size={20} color={BRAND.cyan} />
                    </View>
                    <Txt variant="bodyBold" weight="heavy" color="#FFF" style={{ flex: 1, marginLeft: 16 }}>VEHICLE CONFIGURATION</Txt>
                    <Ionicons name={isEditing ? "chevron-up" : "chevron-forward"} size={20} color={VOICES.driver.textMuted} />
                </TouchableOpacity>

                {isEditing && (
                    <GlassCard variant="driver" style={s.editCard}>
                        <View style={s.inputField}>
                            <Txt variant="caption" weight="heavy" color={VOICES.driver.textMuted} style={{ marginBottom: 8, marginLeft: 4 }}>MODEL</Txt>
                            <TextInput
                                style={s.input}
                                value={editModel}
                                onChangeText={setEditModel}
                                placeholderTextColor="rgba(255,255,255,0.2)"
                                placeholder="e.g. Nissan Sentra"
                            />
                        </View>
                        <View style={[s.inputField, { marginTop: 16 }]}>
                            <Txt variant="caption" weight="heavy" color={VOICES.driver.textMuted} style={{ marginBottom: 8, marginLeft: 4 }}>PLATE</Txt>
                            <TextInput
                                style={s.input}
                                value={editPlate}
                                onChangeText={(t: string) => setEditPlate(t.toUpperCase())}
                                placeholderTextColor="rgba(255,255,255,0.2)"
                                placeholder="PDT 0000"
                            />
                        </View>
                        <TouchableOpacity style={s.saveBtn} onPress={handleSave} disabled={saving}>
                            {saving ? <ActivityIndicator color="#0A0718" /> : <Txt variant="bodyBold" weight="heavy" color="#0A0718">SAVE CHANGES</Txt>}
                        </TouchableOpacity>
                    </GlassCard>
                )}

                <TouchableOpacity
                    style={s.menuRow}
                    onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        navigation.navigate('StrategySettings');
                    }}
                >
                    <View style={[s.rowIcon, { backgroundColor: 'rgba(255,255,255,0.03)' }]}>
                        <Ionicons name="rocket-outline" size={20} color={SEMANTIC.warning} />
                    </View>
                    <Txt variant="bodyBold" weight="heavy" color="#FFF" style={{ flex: 1, marginLeft: 16 }}>STRATEGY PROTOCOLS</Txt>
                    <Ionicons name="chevron-forward" size={20} color={VOICES.driver.textMuted} />
                </TouchableOpacity>

                <View style={s.mainDivider} />

                <TouchableOpacity
                    style={s.menuRow}
                    onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        navigation.navigate('Legal');
                    }}
                >
                    <View style={[s.rowIcon, { backgroundColor: 'rgba(255,255,255,0.03)' }]}>
                        <Ionicons name="document-text-outline" size={20} color="#FFF" />
                    </View>
                    <Txt variant="bodyBold" weight="heavy" color="#FFF" style={{ flex: 1, marginLeft: 16 }}>LEGAL AGREEMENTS</Txt>
                    <Ionicons name="chevron-forward" size={20} color={VOICES.driver.textMuted} />
                </TouchableOpacity>

                <TouchableOpacity style={s.logoutBtn} onPress={handleLogout}>
                    <Ionicons name="log-out-outline" size={20} color={SEMANTIC.warning} style={{ marginRight: 8 }} />
                    <Txt variant="bodyBold" weight="heavy" color={SEMANTIC.warning}>TERMINATE SESSION</Txt>
                </TouchableOpacity>

                <TouchableOpacity style={[s.logoutBtn, { marginTop: 16, borderColor: 'transparent', backgroundColor: 'rgba(239,68,68,0.1)' }]} onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                    Alert.alert('Erase Platform Data', 'This will purge your operator history and wallet ledger permanently.', [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'ERASE ALL', style: 'destructive', onPress: async () => {
                            try {
                                await supabase.functions.invoke('delete_account');
                                await signOut();
                            } catch (e) {
                                Alert.alert('Error', 'Unable to delete. Contact admin.');
                            }
                        }}
                    ]);
                }}>
                    <Ionicons name="trash-outline" size={20} color={SEMANTIC.danger} style={{ marginRight: 8 }} />
                    <Txt variant="bodyBold" weight="heavy" color={SEMANTIC.danger}>PURGE ACCOUNT & DATA</Txt>
                </TouchableOpacity>

                <View style={{ height: insets.bottom + 40 }} />
            </ScrollView>
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: '#0A0718' },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    header: {
        position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20,
        borderBottomWidth: 1, borderColor: 'rgba(255,255,255,0.05)',
    },
    headerInner: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 20, paddingBottom: 16,
    },
    headerBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' },
    identity: { alignItems: 'center', paddingVertical: 24 },
    avatar: { width: 88, height: 88, borderRadius: 44, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: BRAND.cyan },
    ratingBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: BRAND.cyan, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, marginTop: 16 },
    statsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 28, paddingHorizontal: 4 },
    statItem: { alignItems: 'center', flex: 1 },
    statDivider: { width: 1, height: 32, backgroundColor: 'rgba(255,255,255,0.05)' },
    mainDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.05)', marginVertical: 4 },
    menuRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 22 },
    rowIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
    kycCard: { flexDirection: 'row', alignItems: 'center', paddingVertical: 20 },
    editCard: { padding: 20, marginTop: 4, marginBottom: 20 },
    inputField: { width: '100%' },
    input: { height: 56, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 14, paddingHorizontal: 16, color: '#FFF', fontSize: 16, fontWeight: '600', borderWidth: 1, borderColor: 'rgba(0,255,194,0.1)' },
    saveBtn: { height: 56, backgroundColor: BRAND.cyan, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginTop: 24, shadowColor: BRAND.cyan, shadowRadius: 10, shadowOpacity: 0.3, elevation: 5 },
    logoutBtn: { marginTop: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 18, borderRadius: 18, borderWidth: 1, borderColor: 'rgba(239,68,68,0.2)', backgroundColor: 'rgba(239,68,68,0.03)' },
});
