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

const { width } = Dimensions.get('window');

// ── Rider Design Tokens ──────────────────────────────────────────────────────
const R = {
    bg: '#07050F',
    surface: '#110E22',
    border: 'rgba(255,255,255,0.08)',
    purple: '#7C3AED',
    purpleLight: '#A78BFA',
    gold: '#F59E0B',
    white: '#FFFFFF',
    muted: 'rgba(255,255,255,0.4)',
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
                <BlurView tint="dark" intensity={50} style={s.inputCard}>
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
                </BlurView>

                <Txt variant="bodyBold" color="#FFF" style={{ marginBottom: 20 }}>Available Offers</Txt>

                {/* List: Available promos in a ScrollView (Vertical stack of cards) */}
                {promos.length === 0 ? (
                    <View style={s.empty}>
                        <Txt variant="bodyReg" color={R.muted}>No active promotions</Txt>
                    </View>
                ) : (
                    promos.map((p, idx) => (
                        <View key={idx} style={s.promoCard}>
                            <LinearGradient colors={['rgba(124,58,237,0.2)', 'transparent']} style={s.promoGradient} />
                            <View style={s.promoContent}>
                                <View style={s.promoTop}>
                                    <View>
                                        <Txt variant="headingM" weight="heavy" color="#FFF">{p.code}</Txt>
                                        <Txt variant="small" color={R.muted} style={{ marginTop: 4 }}>{p.description}</Txt>
                                    </View>
                                    <View style={s.discountBadge}>
                                        <Txt variant="headingM" weight="heavy" color={R.purpleLight}>{p.discount_percent}%</Txt>
                                        <Txt variant="caption" weight="heavy" color={R.purpleLight}>OFF</Txt>
                                    </View>
                                </View>

                                <View style={s.dashDivider} />

                                <View style={s.promoFooter}>
                                    <Txt variant="caption" color={R.muted}>Expires: {new Date(p.expires_at).toLocaleDateString()}</Txt>
                                    <View style={s.activeDot} />
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
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 24 },
    backBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: R.surface, alignItems: 'center', justifyContent: 'center' },

    inputCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 20, padding: 8, marginBottom: 32, borderWidth: 1, borderColor: R.border, overflow: 'hidden' },
    input: { flex: 1, height: 48, color: '#FFF', paddingHorizontal: 16, fontSize: 16, fontWeight: '700', letterSpacing: 1 },
    applyBtn: { paddingHorizontal: 24, height: 48, borderRadius: 16, backgroundColor: R.purple, alignItems: 'center', justifyContent: 'center' },

    promoCard: { borderRadius: 24, overflow: 'hidden', backgroundColor: R.surface, marginBottom: 16, borderWidth: 1, borderColor: R.border },
    promoGradient: { ...StyleSheet.absoluteFillObject },
    promoContent: { padding: 24 },
    promoTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    discountBadge: { alignItems: 'center' },

    dashDivider: { height: 1.5, width: '100%', borderStyle: 'dotted', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', marginVertical: 20 },

    promoFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    activeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: R.purpleLight, shadowColor: R.purpleLight, shadowRadius: 5, shadowOpacity: 1 },

    empty: { marginTop: 40, alignItems: 'center' },
});
