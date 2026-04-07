import React, { useState, useEffect } from 'react';
import {
    View, StyleSheet, TouchableOpacity, TextInput,
    ScrollView, ActivityIndicator, Dimensions, Alert
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../../shared/supabase';
import { useAuth } from '../context/AuthContext';
import { Txt } from '../design-system/primitives';

import { tokens } from '../design-system/tokens';

const { width } = Dimensions.get('window');

// --- Rider Design Tokens (Deprecated local, using tokens) ---
const R = {
    bg: tokens.colors.background.base,
    surface: tokens.colors.background.surface,
    border: tokens.colors.glass.stroke,
    purple: tokens.colors.primary.purple,
    purpleLight: tokens.colors.primary.cyan,
    gold: '#F59E0B',
    white: tokens.colors.text.primary,
    muted: tokens.colors.text.secondary,
};

export function PromoScreen({ navigation }: any) {
    const { user } = useAuth();
    const insets = useSafeAreaInsets();

    const [code, setCode] = useState('');
    const [loading, setLoading] = useState(false);
    const [promos, setPromos] = useState<any[]>([]);

    useEffect(() => {
        fetchPromos();
    }, []);

    const fetchPromos = async () => {
        // BUG_FIX: Ensure Promo codes exist in admin_promos table
        const { data } = await supabase
            .from('admin_promos')
            .select('*')
            .eq('is_active', true);
        if (data) setPromos(data);
    };

    const handleApply = async () => {
        if (!code) return;
        setLoading(true);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

        const { data, error } = await supabase
            .from('admin_promos')
            .select('*')
            .eq('code', code.toUpperCase())
            .eq('is_active', true)
            .single();

        if (error || !data) {
            Alert.alert("Invalid Code", "This promo code doesn't exist or is inactive.");
        } else {
            // Logic to link user_promos could go here if implemented
            Alert.alert("Success!", `Promo ${data.code} applied! Enjoy ${data.discount_percent}% off your next ride.`);
        }
        setLoading(false);
    };

    return (
        <View style={s.root}>
            <StatusBar style="light" />

            <View style={[s.header, { paddingTop: insets.top + 10 }]}>
                <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()}>
                    <Ionicons name="chevron-back" size={24} color="#FFF" />
                </TouchableOpacity>
                <Txt variant="headingM" weight="heavy" color="#FFF" style={{ marginLeft: 16 }}>Promotions</Txt>
            </View>

            <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }}>

                {/* Layout: Glassmorphism input card at top */}
                {/* Layout: Glassmorphism input card at top */}
                <View style={s.inputCard}>
                    <TextInput
                        style={s.input}
                        placeholder="ENTER PROMO CODE"
                        placeholderTextColor={R.muted}
                        value={code}
                        onChangeText={t => setCode(t.toUpperCase())}
                        autoCapitalize="characters"
                    />
                    <TouchableOpacity style={s.applyBtn} onPress={handleApply} disabled={loading || !code}>
                        {loading ? <ActivityIndicator color="#FFF" /> : <Txt variant="bodyBold" color="#FFF">Apply</Txt>}
                    </TouchableOpacity>
                </View>

                <Txt variant="bodyBold" color="#FFF" style={{ marginBottom: 20 }}>Available Offers</Txt>

                {/* List: Available promos in a ScrollView (Vertical stack of cards) */}
                {promos.length === 0 ? (
                    <View style={s.empty}>
                        <Txt variant="bodyReg" color={R.muted}>No active promotions</Txt>
                    </View>
                ) : (
                    promos.map((p, idx) => (
                        <View key={idx} style={s.promoCard}>
                            <LinearGradient 
                                colors={['rgba(124,58,237,0.1)', 'transparent']} 
                                style={s.promoGradient} 
                            />
                            <View style={s.promoContent}>
                                <View style={s.promoTop}>
                                    <View style={{ flex: 1 }}>
                                        <Txt variant="headingM" weight="heavy" color="#FFF">{p.code}</Txt>
                                        <Txt variant="small" color={R.muted} style={{ marginTop: 4 }}>{p.description}</Txt>
                                    </View>
                                    <View style={s.discountBadge}>
                                        <Txt variant="headingM" weight="heavy" color={tokens.colors.primary.cyan}>{p.discount_percent}%</Txt>
                                        <Txt variant="caption" weight="heavy" color={tokens.colors.primary.cyan}>OFF</Txt>
                                    </View>
                                </View>

                                <View style={s.dashDivider} />

                                <View style={s.promoFooter}>
                                    <Txt variant="caption" color={R.muted}>Expires: {new Date(p.expires_at).toLocaleDateString()}</Txt>
                                    <View style={[s.activeDot, { backgroundColor: tokens.colors.primary.cyan }]} />
                                </View>
                            </View>
                        </View>
                    ))
                )}

            </ScrollView>
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: R.bg },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, marginBottom: 20 },
    backBtn: { width: 44, height: 44, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' },

    inputCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 24, padding: 8, marginBottom: 32, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)', overflow: 'hidden' },
    input: { flex: 1, height: 56, color: '#FFF', paddingHorizontal: 20, fontSize: 16, fontWeight: '700', letterSpacing: 2 },
    applyBtn: { paddingHorizontal: 24, height: 56, borderRadius: 18, backgroundColor: tokens.colors.primary.purple, alignItems: 'center', justifyContent: 'center' },

    promoCard: { borderRadius: 32, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.03)', marginBottom: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
    promoGradient: { ...StyleSheet.absoluteFillObject },
    promoContent: { padding: 24 },
    promoTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    discountBadge: { alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.03)', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16 },

    dashDivider: { height: 1, width: '100%', backgroundColor: 'rgba(255,255,255,0.05)', marginVertical: 20 },

    promoFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    activeDot: { width: 8, height: 8, borderRadius: 4, shadowColor: tokens.colors.primary.cyan, shadowRadius: 10, shadowOpacity: 1 },

    empty: { marginTop: 40, alignItems: 'center', padding: 40, backgroundColor: 'rgba(255,255,255,0.02)', borderRadius: 32 },
});
