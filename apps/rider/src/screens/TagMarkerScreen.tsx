import React, { useState } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity, TextInput,
    useWindowDimensions, ActivityIndicator, Alert, ScrollView, Platform,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '@gtaxi/core';

const COLORS = {
    bg: '#0D0B1E',
    purple: '#7B5CF0',
    cyan: '#00E5FF',
    white: '#FFFFFF',
    textSecondary: 'rgba(255,255,255,0.6)',
    glassBg: 'rgba(255,255,255,0.06)',
    glassBorder: 'rgba(123,92,240,0.3)',
    success: '#00FF94',
    error: '#FF4D6D',
};

type NodeType = 'merchant' | 'taxi_stand';

export function TagMarkerScreen({ navigation, route }: any) {
    const { width } = useWindowDimensions();
    const insets = useSafeAreaInsets();
    const tagUid = route?.params?.tagUid || '';

    const [nodeType, setNodeType] = useState<NodeType | null>(null);
    const [locationName, setLocationName] = useState('');
    const [merchantName, setMerchantName] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const handleProvision = async () => {
        if (!nodeType) {
            Alert.alert('Select Type', 'Choose whether this tag is for a merchant or a taxi stand.');
            return;
        }
        if (!locationName.trim()) {
            Alert.alert('Location Required', 'Please enter a name for this location.');
            return;
        }
        if (nodeType === 'merchant' && !merchantName.trim()) {
            Alert.alert('Merchant Name Required', 'Please enter the merchant name.');
            return;
        }

        setSubmitting(true);
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) {
                Alert.alert('Sign In Required', 'Please sign in to provision tags.');
                setSubmitting(false);
                return;
            }

            let merchantId: string | null = null;
            if (nodeType === 'merchant') {
                const { data: existing } = await supabase
                    .from('merchants')
                    .select('id')
                    .eq('name', merchantName.trim())
                    .maybeSingle();

                if (existing) {
                    merchantId = existing.id;
                } else {
                    const { data: newMerchant, error: mErr } = await supabase
                        .from('merchants')
                        .insert({ name: merchantName.trim() })
                        .select('id')
                        .single();

                    if (mErr) throw mErr;
                    merchantId = newMerchant.id;
                }
            }

            const { error } = await supabase
                .from('kiosk_nodes')
                .insert({
                    tag_uid: tagUid,
                    location_name: locationName.trim(),
                    merchant_id: merchantId,
                    lat: 0,
                    lng: 0,
                });

            if (error) throw error;

            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            Alert.alert(
                'Tag Provisioned',
                `Tag ${tagUid} has been registered as a ${nodeType} node.`,
                [{ text: 'Done', onPress: () => navigation.goBack() }]
            );
        } catch (err: any) {
            Alert.alert('Provision Failed', err?.message || 'Could not register tag. Please try again.');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <View style={[s.container, { paddingTop: insets.top }]}>
            <LinearGradient colors={['#1A0533', '#0D1B4B']} style={StyleSheet.absoluteFillObject} />

            <TouchableOpacity style={[s.backBtn, { top: insets.top + 8 }]} onPress={() => navigation.goBack()}>
                <Ionicons name="close" size={28} color={COLORS.white} />
            </TouchableOpacity>

            <ScrollView contentContainerStyle={s.scrollContent} keyboardShouldPersistTaps="handled">
                <View style={s.header}>
                    <View style={s.badgeIcon}>
                        <Ionicons name="pricetag" size={32} color={COLORS.cyan} />
                    </View>
                    <Text style={s.headerTitle}>New Tag Detected</Text>
                    <Text style={s.tagCode}>{tagUid}</Text>
                    <Text style={s.headerSubtitle}>
                        This tag is not yet registered. Choose how to bind it.
                    </Text>
                </View>

                <BlurView intensity={40} tint="dark" style={s.card}>
                    <Text style={s.sectionTitle}>Tag Type</Text>
                    <View style={s.typeRow}>
                        <TouchableOpacity
                            style={[s.typeOption, nodeType === 'merchant' && s.typeOptionActive]}
                            onPress={() => setNodeType('merchant')}
                        >
                            <Ionicons
                                name="storefront"
                                size={24}
                                color={nodeType === 'merchant' ? COLORS.purple : COLORS.textSecondary}
                            />
                            <Text style={[s.typeLabel, nodeType === 'merchant' && s.typeLabelActive]}>
                                Merchant
                            </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[s.typeOption, nodeType === 'taxi_stand' && s.typeOptionActive]}
                            onPress={() => setNodeType('taxi_stand')}
                        >
                            <Ionicons
                                name="flag"
                                size={24}
                                color={nodeType === 'taxi_stand' ? COLORS.purple : COLORS.textSecondary}
                            />
                            <Text style={[s.typeLabel, nodeType === 'taxi_stand' && s.typeLabelActive]}>
                                Taxi Stand
                            </Text>
                        </TouchableOpacity>
                    </View>

                    <Text style={s.sectionTitle}>Location Name</Text>
                    <TextInput
                        style={s.input}
                        value={locationName}
                        onChangeText={setLocationName}
                        placeholder="e.g. Scarborough Mall Entrance"
                        placeholderTextColor="rgba(255,255,255,0.3)"
                    />

                    {nodeType === 'merchant' && (
                        <>
                            <Text style={s.sectionTitle}>Merchant Name</Text>
                            <TextInput
                                style={s.input}
                                value={merchantName}
                                onChangeText={setMerchantName}
                                placeholder="e.g. Green Valley Grocery"
                                placeholderTextColor="rgba(255,255,255,0.3)"
                            />
                        </>
                    )}

                    {submitting ? (
                        <ActivityIndicator size="large" color={COLORS.purple} style={{ marginTop: 24 }} />
                    ) : (
                        <TouchableOpacity style={s.submitBtn} onPress={handleProvision}>
                            <LinearGradient colors={[COLORS.purple, COLORS.cyan]} style={s.submitGradient}>
                                <Ionicons name="checkmark-circle" size={22} color={COLORS.white} />
                                <Text style={s.submitText}>Register Tag</Text>
                            </LinearGradient>
                        </TouchableOpacity>
                    )}
                </BlurView>
            </ScrollView>
        </View>
    );
}

