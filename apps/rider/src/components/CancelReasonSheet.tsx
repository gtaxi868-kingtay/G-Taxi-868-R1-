import React from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, Pressable } from 'react-native';

// Why is the rider cancelling? Fixed list only: the codes must match
// analytics_events.cancel_reason and cancel_ride's CANCEL_REASON_CODES.
// Answering is optional ("Skip" cancels with no reason). The answer is used
// only to understand why rides fail; it is never shown to the driver.
export const CANCEL_REASONS: { code: string; label: string }[] = [
    { code: 'driver_too_far', label: 'Driver is too far away' },
    { code: 'waited_too_long', label: 'Waited too long' },
    { code: 'driver_asked_me_to_cancel', label: 'Driver asked me to cancel' },
    { code: 'booked_by_mistake', label: 'Booked by mistake' },
    { code: 'changed_plans', label: 'My plans changed' },
    { code: 'price_too_high', label: 'Price is too high' },
    { code: 'found_another_ride', label: 'Found another ride' },
    { code: 'felt_unsafe', label: 'I felt unsafe' },
    { code: 'other', label: 'Something else' },
];

export function CancelReasonSheet({
    visible,
    onPick,
    onClose,
}: {
    visible: boolean;
    onPick: (code: string | null) => void;
    onClose: () => void;
}) {
    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
            <Pressable style={st.backdrop} onPress={onClose} accessibilityLabel="Keep my ride" />
            <View style={st.sheet}>
                <Text style={st.title}>Why are you cancelling?</Text>
                <Text style={st.sub}>Optional. It helps us fix what went wrong.</Text>
                {CANCEL_REASONS.map((r) => (
                    <TouchableOpacity key={r.code} style={st.row} onPress={() => onPick(r.code)}
                        accessibilityRole="button" accessibilityLabel={r.label}>
                        <Text style={st.rowText}>{r.label}</Text>
                    </TouchableOpacity>
                ))}
                <TouchableOpacity style={st.skip} onPress={() => onPick(null)} accessibilityRole="button">
                    <Text style={st.skipText}>Skip and cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={st.keep} onPress={onClose} accessibilityRole="button">
                    <Text style={st.keepText}>Keep my ride</Text>
                </TouchableOpacity>
            </View>
        </Modal>
    );
}

const st = StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
    sheet: { backgroundColor: '#0B0B12', paddingHorizontal: 20, paddingTop: 20, paddingBottom: 34, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
    title: { color: '#FFFFFF', fontSize: 18, fontWeight: '800' },
    sub: { color: 'rgba(255,255,255,0.6)', fontSize: 13, marginTop: 4, marginBottom: 12 },
    row: { paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.12)' },
    rowText: { color: '#FFFFFF', fontSize: 15 },
    skip: { paddingVertical: 14, alignItems: 'center', marginTop: 6 },
    skipText: { color: '#FF8A8A', fontSize: 15, fontWeight: '700' },
    keep: { paddingVertical: 12, alignItems: 'center' },
    keepText: { color: 'rgba(255,255,255,0.7)', fontSize: 14 },
});
