import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CrystalFace, RaisedIcon } from '@gtaxi/design-system-native/src/crystal';
import { initializeSupabaseClient } from '@gtaxi/core';
import { SURFACE, VOICES } from '@gtaxi/design-system';
import { useAuth } from '../context/AuthContext';
import { useMerchant } from '../context/MerchantContext';
import { BusinessTypePicker } from '../components/BusinessTypePicker';

const { supabase } = initializeSupabaseClient('native');
const V = VOICES.merchant;
type IconName = keyof typeof Ionicons.glyphMap;

// Everything that is not part of the daily work lives here.
export function YouScreen({ navigation }: { navigation: { navigate: (route: string) => void } }) {
    const insets = useSafeAreaInsets();
    const { signOut } = useAuth();
    const { merchant, type, isOwner } = useMerchant();
    const [changingType, setChangingType] = useState(false);

    const rows: { icon: IconName; label: string; sub: string; route: string }[] = [
        { icon: 'sparkles-outline', label: 'Your brand', sub: 'Your look and offers on the map', route: 'Brand' },
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
                    <View style={s.icon}>
                        <CrystalFace color={V.accent} radius={14} />
                        <RaisedIcon name={r.icon} size={20} />
                    </View>
                    <View style={{ flex: 1 }}>
                        <Text style={s.label}>{r.label}</Text>
                        <Text style={s.desc}>{r.sub}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={V.textMuted} />
                </TouchableOpacity>
            ))}

            {isOwner && (changingType ? (
                <View style={{ marginTop: 14 }}>
                    <BusinessTypePicker title="Change business type" onDone={() => setChangingType(false)} />
                </View>
            ) : (
                <TouchableOpacity style={s.row} onPress={() => setChangingType(true)} accessibilityRole="button">
                    <View style={s.plainIcon}><Ionicons name="options-outline" size={20} color={V.accent} /></View>
                    <View style={{ flex: 1 }}>
                        <Text style={s.label}>Business type</Text>
                        <Text style={s.desc}>{type?.label ?? 'Not chosen yet'}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={V.textMuted} />
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

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: SURFACE.base },
    title: { fontFamily: V.serifSemi, fontSize: 32, color: V.text },
    sub: { marginTop: 2, marginBottom: 16, fontSize: 14, color: V.textMuted },
    row: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, marginBottom: 10, borderRadius: 20, backgroundColor: V.surface, borderWidth: 1, borderColor: 'rgba(233,245,243,0.08)' },
    icon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
    plainIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(45,212,191,0.12)' },
    label: { fontSize: 15, fontWeight: '700', color: V.text },
    desc: { marginTop: 2, fontSize: 13, color: V.textMuted },
    quiet: { marginTop: 14, alignItems: 'center', padding: 8 },
    quietText: { fontSize: 15, fontWeight: '600', color: V.text },
    deleteText: { fontSize: 14, fontWeight: '600', color: '#EF4444' },
});
