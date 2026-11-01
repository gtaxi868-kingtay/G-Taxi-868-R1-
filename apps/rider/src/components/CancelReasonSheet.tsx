import React from 'react';
import { Modal, View, Pressable, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, GUTTER, RADIUS, Row, SPACE, Txt, useTheme } from '../ui/kit';

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
    const m = useTheme();
    const insets = useSafeAreaInsets();
    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
            <Pressable style={{ flex: 1, backgroundColor: 'rgba(10,6,20,0.55)' }} onPress={onClose} accessibilityLabel="Keep my ride" />
            <View style={{ backgroundColor: m.sheet[1], borderTopLeftRadius: RADIUS.sheet, borderTopRightRadius: RADIUS.sheet, paddingHorizontal: GUTTER, paddingTop: GUTTER, paddingBottom: Math.max(insets.bottom, SPACE.lg) + SPACE.sm, maxHeight: '85%' }}>
                <Txt variant="title">Why are you cancelling?</Txt>
                <Txt variant="body" tone="dim" style={{ marginTop: SPACE.xs, marginBottom: SPACE.sm }}>Optional. It helps us fix what went wrong.</Txt>
                <ScrollView showsVerticalScrollIndicator={false}>
                    {CANCEL_REASONS.map((r, i) => (
                        <Row key={r.code} title={r.label} onPress={() => onPick(r.code)} last={i === CANCEL_REASONS.length - 1} />
                    ))}
                </ScrollView>
                <Button title="Keep my ride" style={{ marginTop: SPACE.lg }} onPress={onClose} />
                <Button title="Skip and cancel" variant="ghost" style={{ marginTop: SPACE.md }} onPress={() => onPick(null)} />
            </View>
        </Modal>
    );
}
