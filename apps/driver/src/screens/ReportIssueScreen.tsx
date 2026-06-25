import React, { useState } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity, TextInput,
    ActivityIndicator, Alert, ScrollView,
    KeyboardAvoidingView, Platform
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { initializeSupabaseClient } from '@gtaxi/core';
import { SURFACE, VOICES } from '@gtaxi/design-system';
import { LiquidGlass } from '@gtaxi/design-system/native';

const { supabase } = initializeSupabaseClient('native');

const ISSUE_TYPES = [
    { id: 'broken_node', label: 'Broken Node', icon: 'radio-outline', desc: 'NFC kiosk or Smart Puck hardware failure' },
    { id: 'gps_mismatch', label: 'GPS Mismatch', icon: 'location-outline', desc: 'Node location does not match actual position' },
    { id: 'tag_missing', label: 'Missing Tag UID', icon: 'key-outline', desc: 'Node exists but NFC tag ID is unreadable' },
    { id: 'power_outage', label: 'Power Outage', icon: 'flash-off-outline', desc: 'Node has no power or connectivity' },
    { id: 'general', label: 'Other', icon: 'warning-outline', desc: 'General hardware or software issue' },
];

export function ReportIssueScreen({ navigation }: { navigation: any }) {
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

            const payload: Record<string, unknown> = {
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
        } catch (err) {
            Alert.alert('Transmission Failed', (err as Error).message || 'Could not send report. Please try again.');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <View style={s.root}>
            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                style={{ flex: 1 }}
            >
            <ScrollView contentContainerStyle={{ paddingTop: insets.top + 20, paddingBottom: insets.bottom + 40, paddingHorizontal: 20 }}>
                <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()}>
                    <Ionicons name="arrow-back" size={24} color="#FFF" />
                </TouchableOpacity>

                <View style={s.headerSection}>
                    <View style={s.iconCircle}>
                        <Ionicons name="warning" size={32} color="rgba(239,68,68,0.35)" />
                    </View>
                    <Text style={s.headerTitle}>Report Issue</Text>
                    <Text style={s.headerSub}>Alert the operations team about a hardware or node problem.</Text>
                </View>

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
                                <Ionicons name={type.icon as any} size={22} color={selectedType === type.id ? '#FFF' : VOICES.driver.gold} />
                            </View>
                            <Text style={[s.issueLabel, selectedType === type.id && s.issueLabelActive]}>{type.label}</Text>
                            <Text style={s.issueDesc}>{type.desc}</Text>
                        </TouchableOpacity>
                    ))}
                </View>

                <Text style={s.sectionLabel}>NODE ID (OPTIONAL)</Text>
                <View style={s.inputRow}>
                    <Ionicons name="radio-outline" size={18} color={VOICES.driver.gold} style={{ marginRight: 10 }} />
                    <TextInput
                        value={nodeId}
                        onChangeText={setNodeId}
                        placeholder="e.g. 04:9F:3E:2A:1B:7C:80"
                        placeholderTextColor="rgba(255,255,255,0.6)"
                        style={s.textInput}
                        autoCapitalize="none"
                    />
                </View>

                <Text style={s.sectionLabel}>DESCRIPTION *</Text>
                <TextInput
                    value={description}
                    onChangeText={setDescription}
                    placeholder="Describe the issue in detail..."
                    placeholderTextColor="rgba(255,255,255,0.6)"
                    style={s.textArea}
                    multiline
                    numberOfLines={5}
                    textAlignVertical="top"
                />

                <TouchableOpacity
                    style={[s.submitBtn, (!selectedType || !description.trim() || submitting) && { opacity: 0.5 }]}
                    onPress={handleSubmit}
                    disabled={!selectedType || !description.trim() || submitting}
                    activeOpacity={0.8}
                >
                    <LiquidGlass voice="driver" style={s.submitInner} tier="chrome">
                        {submitting ? (
                            <ActivityIndicator color="#FFF" />
                        ) : (
                            <>
                                <Ionicons name="warning" size={20} color="#FFF" />
                                <Text style={s.submitText}>TRANSMIT HIGH-PRIORITY ALERT</Text>
                            </>
                        )}
                    </LiquidGlass>
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
    root: { flex: 1, backgroundColor: SURFACE.base },
    backBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
    headerSection: { alignItems: 'center', marginBottom: 32 },
    iconCircle: { width: 72, height: 72, borderRadius: 36, backgroundColor: 'rgba(239,68,68,0.1)', alignItems: 'center', justifyContent: 'center', marginBottom: 16, borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)' },
    headerTitle: { fontSize: 28, fontWeight: '900', color: '#FFF', marginBottom: 8 },
    headerSub: { fontSize: 14, color: 'rgba(255,255,255,0.6)', textAlign: 'center', lineHeight: 22, paddingHorizontal: 20 },
    sectionLabel: { fontSize: 11, fontWeight: '800', color: 'rgba(255,255,255,0.6)', letterSpacing: 1, marginBottom: 12, marginTop: 24, textTransform: 'uppercase' },
    issueGrid: { gap: 12 },
    issueCard: { backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
    issueCardActive: { backgroundColor: 'rgba(239,68,68,0.1)', borderColor: 'rgba(239,68,68,0.4)' },
    issueIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: VOICES.driver.accent + '1A', alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
    issueIconActive: { backgroundColor: 'rgba(239,68,68,0.35)' },
    issueLabel: { fontSize: 15, fontWeight: '800', color: '#FFF', marginBottom: 4 },
    issueLabelActive: { color: 'rgba(239,68,68,0.35)' },
    issueDesc: { fontSize: 12, color: 'rgba(255,255,255,0.6)', lineHeight: 18 },
    inputRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 16, paddingHorizontal: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
    textInput: { flex: 1, height: 52, color: '#FFF', fontSize: 15, fontWeight: '600' },
    textArea: { backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', color: '#FFF', fontSize: 15, fontWeight: '600', minHeight: 120 },
    submitBtn: { marginTop: 32, height: 60, borderRadius: 30, overflow: 'hidden' },
    submitInner: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, borderWidth: 0 },
    submitText: { fontSize: 15, fontWeight: '900', color: '#FFF', letterSpacing: 0.5 },
    footerNote: { marginTop: 24, fontSize: 12, color: 'rgba(255,255,255,0.6)', textAlign: 'center', lineHeight: 20, paddingHorizontal: 20 },
});
