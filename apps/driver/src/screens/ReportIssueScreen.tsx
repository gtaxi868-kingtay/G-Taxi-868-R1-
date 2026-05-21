import React, { useState } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity, TextInput,
    ActivityIndicator, Alert, ScrollView, useWindowDimensions,
    KeyboardAvoidingView, Platform
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { initializeSupabaseClient } from '@gtaxi/core';

const { supabase } = initializeSupabaseClient('native');

const COLORS = {
    bgPrimary: '#0D0B1E',
    gradientStart: '#1A1200',
    gradientEnd: '#0D0B1E',
    gold: '#FFD700',
    goldDark: '#B8860B',
    purple: '#7B5CF0',
    error: '#EF4444',
    white: '#FFFFFF',
    textMuted: 'rgba(255,255,255,0.4)',
    textSecondary: 'rgba(255,255,255,0.6)',
    glassBg: 'rgba(255,215,0,0.06)',
    glassBorder: 'rgba(255,176,0,0.3)',
};

const ISSUE_TYPES = [
    { id: 'broken_node', label: 'Broken Node', icon: 'radio-outline', desc: 'NFC kiosk or Smart Puck hardware failure' },
    { id: 'gps_mismatch', label: 'GPS Mismatch', icon: 'location-outline', desc: 'Node location does not match actual position' },
    { id: 'tag_missing', label: 'Missing Tag UID', icon: 'key-outline', desc: 'Node exists but NFC tag ID is unreadable' },
    { id: 'power_outage', label: 'Power Outage', icon: 'flash-off-outline', desc: 'Node has no power or connectivity' },
    { id: 'general', label: 'Other', icon: 'warning-outline', desc: 'General hardware or software issue' },
];

