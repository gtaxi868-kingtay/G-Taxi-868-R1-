// The driver-side front door for compliance.
//
// Until now there wasn't one. `submit_compliance_document` existed and was
// deployed, admin/ComplianceReview.tsx existed to approve submissions, and
// compliance_queue had zero rows ever — because no driver could put anything
// into it. The approval half was waiting on a submission half that was never
// built.
//
// Note on the URL we store: the `driver-documents` bucket is PRIVATE, and
// ComplianceReview falls back to a `compliance_documents` bucket that does not
// exist in this project. So a bare storage path would be unviewable by the
// reviewer. We store a long-lived SIGNED url instead — ComplianceReview
// already renders `document_url` directly when it startsWith('http').

import React, { useCallback, useEffect, useState } from 'react';
import {
    View, Text, StyleSheet, ScrollView, TouchableOpacity,
    ActivityIndicator, Alert, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@gtaxi/core';
import { useAuth } from '../context/AuthContext';
import { SURFACE, VOICES } from '@gtaxi/design-system';
import { ghostBorder, glassSurface } from '@gtaxi/design-system/utils/style-rules';

const ACCENT = VOICES.driver.accent;

// Must match validTypes in supabase/functions/submit_compliance_document.
const DOC_TYPES = [
    { key: 'insurance',            label: 'Insurance',            icon: 'shield-checkmark', needsExpiry: true,  hint: 'Required to go online' },
    { key: 'license',              label: "Driver's Permit",      icon: 'card',             needsExpiry: true,  hint: 'Your driving permit' },
    { key: 'vehicle_registration', label: 'Vehicle Registration', icon: 'document-text',    needsExpiry: false, hint: 'Certified copy' },
    { key: 'psv_badge',            label: 'PSV Badge',            icon: 'ribbon',           needsExpiry: true,  hint: 'For-hire badge' },
    { key: 'other',                label: 'Something Else',       icon: 'attach',           needsExpiry: false, hint: 'Anything admin asked for' },
] as const;

type QueueRow = {
    id: string;
    document_type: string;
    status: string;
    submitted_at: string;
    rejection_reason: string | null;
    expiry_date: string | null;
};

const STATUS_TONE: Record<string, { color: string; label: string }> = {
    pending:  { color: '#F59E0B', label: 'Waiting for review' },
    approved: { color: '#22C55E', label: 'Approved' },
    rejected: { color: '#EF4444', label: 'Rejected' },
};

export default function ComplianceDocumentsScreen({ navigation }: any) {
    const insets = useSafeAreaInsets();
    const { driver } = useAuth() as any;

    const [rows, setRows] = useState<QueueRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            setError(null);
            const { data, error: e } = await supabase
                .from('compliance_queue')
                .select('id, document_type, status, submitted_at, rejection_reason, expiry_date')
                .order('submitted_at', { ascending: false });
            if (e) throw e;
            setRows((data ?? []) as QueueRow[]);
        } catch (err: any) {
            // Say what actually happened. A silent empty list is how the
            // rest of this codebase hid broken features for months.
            setError(err?.message ?? 'Could not load your documents');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const submit = async (docType: typeof DOC_TYPES[number]) => {
        try {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

            const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (!perm.granted) {
                Alert.alert('Permission needed', 'Allow photo access so you can attach the document.');
                return;
            }

            const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ImagePicker.MediaTypeOptions.Images,
                quality: 0.8,
            });
            if (result.canceled || !result.assets?.[0]) return;

            setUploading(docType.key);
            const asset = result.assets[0];
            const ext = (asset.uri.split('.').pop() || 'jpg').split('?')[0];
            const path = `${driver?.id ?? 'unknown'}/${docType.key}_${Date.now()}.${ext}`;

            const resp = await fetch(asset.uri);
            const blob = await resp.blob();

            const { data: up, error: upErr } = await supabase.storage
                .from('driver-documents')
                .upload(path, blob, { contentType: blob.type || 'image/jpeg' });
            if (upErr) throw upErr;

            // Private bucket -> signed url the reviewer can actually open.
            // One year: a compliance doc may sit in the queue a while, and an
            // expired link is a document the admin cannot review.
            const { data: signed, error: signErr } = await supabase.storage
                .from('driver-documents')
                .createSignedUrl(up.path, 60 * 60 * 24 * 365);
            if (signErr) throw signErr;

            const { data, error: fnErr } = await supabase.functions.invoke('submit_compliance_document', {
                body: {
                    document_type: docType.key,
                    document_url: signed.signedUrl,
                    expiry_date: null, // admin sets the real expiry at review
                },
            });
            if (fnErr) throw fnErr;
            if (data?.error) throw new Error(data.error);

            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            Alert.alert(
                'Sent for review',
                `Your ${docType.label.toLowerCase()} is with the team. You'll see the status here once it's checked.`,
            );
            load();
        } catch (err: any) {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            Alert.alert('Upload failed', err?.message ?? 'Something went wrong. Please try again.');
        } finally {
            setUploading(null);
        }
    };

    const latestFor = (key: string) => rows.find(r => r.document_type === key);

    return (
        <View style={s.root}>
            <StatusBar style="light" />
            <ScrollView contentContainerStyle={[s.scroll, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 40 }]}>
                <View style={s.header}>
                    <TouchableOpacity onPress={() => navigation.goBack()} style={s.back} accessibilityRole="button" accessibilityLabel="Go back">
                        <Ionicons name="chevron-back" size={24} color="#EAF3F6" />
                    </TouchableOpacity>
                    <Text style={s.title}>Documents</Text>
                </View>

                <Text style={s.sub}>
                    Send your paperwork here. The team reviews it and you'll see the result on this screen.
                </Text>

                {error && (
                    <View style={s.errorBox}>
                        <Ionicons name="warning" size={16} color="#EF4444" />
                        <Text style={s.errorText}>{error}</Text>
                    </View>
                )}

                {loading ? (
                    <ActivityIndicator color={ACCENT} style={{ marginTop: 40 }} />
                ) : (
                    DOC_TYPES.map(dt => {
                        const latest = latestFor(dt.key);
                        const tone = latest ? STATUS_TONE[latest.status] : null;
                        const busy = uploading === dt.key;
                        return (
                            <View key={dt.key} style={[s.card, glassSurface(0.15)]}>
                                <View style={s.cardTop}>
                                    <View style={[s.icon, { backgroundColor: ACCENT + '26' }]}>
                                        <Ionicons name={dt.icon as any} size={22} color={ACCENT} />
                                    </View>
                                    <View style={{ flex: 1 }}>
                                        <Text style={s.cardTitle}>{dt.label}</Text>
                                        <Text style={s.cardHint}>{dt.hint}</Text>
                                    </View>
                                </View>

                                {tone && (
                                    <View style={s.statusRow}>
                                        <View style={[s.dot, { backgroundColor: tone.color }]} />
                                        <Text style={[s.statusText, { color: tone.color }]}>{tone.label}</Text>
                                    </View>
                                )}
                                {latest?.status === 'rejected' && latest.rejection_reason && (
                                    <Text style={s.reject}>Reason: {latest.rejection_reason}</Text>
                                )}

                                <TouchableOpacity
                                    style={[s.cta, busy && { opacity: 0.6 }]}
                                    onPress={() => submit(dt)}
                                    disabled={busy}
                                    accessibilityRole="button"
                                    accessibilityLabel={`Upload ${dt.label}`}
                                >
                                    {busy
                                        ? <ActivityIndicator color={SURFACE.base} size="small" />
                                        : <Text style={s.ctaText}>
                                            {latest ? 'Replace' : 'Upload'}
                                          </Text>}
                                </TouchableOpacity>
                            </View>
                        );
                    })
                )}
            </ScrollView>
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: SURFACE.base },
    scroll: { paddingHorizontal: 20 },
    header: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
    back: { padding: 8, marginLeft: -8 },
    title: { fontSize: 26, fontWeight: '800', color: '#EAF3F6', marginLeft: 4 },
    sub: { fontSize: 14, color: 'rgba(255,255,255,0.6)', lineHeight: 20, marginBottom: 20 },
    errorBox: {
        flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12,
        borderRadius: 12, backgroundColor: 'rgba(239,68,68,0.08)', marginBottom: 16, ...ghostBorder(),
    },
    errorText: { color: '#EF4444', fontSize: 13, flex: 1 },
    card: { borderRadius: 20, padding: 16, marginBottom: 14, ...ghostBorder() },
    cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    icon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
    cardTitle: { fontSize: 16, fontWeight: '700', color: '#EAF3F6' },
    cardHint: { fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 2 },
    statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
    dot: { width: 8, height: 8, borderRadius: 4 },
    statusText: { fontSize: 13, fontWeight: '600' },
    reject: { fontSize: 12, color: '#EF4444', marginTop: 6, lineHeight: 17 },
    cta: {
        marginTop: 14, backgroundColor: ACCENT, borderRadius: 14,
        paddingVertical: 13, alignItems: 'center',
    },
    ctaText: { color: SURFACE.base, fontWeight: '800', fontSize: 15, letterSpacing: 0.5 },
});
