import React, { useEffect, useState, useCallback } from 'react';
import {
    View, StyleSheet, TouchableOpacity, ScrollView, Text,
    ActivityIndicator, Alert, TextInput, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { supabase } from '@gtaxi/core';
import { SURFACE, VOICES } from '@gtaxi/design-system';
import { elevationGlow, glassSurface, ghostBorder } from '@gtaxi/design-system/utils/style-rules';

interface ProfileStats {
    trips_today: number;
    total_trips: number;
    member_since: string;
}

interface NavigationProp {
    navigate: (screen: string, params?: object) => void;
    goBack: () => void;
}

export function ProfileScreen({ navigation }: { navigation: NavigationProp }) {
    const insets = useSafeAreaInsets();
    const { driver, user, signOut } = useAuth();

    const [stats, setStats] = useState<ProfileStats>({ trips_today: 0, total_trips: 0, member_since: '...' });
    const [loading, setLoading] = useState(true);
    const [isEditing, setIsEditing] = useState(false);
    const [editModel, setEditModel] = useState('');
    const [editPlate, setEditPlate] = useState('');
    const [saving, setSaving] = useState(false);
    const [role, setRole] = useState<string | null>(null);

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
                supabase.from('profiles').select('created_at, role').eq('id', user.id).single()
            ]);

            setStats({
                trips_today: tripsTodayData?.length || 0,
                total_trips: totalTripsData?.length || 0,
                member_since: userData?.created_at ? new Date(userData.created_at).toLocaleDateString([], { month: 'short', year: 'numeric' }) : '...'
            });
            setRole((userData as any)?.role ?? null);

            setEditModel(driverData?.vehicle_model || driver.vehicle_model || '');
            setEditPlate(driverData?.plate_number || driver.plate_number || '');
        } catch (err) {
            // Error loading profile
        } finally {
            setLoading(false);
        }
    }, [driver?.id, user?.id]);

    useEffect(() => { loadProfileData(); }, [loadProfileData]);

    const handlePurgeAccount = () => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        Alert.alert(
            'Delete Account',
            'This permanently deletes your account, all trip history, and earnings data. This cannot be undone.',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Yes, Delete Everything',
                    style: 'destructive',
                    onPress: () => {
                        Alert.alert(
                            'Final Confirmation',
                            'Type "DELETE" to confirm. Your account will be permanently removed.',
                            [
                                { text: 'Cancel', style: 'cancel' },
                                {
                                    text: 'Confirm Delete',
                                    style: 'destructive',
                                    onPress: async () => {
                                        try {
                                            const { data: { session } } = await supabase.auth.getSession();
                                            const { error } = await supabase.functions.invoke('delete_account', {
                                                headers: session ? { Authorization: `Bearer ${session.access_token}` } : undefined,
                                            });
                                            if (error) throw error;
                                            await signOut();
                                        } catch (err: any) {
                                            Alert.alert('Error', err.message || 'Could not delete account. Contact support@gtaxi.tt');
                                        }
                                    }
                                }
                            ]
                        );
                    }
                }
            ]
        );
    };

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

    if (loading) return <View style={[s.root, s.center]}><ActivityIndicator color={VOICES.driver.accent} /></View>;

    return (
        <View style={s.root}>
            <StatusBar style="light" />

            <BlurView tint="dark" intensity={90} style={[s.header, { paddingTop: insets.top }, glassSurface(90, 0.2)]}>
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

            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                style={{ flex: 1 }}
            >
            <ScrollView contentContainerStyle={{ paddingTop: insets.top + 80, paddingHorizontal: 24 }}>
                <View style={s.identity}>
                    <LinearGradient colors={[VOICES.driver.accent, '#0891B2']} style={s.avatar}>
                        <Text style={{ fontWeight: '800', color: '#0A0718', fontSize: 32 }}>
                            {driver?.name?.charAt(0).toUpperCase()}
                        </Text>
                    </LinearGradient>

                    <Text style={{ fontSize: 24, fontWeight: '800', color: '#FFF', marginTop: 20 }}>
                        {driver?.name}
                    </Text>
                    <Text style={{ fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.6)', marginTop: 6, letterSpacing: 1 }}>
                        {driver?.vehicle_model} · {driver?.plate_number?.toUpperCase()}
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
                        <Text style={{fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.6)'}}>TODAY</Text>
                    </View>
                    <View style={s.statDivider} />
                    <View style={s.statItem}>
                        <Text style={{fontSize: 20, fontWeight: '800', color: '#FFF'}}>{stats.total_trips}</Text>
                        <Text style={{fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.6)'}}>TOTAL</Text>
                    </View>
                    <View style={s.statDivider} />
                    <View style={s.statItem}>
                        <Text style={{fontSize: 14, fontWeight: '700', color: '#FFF'}}>{stats.member_since}</Text>
                        <Text style={{fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.6)'}}>SINCE</Text>
                    </View>
                </View>

                <View style={s.mainDivider} />

                <TouchableOpacity style={s.kycCard} activeOpacity={0.7}>
                    <View style={[s.rowIcon, { backgroundColor: VOICES.driver.accent + '0D' }]}>
                        <Ionicons
                            name={driver?.verified_status === 'approved' ? "shield-checkmark" : "shield-outline"}
                            size={20}
                            color={driver?.verified_status === 'approved' ? '#10B981' : '#F59E0B'}
                        />
                    </View>
                    <View style={{ flex: 1, marginLeft: 16 }}>
                        <Text style={{fontSize: 14, fontWeight: '700', color: '#FFF'}}>Security status</Text>
                        <Text style={{fontSize: 11, fontWeight: '700', color: driver?.verified_status === 'approved' ? '#10B981' : '#F59E0B'}}>
                            {driver?.verified_status === 'approved' ? 'Authorized' :
                                driver?.verified_status === 'pending' ? 'Under review' :
                                    'Verification required'}
                        </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color="rgba(255,255,255,0.6)" />
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
                        <Ionicons name="car-outline" size={20} color={VOICES.driver.accent} />
                    </View>
                    <Text style={{fontSize: 14, fontWeight: '700', color: '#FFF', flex: 1, marginLeft: 16}}>VEHICLE CONFIGURATION</Text>
                    <Ionicons name={isEditing ? "chevron-up" : "chevron-forward"} size={20} color="rgba(255,255,255,0.6)" />
                </TouchableOpacity>

                {isEditing && (
                    <View style={[s.editCard, glassSurface(0.15)]}>
                        <View style={s.inputField}>
                            <Text style={{fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.6)', marginBottom: 8, marginLeft: 4}}>MODEL</Text>
                            <TextInput
                                style={s.input}
                                value={editModel}
                                onChangeText={setEditModel}
                                placeholderTextColor="rgba(255,255,255,0.2)"
                                placeholder="e.g. Nissan Sentra"
                            />
                        </View>
                        <View style={[s.inputField, { marginTop: 16 }]}>
                            <Text style={{fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.6)', marginBottom: 8, marginLeft: 4}}>PLATE</Text>
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

                {role === 'pod_commander' && (
                    <TouchableOpacity
                        style={s.menuRow}
                        onPress={() => {
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                            navigation.navigate('CommanderDashboard');
                        }}
                    >
                        <View style={[s.rowIcon, { backgroundColor: 'rgba(29,224,230,0.10)' }]}>
                            <Ionicons name="shield-checkmark" size={20} color="#1DE0E6" />
                        </View>
                        <Text style={{fontSize: 14, fontWeight: '700', color: '#FFF', flex: 1, marginLeft: 16}}>G-LEAD CENTER</Text>
                        <Ionicons name="chevron-forward" size={20} color="rgba(255,255,255,0.6)" />
                    </TouchableOpacity>
                )}

                <TouchableOpacity
                    style={s.menuRow}
                    onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        navigation.navigate('Ratings');
                    }}
                >
                    <View style={[s.rowIcon, { backgroundColor: 'rgba(255,255,255,0.03)' }]}>
                        <Ionicons name="star-outline" size={20} color="#FBBF24" />
                    </View>
                    <Text style={{fontSize: 14, fontWeight: '700', color: '#FFF', flex: 1, marginLeft: 16}}>MY RATINGS</Text>
                    <Ionicons name="chevron-forward" size={20} color="rgba(255,255,255,0.6)" />
                </TouchableOpacity>

                <TouchableOpacity
                    style={s.menuRow}
                    onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        navigation.navigate('StrategySettings');
                    }}
                >
                    <View style={[s.rowIcon, { backgroundColor: 'rgba(255,255,255,0.03)' }]}>
                        <Ionicons name="rocket-outline" size={20} color="#F59E0B" />
                    </View>
                    <Text style={{fontSize: 14, fontWeight: '700', color: '#FFF', flex: 1, marginLeft: 16}}>STRATEGY PROTOCOLS</Text>
                    <Ionicons name="chevron-forward" size={20} color="rgba(255,255,255,0.6)" />
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
                    <Ionicons name="chevron-forward" size={20} color="rgba(255,255,255,0.6)" />
                </TouchableOpacity>

                <TouchableOpacity style={s.logoutBtn} onPress={handleLogout}>
                    <Ionicons name="log-out-outline" size={20} color="#F59E0B" style={{ marginRight: 8 }} />
                    <Text style={{fontSize: 14, fontWeight: '600', color: '#F59E0B'}}>Sign out</Text>
                </TouchableOpacity>

                <TouchableOpacity style={[s.logoutBtn, { marginTop: 16, borderColor: 'rgba(239,68,68,0.4)' }]} onPress={handlePurgeAccount}>
                    <Ionicons name="trash-outline" size={20} color="#FF4D4D" style={{ marginRight: 8 }} />
                    <Text style={{fontSize: 14, fontWeight: '700', color: '#FF4D4D'}}>PURGE ACCOUNT & DATA</Text>
                </TouchableOpacity>

                <View style={s.footerBranding}>
                    <Text style={{fontSize: 22, fontWeight: '900', color: VOICES.driver.accent, letterSpacing: 2}}>G-TAXI</Text>
                    <Text style={{fontSize: 10, fontWeight: '600', color: 'rgba(255,255,255,0.6)', marginTop: 12}}>PILOT COMMAND V3.2 • EMPIRE OS</Text>
                </View>

                <View style={{ height: insets.bottom + 40 }} />
            </ScrollView>
            </KeyboardAvoidingView>
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: SURFACE.base },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    header: {
        position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20,
        ...ghostBorder(0.15),
    },
    headerInner: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 20, paddingBottom: 16,
    },
    headerBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' },
    identity: { alignItems: 'center', paddingVertical: 24 },
    avatar: { width: 88, height: 88, borderRadius: 44, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: VOICES.driver.accent },
    ratingBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: VOICES.driver.accent, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, marginTop: 16 },
    statsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 28, paddingHorizontal: 4 },
    statItem: { alignItems: 'center', flex: 1 },
    statDivider: { width: 1, height: 32, backgroundColor: 'rgba(255,255,255,0.05)' },
    mainDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.05)', marginVertical: 4 },
    menuRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 22 },
    rowIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', ...ghostBorder(0.15) },
    kycCard: { flexDirection: 'row', alignItems: 'center', paddingVertical: 20 },
    editCard: { padding: 20, marginTop: 4, marginBottom: 20, borderRadius: 20 },
    inputField: { width: '100%' },
    input: { height: 56, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 14, paddingHorizontal: 16, color: '#FFF', fontSize: 16, fontWeight: '600', ...ghostBorder(0.15) },
    saveBtn: { height: 56, backgroundColor: VOICES.driver.accent, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginTop: 24, ...elevationGlow(5) },
    logoutBtn: { marginTop: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 18, borderRadius: 18, ...ghostBorder(0.15), backgroundColor: 'rgba(239,68,68,0.03)' },
    footerBranding: { alignItems: 'center', marginTop: 40, opacity: 0.8 },
});
