import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { initializeSupabaseClient } from '@gtaxi/core';
import { useAuth } from '../context/AuthContext';
import { useMerchant } from '../context/MerchantContext';
import { BusinessTypePicker } from '../components/BusinessTypePicker';
import { Mood, SERIF, type as T, useMood, useStyles } from '../ui/mood';

const { supabase } = initializeSupabaseClient('native');
type IconName = keyof typeof Ionicons.glyphMap;

// Everything that is not part of the daily work lives here.
export function YouScreen({ navigation }: { navigation: { navigate: (route: string) => void } }) {
    const insets = useSafeAreaInsets();
    const m = useMood();
    const s = useStyles(makeStyles);
    const { signOut } = useAuth();
    const { merchant, type, isOwner } = useMerchant();
    const [changingType, setChangingType] = useState(false);

    const rows: { icon: IconName; label: string; sub: string; route: string }[] = [
        { icon: 'sparkles-outline', label: 'Your brand', sub: 'Your look and offers on the map', route: 'Brand' },
        { icon: 'megaphone-outline', label: 'Promotions', sub: 'Boost your business to nearby riders', route: 'Promotions' },
        ...(type?.key === 'stays' ? [{ icon: 'airplane-outline' as IconName, label: 'Airport pickups', sub: 'Book a ride for an arriving guest', route: 'AirportPickups' }] : []),
        ...(type?.key === 'drinks' ? [{ icon: 'wine-outline' as IconName, label: 'G Spot', sub: 'Members and drink codes', route: 'GSpot' }] : []),
        { icon: 'wifi-outline', label: 'Tap to Pay', sub: 'Customer pays from their G-Coin wallet', route: 'NfcAcceptPayment' },
        { icon: 'car-sport-outline', label: 'Send a car', sub: type?.dispatchLabel ?? 'Send a car for a customer', route: 'Dispatch' },
        ...(type?.bookings && type.work.route !== 'Appointments' ? [{ icon: 'calendar-outline' as IconName, label: 'Appointments', sub: 'View and manage bookings', route: 'Appointments' }] : []),
        { icon: 'people-outline', label: 'Staff', sub: 'Manage your team', route: 'Staff' },
        { icon: 'trending-up-outline', label: 'Equity', sub: 'Ownership milestones', route: 'EquityProgress' },
    ];

    const confirmDelete = () => Alert.alert(
        'Delete Account',
        'Your account and business data will be deleted in 30 days. Sign in again before then and you can cancel it.',
        [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Schedule deletion', style: 'destructive',
                onPress: async () => {
                    const { data, error } = await supabase.rpc('request_account_deletion')
                        .then((r: any) => r, (e: any) => ({ data: null, error: e }));
                    if (error || !data?.success) {
                        Alert.alert('Could not submit', 'Please try again, or email privacy@gtaxi.tt.');
                        return;
                    }
                    const when = data.scheduled_at ? new Date(data.scheduled_at).toLocaleDateString() : 'in 30 days';
                    Alert.alert('Deletion scheduled', `Your account will be deleted on ${when}.`);
                    await signOut();
                },
            },
        ],
    );

    return (
        <ScrollView style={s.root} contentContainerStyle={{ paddingTop: insets.top + 16, paddingHorizontal: 18, paddingBottom: 32 }}>
            <Text style={s.title}>{merchant?.name ?? 'You'}</Text>
            <Text style={s.sub}>{type?.label ?? 'Your business'}</Text>

            {rows.map((r) => (
                <TouchableOpacity key={r.route} style={s.row} onPress={() => navigation.navigate(r.route)} accessibilityRole="button" accessibilityLabel={r.label}>
                    <LinearGradient colors={m.goldFace as [string, string, string]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.icon}>
                        <Ionicons name={r.icon} size={21} color={m.onGold} />
                    </LinearGradient>
                    <View style={{ flex: 1 }}>
                        <Text style={s.label}>{r.label}</Text>
                        <Text style={s.desc}>{r.sub}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={m.dim} />
                </TouchableOpacity>
            ))}

            {isOwner && (changingType ? (
                <View style={{ marginTop: 14 }}>
                    <BusinessTypePicker title="Change business type" onDone={() => setChangingType(false)} />
                </View>
            ) : (
                <TouchableOpacity style={s.row} onPress={() => setChangingType(true)} accessibilityRole="button">
                    <View style={s.plainIcon}><Ionicons name="options-outline" size={20} color={m.gold} /></View>
                    <View style={{ flex: 1 }}>
                        <Text style={s.label}>Business type</Text>
                        <Text style={s.desc}>{type?.label ?? 'Not chosen yet'}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={m.dim} />
                </TouchableOpacity>
            ))}

            <TouchableOpacity style={s.quiet} onPress={signOut} accessibilityRole="button">
                <Text style={s.quietText}>Sign out</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.quiet} onPress={confirmDelete} accessibilityRole="button" accessibilityLabel="Request account deletion">
                <Text style={s.deleteText}>Delete account</Text>
            </TouchableOpacity>
        </ScrollView>
    );
}

const makeStyles = (m: Mood) => StyleSheet.create({
    root: { flex: 1, backgroundColor: m.page },
    title: { fontFamily: SERIF, fontSize: 36, lineHeight: 41, color: m.ink },
    sub: { ...T.body, marginBottom: 16, color: m.dim },
    row: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, marginBottom: 10, borderRadius: 22, backgroundColor: m.card, borderWidth: 2, borderColor: m.line, borderBottomWidth: 5, borderBottomColor: m.raised },
    icon: { width: 46, height: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 3, borderBottomColor: m.goldLip },
    plainIcon: { width: 46, height: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: m.goldWash },
    label: { ...T.strong, color: m.ink },
    desc: { ...T.small, color: m.dim },
    quiet: { marginTop: 14, alignItems: 'center', padding: 8 },
    quietText: { ...T.strong, color: m.ink },
    deleteText: { ...T.small, color: m.danger },
});
