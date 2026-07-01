import React, { useState, useEffect } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity, ScrollView,
    Alert, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@gtaxi/core';
import { useAuth } from '../context/AuthContext';
import type { AppScreenProps } from '../navigation/types';

const DESTINATIONS = [
    { code: 'TAB', label: 'Tobago', emoji: '🏖️', desc: 'Short hop. Great beaches. Low cost.' },
    { code: 'BGI', label: 'Barbados', emoji: '🌊', desc: 'Caribbean classic. 3-night sweet spot.' },
    { code: 'GND', label: 'Grenada', emoji: '🌿', desc: 'Spice Isle. Uncrowded. Underrated.' },
    { code: 'ANU', label: 'Antigua', emoji: '⛵', desc: '365 beaches. One for every day.' },
    { code: 'SKB', label: 'St Kitts', emoji: '🏔️', desc: 'Rainforest meets reef.' },
    { code: 'SLU', label: 'St Lucia', emoji: '🌋', desc: 'Pitons. Waterfalls. Romance.' },
    { code: 'SXM', label: 'St Maarten', emoji: '🛬', desc: 'Duty-free shopping. Two sides of paradise.' },
    { code: 'HAV', label: 'Havana', emoji: '🎺', desc: 'Culture. Music. Classic cars.' },
];

export function TravelWaitlistScreen({ navigation }: AppScreenProps<'TravelWaitlist'>) {
    const insets = useSafeAreaInsets();
    const { user } = useAuth();
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [existing, setExisting] = useState<Set<string>>(new Set());
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!user) return;
        supabase
            .from('travel_waitlist')
            .select('destination_code')
            .eq('user_id', user.id)
            .then(({ data }) => {
                if (data) {
                    const codes = new Set(data.map((r: any) => r.destination_code));
                    setExisting(codes);
                    setSelected(codes);
                }
            });
    }, [user]);

    const toggle = (code: string) => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        setSelected(prev => {
            const next = new Set(prev);
            if (next.has(code)) next.delete(code);
            else next.add(code);
            return next;
        });
    };

    const save = async () => {
        if (!user) return;
        setSaving(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

        try {
            const toAdd = [...selected].filter(c => !existing.has(c));
            const toRemove = [...existing].filter(c => !selected.has(c));

            if (toAdd.length > 0) {
                const { error } = await supabase
                    .from('travel_waitlist')
                    .upsert(toAdd.map(code => ({
                        user_id: user.id,
                        destination_code: code,
                    })));
                if (error) throw error;
            }

            if (toRemove.length > 0) {
                const { error } = await supabase
                    .from('travel_waitlist')
                    .delete()
                    .eq('user_id', user.id)
                    .in('destination_code', toRemove);
                if (error) throw error;
            }

            setExisting(new Set(selected));
            Alert.alert('Saved', 'We\'ll notify you as soon as matching packages drop.');
            navigation.goBack();
        } catch (err: any) {
            Alert.alert('Error', err.message || 'Could not save. Please try again.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <View style={[styles.root, { paddingTop: insets.top }]}>
            <StatusBar style="light" />

            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
                    <Ionicons name="chevron-back" size={24} color="#EAF3F6" />
                </TouchableOpacity>
                <View style={{ marginLeft: 12 }}>
                    <Text style={styles.headerTitle}>Destination Wishlist</Text>
                    <Text style={styles.headerSub}>Get notified when packages drop</Text>
                </View>
            </View>

            <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]}>
                <Text style={styles.intro}>
                    Select the islands you want to visit. We'll alert you the moment a package goes live.
                </Text>

                {DESTINATIONS.map(d => {
                    const isSelected = selected.has(d.code);
                    return (
                        <TouchableOpacity
                            key={d.code}
                            activeOpacity={0.85}
                            onPress={() => toggle(d.code)}
                            style={[styles.destCard, isSelected && styles.destCardSelected]}
                        >
                            <Text style={styles.emoji}>{d.emoji}</Text>
                            <View style={{ flex: 1 }}>
                                <Text style={styles.destLabel}>{d.label}</Text>
                                <Text style={styles.destDesc}>{d.desc}</Text>
                            </View>
                            <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
                                {isSelected && <Ionicons name="checkmark" size={14} color="#EAF3F6" />}
                            </View>
                        </TouchableOpacity>
                    );
                })}
            </ScrollView>

            <View style={[styles.ctaBar, { paddingBottom: insets.bottom + 16 }]}>
                <TouchableOpacity
                    style={[styles.saveBtn, saving && { opacity: 0.6 }]}
                    onPress={save}
                    disabled={saving}
                >
                    {saving
                        ? <ActivityIndicator size="small" color="#EAF3F6" />
                        : <Text style={styles.saveBtnText}>
                            Save {selected.size > 0 ? `(${selected.size} destination${selected.size > 1 ? 's' : ''})` : ''}
                          </Text>
                    }
                </TouchableOpacity>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: '#07070F' },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 8 },
    backBtn: { width: 44, height: 44, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' },
    headerTitle: { color: '#EAF3F6', fontWeight: '800', fontSize: 20 },
    headerSub: { color: 'rgba(255,255,255,0.4)', fontSize: 12, marginTop: 1 },
    scroll: { padding: 20, gap: 12 },
    intro: { color: 'rgba(255,255,255,0.4)', fontSize: 14, lineHeight: 20, marginBottom: 8 },
    destCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 20, padding: 18, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
    destCardSelected: { backgroundColor: 'rgba(52,230,236,0.1)', borderColor: 'rgba(52,230,236,0.3)' },
    emoji: { fontSize: 28 },
    destLabel: { color: '#EAF3F6', fontWeight: '700', fontSize: 16 },
    destDesc: { color: 'rgba(255,255,255,0.4)', fontSize: 12, marginTop: 2 },
    checkbox: { width: 24, height: 24, borderRadius: 8, borderWidth: 2, borderColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
    checkboxSelected: { backgroundColor: '#6D28D9', borderColor: '#6D28D9' },
    ctaBar: { paddingHorizontal: 20, paddingTop: 16, backgroundColor: 'rgba(10,10,15,0.95)', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' },
    saveBtn: { backgroundColor: '#6D28D9', borderRadius: 20, paddingVertical: 16, alignItems: 'center' },
    saveBtnText: { color: '#EAF3F6', fontWeight: '700', fontSize: 16 },
});
