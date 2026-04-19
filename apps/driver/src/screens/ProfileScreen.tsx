import React, { useEffect, useState, useCallback } from 'react';
import {
    View, StyleSheet, TouchableOpacity, ScrollView, Text,
    ActivityIndicator, Alert, TextInput, Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../../../../shared/supabase';

const { width } = Dimensions.get('window');

// Blueberry Luxe — Gold Edition (Driver)
const COLORS = {
    bgPrimary: '#0D0B1E',
    bgSecondary: '#1A1508',
    gradientStart: '#1A1200',
    gradientEnd: '#0D0B1E',
    gold: '#FFD700',
    goldDark: '#B8860B',
    goldLight: '#FFEC8B',
    amber: '#FFB000',
    amberSoft: 'rgba(255,176,0,0.1)',
    purple: '#7B5CF0',
    purpleDark: '#5B3FD0',
    purpleLight: '#9B7CF0',
    white: '#FFFFFF',
    textSecondary: 'rgba(255,255,255,0.6)',
    textMuted: 'rgba(255,255,255,0.4)',
    glassBg: 'rgba(255,215,0,0.06)',
    glassBorder: 'rgba(255,176,0,0.3)',
    success: '#00FF94',
    warning: '#F59E0B',
    error: '#EF4444',
};

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

    if (loading) return <View style={[s.root, s.center]}><ActivityIndicator color={COLORS.gold} /></View>;

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
                    <Text style={{fontSize: 20, fontWeight: '800', color: '#FFF'}}>Operator Profile</Text>
                    <View style={{ width: 44 }} />
                </View>
            </BlurView>

            <ScrollView contentContainerStyle={{ paddingTop: insets.top + 80, paddingHorizontal: 24 }}>
                <View style={s.identity}>
                    <LinearGradient colors={[COLORS.gold, '#0891B2']} style={s.avatar}>
                        <Text style={{ fontWeight: '800', color: '#0A0718', fontSize: 32 }}>
                            {driver?.name?.charAt(0).toUpperCase()}
                        </Text>
                    </LinearGradient>

                    <Text style={{ fontSize: 24, fontWeight: '800', color: '#FFF', marginTop: 20 }}>
                        {driver?.name}
                    </Text>
                    <Text style={{ fontSize: 11, fontWeight: '700', color: COLORS.textMuted, marginTop: 6, letterSpacing: 1 }}>
                        {driver?.vehicle_model?.toUpperCase()} · {driver?.plate_number?.toUpperCase()}
                    </Text>

                    <View style={s.ratingBadge}>
                        <Ionicons name="star" size={16} color="#0A0718" />
                        <Text style={{ fontSize: 14, fontWeight: '700', color: '#0A0718', marginLeft: 6 }}>
                            {(driver?.rating || 5.0).toFixed(1)}
                        </Text>
                    </View>
                </View>

                <View style={s.statsRow}>
                    <View style={s.statItem}>
                        <Text style={{fontSize: 20, fontWeight: '800', color: '#FFF'}}>{stats.trips_today}</Text>
                        <Text style={{fontSize: 11, fontWeight: '700', color: COLORS.textMuted}}>TODAY</Text>
                    </View>
                    <View style={s.statDivider} />
                    <View style={s.statItem}>
                        <Text style={{fontSize: 20, fontWeight: '800', color: '#FFF'}}>{stats.total_trips}</Text>
                        <Text style={{fontSize: 11, fontWeight: '700', color: COLORS.textMuted}}>TOTAL</Text>
                    </View>
                    <View style={s.statDivider} />
                    <View style={s.statItem}>
                        <Text style={{fontSize: 14, fontWeight: '700', color: '#FFF'}}>{stats.member_since}</Text>
                        <Text style={{fontSize: 11, fontWeight: '700', color: COLORS.textMuted}}>SINCE</Text>
                    </View>
                </View>

                <View style={s.mainDivider} />

                <TouchableOpacity style={s.kycCard} activeOpacity={0.7}>
                    <View style={[s.rowIcon, { backgroundColor: 'rgba(0,255,194,0.05)' }]}>
                        <Ionicons
                            name={driver?.verified_status === 'approved' ? "shield-checkmark" : "shield-outline"}
                            size={20}
                            color={driver?.verified_status === 'approved' ? COLORS.success : COLORS.warning}
                        />
                    </View>
                    <View style={{ flex: 1, marginLeft: 16 }}>
                        <Text style={{fontSize: 14, fontWeight: '700', color: '#FFF'}}>SECURITY STATUS</Text>
                        <Text style={{fontSize: 11, fontWeight: '700', color: driver?.verified_status === 'approved' ? COLORS.success : COLORS.warning}}>
                            {driver?.verified_status === 'approved' ? 'LOGISTICS AUTHORIZED' :
                                driver?.verified_status === 'pending' ? 'UNDER REVIEW' :
                                    'COMPLIANCE REQUIRED'}
                        </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color={COLORS.textMuted} />
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
                        <Ionicons name="car-outline" size={20} color={COLORS.gold} />
                    </View>
                    <Text style={{fontSize: 14, fontWeight: '700', color: '#FFF', flex: 1, marginLeft: 16}}>VEHICLE CONFIGURATION</Text>
                    <Ionicons name={isEditing ? "chevron-up" : "chevron-forward"} size={20} color={COLORS.textMuted} />
                </TouchableOpacity>

                {isEditing && (
                    <View style={[s.editCard, {backgroundColor: COLORS.glassBg, borderColor: COLORS.glassBorder, borderWidth: 1, borderRadius: 20}]}>
                        <View style={s.inputField}>
                            <Text style={{fontSize: 11, fontWeight: '700', color: COLORS.textMuted, marginBottom: 8, marginLeft: 4}}>MODEL</Text>
                            <TextInput
                                style={s.input}
                                value={editModel}
                                onChangeText={setEditModel}
                                placeholderTextColor="rgba(255,255,255,0.2)"
                                placeholder="e.g. Nissan Sentra"
                            />
                        </View>
                        <View style={[s.inputField, { marginTop: 16 }]}>
                            <Text style={{fontSize: 11, fontWeight: '700', color: COLORS.textMuted, marginBottom: 8, marginLeft: 4}}>PLATE</Text>
                            <TextInput
                                style={s.input}
                                value={editPlate}
                                onChangeText={(t: string) => setEditPlate(t.toUpperCase())}
                                placeholderTextColor="rgba(255,255,255,0.2)"
                                placeholder="PDT 0000"
                            />
                        </View>
                        <TouchableOpacity style={s.saveBtn} onPress={handleSave} disabled={saving}>
                            {saving ? <ActivityIndicator color="#0A0718" /> : <Text style={{fontSize: 14, fontWeight: '700', color: '#0A0718'}}>SAVE CHANGES</Text>}
                        </TouchableOpacity>
                    </View>
                )}

                <TouchableOpacity
                    style={s.menuRow}
                    onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        navigation.navigate('StrategySettings');
                    }}
                >
                    <View style={[s.rowIcon, { backgroundColor: 'rgba(255,255,255,0.03)' }]}>
                        <Ionicons name="rocket-outline" size={20} color={COLORS.warning} />
                    </View>
                    <Text style={{fontSize: 14, fontWeight: '700', color: '#FFF', flex: 1, marginLeft: 16}}>STRATEGY PROTOCOLS</Text>
                    <Ionicons name="chevron-forward" size={20} color={COLORS.textMuted} />
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
                    <Text style={{fontSize: 14, fontWeight: '700', color: '#FFF', flex: 1, marginLeft: 16}}>LEGAL AGREEMENTS</Text>
                    <Ionicons name="chevron-forward" size={20} color={COLORS.textMuted} />
                </TouchableOpacity>

                <TouchableOpacity style={s.logoutBtn} onPress={handleLogout}>
                    <Ionicons name="log-out-outline" size={20} color={COLORS.warning} style={{ marginRight: 8 }} />
                    <Text style={{fontSize: 14, fontWeight: '700', color: COLORS.warning}}>TERMINATE SESSION</Text>
                </TouchableOpacity>

                <TouchableOpacity style={[s.logoutBtn, { marginTop: 16, borderColor: 'rgba(239,68,68,0.4)' }]} onPress={() => {}}>
                    <Ionicons name="trash-outline" size={20} color={COLORS.error} style={{ marginRight: 8 }} />
                    <Text style={{fontSize: 14, fontWeight: '700', color: COLORS.error}}>PURGE ACCOUNT & DATA</Text>
                </TouchableOpacity>

                <View style={s.footerBranding}>
                    <Text style={{fontSize: 22, fontWeight: '900', color: COLORS.gold, letterSpacing: 2}}>G-TAXI</Text>
                    <Text style={{fontSize: 10, fontWeight: '600', color: COLORS.textMuted, marginTop: 12}}>PILOT COMMAND V3.2 • EMPIRE OS</Text>
                </View>

                <View style={{ height: insets.bottom + 40 }} />
            </ScrollView>
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: COLORS.bgPrimary },
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
    avatar: { width: 88, height: 88, borderRadius: 44, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: COLORS.gold },
    ratingBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.gold, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, marginTop: 16 },
    statsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 28, paddingHorizontal: 4 },
    statItem: { alignItems: 'center', flex: 1 },
    statDivider: { width: 1, height: 32, backgroundColor: 'rgba(255,255,255,0.05)' },
    mainDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.05)', marginVertical: 4 },
    menuRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 22 },
    rowIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
    kycCard: { flexDirection: 'row', alignItems: 'center', paddingVertical: 20 },
    editCard: { padding: 20, marginTop: 4, marginBottom: 20 },
    inputField: { width: '100%' },
    input: { height: 56, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 14, paddingHorizontal: 16, color: '#FFF', fontSize: 16, fontWeight: '600', borderWidth: 1, borderColor: 'rgba(255,215,0,0.2)' },
    saveBtn: { height: 56, backgroundColor: COLORS.gold, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginTop: 24, shadowColor: COLORS.gold, shadowRadius: 10, shadowOpacity: 0.3, elevation: 5 },
    logoutBtn: { marginTop: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 18, borderRadius: 18, borderWidth: 1, borderColor: 'rgba(239,68,68,0.2)', backgroundColor: 'rgba(239,68,68,0.03)' },
    footerBranding: { alignItems: 'center', marginTop: 40, opacity: 0.8 },
});
