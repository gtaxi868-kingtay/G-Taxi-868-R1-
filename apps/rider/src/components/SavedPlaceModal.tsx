import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { toast } from './Toast';
import { Button, Field, GUTTER, RADIUS, SPACE, Txt, useTheme } from '../ui/kit';

interface SavedPlaceModalProps {
    visible: boolean;
    onClose: () => void;
    onSave: (label: string, address: string) => Promise<void>;
    defaultLabel?: string;
}

export function SavedPlaceModal({ visible, onClose, onSave, defaultLabel = '' }: SavedPlaceModalProps) {
    const m = useTheme();
    const insets = useSafeAreaInsets();
    const [label, setLabel] = useState(defaultLabel);
    const [address, setAddress] = useState('');
    const [loading, setLoading] = useState(false);

    // The label used to stay at its first value, so "Work" opened as "Home".
    useEffect(() => { if (visible) setLabel(defaultLabel); }, [visible, defaultLabel]);

    const handleSave = async () => {
        if (!label || !address) return;
        setLoading(true);
        try {
            await onSave(label, address);
            onClose();
            setLabel('');
            setAddress('');
        } catch {
            toast('Could not save this place. Please try again.', 'error');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
                <Pressable style={{ flex: 1, backgroundColor: 'rgba(10,6,20,0.55)' }} onPress={onClose} accessibilityLabel="Close" />
                <View style={{ backgroundColor: m.sheet[1], borderTopLeftRadius: RADIUS.sheet, borderTopRightRadius: RADIUS.sheet, padding: GUTTER, paddingBottom: Math.max(insets.bottom, SPACE.lg) + SPACE.sm }}>
                    <Txt variant="title">{defaultLabel ? `Set your ${defaultLabel.toLowerCase()} address` : 'Save a place'}</Txt>
                    <Txt variant="body" tone="dim" style={{ marginTop: SPACE.xs, marginBottom: SPACE.lg }}>Then you can book it in one tap.</Txt>
                    <Field label="Name" placeholder="e.g. Home, Work, Gym" value={label} onChangeText={setLabel} autoCapitalize="words" />
                    <Field label="Address" placeholder="Street and area" value={address} onChangeText={setAddress} autoFocus />
                    <View style={{ flexDirection: 'row', gap: SPACE.md }}>
                        <Button title="Cancel" variant="secondary" style={{ flex: 1 }} onPress={onClose} />
                        <Button title="Save" style={{ flex: 1 }} loading={loading} disabled={!label || !address} onPress={handleSave} />
                    </View>
                </View>
            </KeyboardAvoidingView>
        </Modal>
    );
}
