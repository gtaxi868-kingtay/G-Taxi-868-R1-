import React, { useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    Modal,
    TextInput,
    TouchableOpacity,
    KeyboardAvoidingView,
    Platform,
    TouchableWithoutFeedback,
    Keyboard,
    ActivityIndicator
} from 'react-native';
import { theme } from '../theme';
import { GlassView } from './GlassView';
import { GlassButton } from './GlassButton';

interface SavedPlaceModalProps {
    visible: boolean;
    onClose: () => void;
    onSave: (label: string, address: string) => Promise<void>;
    defaultLabel?: string; // 'Home' or 'Work' if pre-selected
}

export function SavedPlaceModal({ visible, onClose, onSave, defaultLabel = '' }: SavedPlaceModalProps) {
    const [label, setLabel] = useState(defaultLabel);
    const [address, setAddress] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSave = async () => {
        if (!label || !address) return;

        setLoading(true);
        await onSave(label, address);
        setLoading(false);
        onClose();
        // Reset fields
        setLabel('');
        setAddress('');
    };

    return (
        <Modal
            visible={visible}
            transparent
            animationType="fade"
            onRequestClose={onClose}
        >
            <TouchableWithoutFeedback onPress={onClose}>
                <View style={styles.overlay}>
                    <KeyboardAvoidingView
                        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                        style={styles.keyboardView}
                    >
                        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
                            <GlassView style={styles.modalContainer} intensity="heavy">
                                <Text style={styles.title}>Save Place</Text>

                                {/* Label Input */}
                                <Text style={styles.label}>Label</Text>
                                <View style={styles.inputContainer}>
                                    <TextInput
                                        style={styles.input}
                                        placeholder="e.g. Home, Work, Gym"
                                        placeholderTextColor={theme.colors.text.tertiary}
                                        value={label}
                                        onChangeText={setLabel}
                                        autoCapitalize="words"
                                    />
                                </View>

                                {/* Address Input (Simplified for now, later could be Google Places) */}
                                <Text style={styles.label}>Address</Text>
                                <View style={styles.inputContainer}>
                                    <TextInput
                                        style={styles.input}
                                        placeholder="Enter address"
                                        placeholderTextColor={theme.colors.text.tertiary}
                                        value={address}
                                        onChangeText={setAddress}
                                    />
                                </View>

                                <View style={styles.buttonRow}>
                                    <TouchableOpacity style={styles.cancelButton} onPress={onClose}>
                                        <Text style={styles.cancelText}>Cancel</Text>
                                    </TouchableOpacity>

                                    <GlassButton
                                        title="Save Place"
                                        onPress={handleSave}
                                        loading={loading}
                                        variant="primary"
                                        style={styles.saveButton}
                                        disabled={!label || !address}
                                    />
                                </View>
                            </GlassView>
                        </TouchableWithoutFeedback>
                    </KeyboardAvoidingView>
                </View>
            </TouchableWithoutFeedback>
        </Modal>
    );
}

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.6)',
        justifyContent: 'center',
        padding: theme.spacing.lg,
    },
    keyboardView: {
        width: '100%',
    },
    modalContainer: {
        borderRadius: theme.borderRadius.xl,
        padding: theme.spacing.xl,
    },
    title: {
        fontSize: theme.typography.sizes.xl,
        fontWeight: theme.typography.weights.bold,
        color: theme.colors.text.primary,
        marginBottom: theme.spacing.lg,
        textAlign: 'center',
    },
    label: {
        color: theme.colors.text.secondary,
        fontSize: theme.typography.sizes.sm,
        marginBottom: theme.spacing.xs,
        marginLeft: theme.spacing.xs,
    },
    inputContainer: {
        backgroundColor: theme.colors.glass.backgroundLight,
        borderRadius: theme.borderRadius.lg,
        paddingHorizontal: theme.spacing.md,
        paddingVertical: Platform.OS === 'ios' ? theme.spacing.md : theme.spacing.sm,
        marginBottom: theme.spacing.lg,
        borderWidth: 1,
        borderColor: theme.colors.glass.border,
    },
    input: {
        color: theme.colors.text.primary,
        fontSize: theme.typography.sizes.md,
    },
    buttonRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: theme.spacing.md,
    },
    cancelButton: {
        padding: theme.spacing.md,
    },
    cancelText: {
        color: theme.colors.text.secondary,
        fontSize: theme.typography.sizes.md,
    },
    saveButton: {
        minWidth: 120,
    },
});