const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: COLORS.bg },
    backBtn: { position: 'absolute', left: 16, zIndex: 10, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.1)', justifyContent: 'center', alignItems: 'center' },
    scrollContent: { padding: 24, paddingTop: 80, paddingBottom: 48 },
    header: { alignItems: 'center', marginBottom: 24 },
    badgeIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: COLORS.glassBg, justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
    headerTitle: { fontSize: 22, fontWeight: '800', color: COLORS.white, marginBottom: 8 },
    tagCode: { fontSize: 14, color: COLORS.cyan, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', backgroundColor: 'rgba(0,229,255,0.1)', paddingHorizontal: 16, paddingVertical: 6, borderRadius: 8, marginBottom: 12, letterSpacing: 2 },
    headerSubtitle: { fontSize: 14, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 20 },
    card: { width: '100%', borderRadius: 32, padding: 24, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.glassBorder },
    sectionTitle: { fontSize: 13, fontWeight: '700', color: COLORS.textSecondary, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 12, marginTop: 8 },
    typeRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
    typeOption: { flex: 1, padding: 20, borderRadius: 20, backgroundColor: COLORS.glassBg, borderWidth: 1, borderColor: 'transparent', alignItems: 'center', gap: 8 },
    typeOptionActive: { borderColor: COLORS.purple, backgroundColor: 'rgba(123,92,240,0.15)' },
    typeLabel: { fontSize: 14, fontWeight: '600', color: COLORS.textSecondary },
    typeLabelActive: { color: COLORS.purple },
    input: { width: '100%', backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 16, padding: 16, fontSize: 16, color: COLORS.white, marginBottom: 16, borderWidth: 1, borderColor: COLORS.glassBorder },
    submitBtn: { width: '100%', height: 56, borderRadius: 28, marginTop: 16, overflow: 'hidden' },
    submitGradient: { flex: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 },
    submitText: { color: COLORS.white, fontSize: 17, fontWeight: '800' },
});