export function ReportIssueScreen({ navigation }: any) {
    const { height } = useWindowDimensions();
    const insets = useSafeAreaInsets();

    const [selectedType, setSelectedType] = useState<string | null>(null);
    const [nodeId, setNodeId] = useState('');
    const [description, setDescription] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const handleSubmit = async () => {
        if (!selectedType || !description.trim()) {
            Alert.alert('Incomplete', 'Please select an issue type and provide a description.');
            return;
        }
        setSubmitting(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) {
                Alert.alert('Unauthorized', 'Please sign in to report an issue.');
                setSubmitting(false);
                return;
            }

            const payload: Record<string, any> = {
                event_type: 'BROKEN_NODE',
                tag_uid: nodeId.trim() || 'UNKNOWN',
                profile_id: session.user.id,
                location_context: {
                    issue_type: selectedType,
                    description: description.trim(),
                    node_id: nodeId.trim() || null,
                    reported_at: new Date().toISOString(),
                },
            };

            const { error } = await supabase
                .from('nfc_event_logs')
                .insert(payload);

            if (error) throw error;

            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            Alert.alert(
                'Alert Sent',
                'Your report has been transmitted to G-Taxi Command. A maintenance crew will be dispatched.',
                [{ text: 'OK', onPress: () => navigation.goBack() }]
            );
        } catch (err: any) {
            console.error('Report failed:', err);
            Alert.alert('Transmission Failed', err.message || 'Could not send report. Please try again.');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <View style={s.root}>
            <LinearGradient colors={[COLORS.gradientStart, COLORS.gradientEnd]} style={StyleSheet.absoluteFillObject} />
            <BlurView tint="dark" intensity={20} style={StyleSheet.absoluteFillObject} />

            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                style={{ flex: 1 }}
            >
            <ScrollView contentContainerStyle={{ paddingTop: insets.top + 20, paddingBottom: insets.bottom + 40, paddingHorizontal: 20 }}>
                {/* Back + Header */}
                <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()}>
                    <Ionicons name="arrow-back" size={24} color={COLORS.white} />
                </TouchableOpacity>

                <View style={s.headerSection}>
                    <View style={s.iconCircle}>
                        <Ionicons name="warning" size={32} color={COLORS.error} />
                    </View>
                    <Text style={s.headerTitle}>Report Issue</Text>
                    <Text style={s.headerSub}>Alert the operations team about a hardware or node problem.</Text>
                </View>

                {/* Issue Type Selection */}
                <Text style={s.sectionLabel}>ISSUE CATEGORY</Text>
                <View style={s.issueGrid}>
                    {ISSUE_TYPES.map(type => (
                        <TouchableOpacity
                            key={type.id}
                            style={[s.issueCard, selectedType === type.id && s.issueCardActive]}
                            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setSelectedType(type.id); }}
                            activeOpacity={0.7}
                        >
                            <View style={[s.issueIcon, selectedType === type.id && s.issueIconActive]}>
                                <Ionicons name={type.icon as any} size={22} color={selectedType === type.id ? COLORS.white : COLORS.gold} />
                            </View>
                            <Text style={[s.issueLabel, selectedType === type.id && s.issueLabelActive]}>{type.label}</Text>
                            <Text style={s.issueDesc}>{type.desc}</Text>
                        </TouchableOpacity>
                    ))}
                </View>

                {/* Node ID Field */}
                <Text style={s.sectionLabel}>NODE ID (OPTIONAL)</Text>
                <View style={s.inputRow}>
                    <Ionicons name="radio-outline" size={18} color={COLORS.gold} style={{ marginRight: 10 }} />
                    <TextInput
                        value={nodeId}
                        onChangeText={setNodeId}
                        placeholder="e.g. 04:9F:3E:2A:1B:7C:80"
                        placeholderTextColor={COLORS.textMuted}
                        style={s.textInput}
                        autoCapitalize="none"
                    />
                </View>

                {/* Description */}
                <Text style={s.sectionLabel}>DESCRIPTION *</Text>
                <TextInput
                    value={description}
                    onChangeText={setDescription}
                    placeholder="Describe the issue in detail..."
                    placeholderTextColor={COLORS.textMuted}
                    style={s.textArea}
                    multiline
                    numberOfLines={5}
                    textAlignVertical="top"
                />

                {/* Submit */}
                <TouchableOpacity
                    style={[s.submitBtn, (!selectedType || !description.trim() || submitting) && { opacity: 0.5 }]}
                    onPress={handleSubmit}
                    disabled={!selectedType || !description.trim() || submitting}
                    activeOpacity={0.8}
                >
                    <LinearGradient colors={['#EF4444', '#DC2626']} style={s.submitGradient}>
                        {submitting ? (
                            <ActivityIndicator color={COLORS.white} />
                        ) : (
                            <>
                                <Ionicons name="warning" size={20} color={COLORS.white} />
                                <Text style={s.submitText}>TRANSMIT HIGH-PRIORITY ALERT</Text>
                            </>
                        )}
                    </LinearGradient>
                </TouchableOpacity>

                <Text style={s.footerNote}>
                    This alert will be sent directly to the G-Taxi Command Center for immediate action.
                </Text>
            </ScrollView>
            </KeyboardAvoidingView>
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: COLORS.bgPrimary },
    backBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
    headerSection: { alignItems: 'center', marginBottom: 32 },
    iconCircle: { width: 72, height: 72, borderRadius: 36, backgroundColor: 'rgba(239,68,68,0.1)', alignItems: 'center', justifyContent: 'center', marginBottom: 16, borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)' },
    headerTitle: { fontSize: 28, fontWeight: '900', color: COLORS.white, marginBottom: 8 },
    headerSub: { fontSize: 14, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 22, paddingHorizontal: 20 },
    sectionLabel: { fontSize: 11, fontWeight: '800', color: COLORS.textMuted, letterSpacing: 1, marginBottom: 12, marginTop: 24, textTransform: 'uppercase' },
    issueGrid: { gap: 12 },
    issueCard: { backgroundColor: COLORS.glassBg, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: COLORS.glassBorder },
    issueCardActive: { backgroundColor: 'rgba(239,68,68,0.1)', borderColor: 'rgba(239,68,68,0.4)' },
    issueIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: 'rgba(255,215,0,0.1)', alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
    issueIconActive: { backgroundColor: COLORS.error },
    issueLabel: { fontSize: 15, fontWeight: '800', color: COLORS.white, marginBottom: 4 },
    issueLabelActive: { color: COLORS.error },
    issueDesc: { fontSize: 12, color: COLORS.textMuted, lineHeight: 18 },
    inputRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.glassBg, borderRadius: 16, paddingHorizontal: 16, borderWidth: 1, borderColor: COLORS.glassBorder },
    textInput: { flex: 1, height: 52, color: COLORS.white, fontSize: 15, fontWeight: '600' },
    textArea: { backgroundColor: COLORS.glassBg, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: COLORS.glassBorder, color: COLORS.white, fontSize: 15, fontWeight: '600', minHeight: 120 },
    submitBtn: { marginTop: 32, height: 60, borderRadius: 30, overflow: 'hidden', elevation: 8, shadowColor: COLORS.error, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 12 },
    submitGradient: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
    submitText: { fontSize: 15, fontWeight: '900', color: COLORS.white, letterSpacing: 0.5 },
    footerNote: { marginTop: 24, fontSize: 12, color: COLORS.textMuted, textAlign: 'center', lineHeight: 20, paddingHorizontal: 20 },
});
