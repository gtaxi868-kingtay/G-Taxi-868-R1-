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

const { width } = Dimensions.get('window');

// ── Driver-only tokens ────────────────────────────────────────────────────────
const C = {
    bg: '#07050F',
    surface: '#110E22',
    surfaceHigh: '#1A1530',
    border: 'rgba(139,92,246,0.15)',
    purple: '#7C3AED',
    purpleLight: '#A78BFA',
    purpleDim: 'rgba(124,58,237,0.18)',
    gold: '#F59E0B',
    green: '#10B981',
    red: '#EF4444',
    white: '#FFFFFF',
    muted: 'rgba(255,255,255,0.45)',
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

    if (loading) return <View style={[s.root, s.center]}><ActivityIndicator color={C.purple} /></View>;

    return (
        <View style={s.root}>
            <StatusBar style="light" />

            {/* HEADER: [← back] | ["Profile" centered] | [spacer] */}
            <BlurView tint="dark" intensity={80} style={[s.header, { paddingTop: insets.top + 8 }]}>
                <TouchableOpacity
                    style={s.headerBtn}
                    onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); navigation.goBack(); }}
                >
                    <Ionicons name="chevron-back" size={22} color={C.white} />
                </TouchableOpacity>
                <Txt variant="headingM" weight="bold" color={C.white}>Profile</Txt>
                <View style={s.headerBtn} pointerEvents="none" />
            </BlurView>

            <ScrollView contentContainerStyle={{ paddingTop: insets.top + 80, paddingHorizontal: 20 }}>
                {/* AVATAR: 80x80 circle, purple gradient bg, driver name initial large white */}
                <View style={s.identity}>
                    <LinearGradient colors={[C.purple, '#4C1D95']} style={s.avatar}>
                        <Txt variant="headingL" weight="bold" color={C.white}>
                            {driver?.name?.charAt(0).toUpperCase()}
                        </Txt>
                    </LinearGradient>

                    {/* NAME: bold 24px below avatar | vehicle_model + plate_number caption below */}
                    <Txt variant="headingL" weight="bold" color={C.white} style={{ marginTop: 16, fontSize: 24 }}>
                        {driver?.name}
                    </Txt>
                    <Txt variant="bodyReg" color={C.muted} style={{ marginTop: 4 }}>
                        {driver?.vehicle_model} · {driver?.plate_number}
                    </Txt>

                    {/* RATING: ⭐ + rating.toFixed(1) centered */}
                    <View style={s.ratingBadge}>
                        <Ionicons name="star" size={14} color={C.bg} />
                        <Txt variant="bodyBold" color={C.bg} style={{ marginLeft: 4 }}>
                            {(driver?.rating || 5.0).toFixed(1)}
                        </Txt>
                    </View>
                </View>

                {/* STATS ROW: trips today | total trips | member since date */}
                <View style={s.statsRow}>
                    <View style={s.statItem}>
                        <Txt variant="headingM" weight="bold" color={C.white}>{stats.trips_today}</Txt>
                        <Txt variant="caption" color={C.muted}>TRIPS TODAY</Txt>
                    </View>
                    <View style={s.statDivider} />
                    <View style={s.statItem}>
                        <Txt variant="headingM" weight="bold" color={C.white}>{stats.total_trips}</Txt>
                        <Txt variant="caption" color={C.muted}>TOTAL TRIPS</Txt>
                    </View>
                    <View style={s.statDivider} />
                    <View style={s.statItem}>
                        <Txt variant="bodyBold" weight="bold" color={C.white}>{stats.member_since}</Txt>
                        <Txt variant="caption" color={C.muted}>MEMBER SINCE</Txt>
                    </View>
                </View>

                <View style={s.mainDivider} />

                {/* KYC STATUS SECTION */}
                <View style={s.kycCard}>
                    <View style={s.rowIcon}>
                        <Ionicons
                            name={driver?.verified_status === 'approved' ? "shield-checkmark" : "shield-outline"}
                            size={20}
                            color={driver?.verified_status === 'approved' ? C.green : C.gold}
                        />
                    </View>
                    <View style={{ flex: 1, marginLeft: 16 }}>
                        <Txt variant="bodyBold" color={C.white}>Account Verification</Txt>
                        <Txt variant="caption" color={driver?.verified_status === 'approved' ? C.green : C.muted}>
                            {driver?.verified_status === 'approved' ? 'Profile Verified' :
                                driver?.verified_status === 'pending' ? 'Review in progress' :
                                    'Documents required'}
                        </Txt>
                    </View>
                    <TouchableOpacity
                        style={s.verifyBtn}
                        onPress={() => {
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                            Alert.alert("KYC Upload", "Document upload requires expo-image-picker. This will be enabled in the next update.");
                        }}
                    >
                        <Txt variant="small" color={C.white}>Manage</Txt>
                    </TouchableOpacity>
                </View>

                <View style={s.mainDivider} />

                {/* EDIT PROFILE ROW with chevron → */}
                <TouchableOpacity
                    style={s.menuRow}
                    onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setIsEditing(!isEditing);
                    }}
                >
                    <View style={s.rowIcon}>
                        <Ionicons name="car-outline" size={20} color={C.purpleLight} />
                    </View>
                    <Txt variant="bodyBold" color={C.white} style={{ flex: 1, marginLeft: 16 }}>Edit Vehicle Details</Txt>
                    <Ionicons name="chevron-forward" size={20} color={C.muted} />
                </TouchableOpacity>

                <TouchableOpacity
                    style={s.menuRow}
                    onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        navigation.navigate('StrategySettings');
                    }}
                >
                    <View style={s.rowIcon}>
                        <Ionicons name="rocket-outline" size={20} color={C.gold} />
                    </View>
                    <Txt variant="bodyBold" color={C.white} style={{ flex: 1, marginLeft: 16 }}>AI Business Strategy</Txt>
                    <Ionicons name="chevron-forward" size={20} color={C.muted} />
                </TouchableOpacity>

                {isEditing && (
                    <BlurView tint="dark" intensity={40} style={s.editCard}>
                        <TextInput
                            style={s.input}
                            value={editModel}
                            onChangeText={setEditModel}
                            placeholder="Vehicle Model"
                            placeholderTextColor={C.muted}
                        />
                        <TextInput
                            style={[s.input, { marginTop: 12 }]}
                            value={editPlate}
                            onChangeText={(t: string) => setEditPlate(t.toUpperCase())}
                            placeholder="License Plate"
                            placeholderTextColor={C.muted}
                        />
                        <TouchableOpacity style={s.saveBtn} onPress={handleSave} disabled={saving}>
                            {saving ? <ActivityIndicator color={C.white} /> : <Txt variant="bodyBold" color={C.white}>Update Vehicle</Txt>}
                        </TouchableOpacity>
                    </BlurView>
                )}

                <View style={s.mainDivider} />

                {/* SIGN OUT BUTTON — red ghost at bottom */}
                <TouchableOpacity style={s.logoutBtn} onPress={handleLogout}>
                    <Txt variant="bodyBold" color={C.red}>Sign Out</Txt>
                </TouchableOpacity>

                <View style={{ height: insets.bottom + 40 }} />
            </ScrollView>
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: C.bg },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    header: {
        position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: 1, borderColor: C.border,
    },
    headerBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' },
    identity: { alignItems: 'center', paddingVertical: 20 },
    avatar: { width: 80, height: 80, borderRadius: 40, justifyContent: 'center', alignItems: 'center', elevation: 10, shadowColor: C.purple, shadowRadius: 10, shadowOpacity: 0.3 },
    ratingBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.gold, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 20, marginTop: 14 },
    statsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 24, paddingHorizontal: 10 },
    statItem: { alignItems: 'center', flex: 1 },
    statDivider: { width: 1, height: 24, backgroundColor: 'rgba(255,255,255,0.1)' },
    mainDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.06)', marginVertical: 8 },
    menuRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 20 },
    rowIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: C.purpleDim, alignItems: 'center', justifyContent: 'center' },
    editCard: { padding: 20, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.03)', marginBottom: 20 },
    input: { height: 50, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 12, paddingHorizontal: 16, color: '#FFF' },
    saveBtn: { height: 50, backgroundColor: C.purple, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 16 },
    kycCard: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, paddingHorizontal: 4 },
    verifyBtn: { backgroundColor: C.surfaceHigh, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: C.border },
    logoutBtn: { marginTop: 40, alignItems: 'center', paddingVertical: 16, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(239,68,68,0.2)', backgroundColor: 'rgba(239,68,68,0.05)' },
});
