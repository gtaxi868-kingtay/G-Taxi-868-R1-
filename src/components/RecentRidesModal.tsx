import React from 'react';
import {
    View,
    Text,
    StyleSheet,
    Modal,
    TouchableOpacity,
    TouchableWithoutFeedback,
    ScrollView,
} from 'react-native';
import { theme } from '../theme';
import { GlassView } from './GlassView';
import { Location } from '../types/ride';

interface RecentRidesModalProps {
    visible: boolean;
    onClose: () => void;
    onSelect: (location: Location) => void;
    recentLocations: Location[];
}

export function RecentRidesModal({ visible, onClose, onSelect, recentLocations }: RecentRidesModalProps) {
    return (
        <Modal
            visible={visible}
            transparent
            animationType="fade"
            onRequestClose={onClose}
        >
            <TouchableWithoutFeedback onPress={onClose}>
                <View style={styles.overlay}>
                    <GlassView style={styles.modalContainer} intensity="heavy">
                        <Text style={styles.title}>Recent Rides</Text>

                        {recentLocations.length === 0 ? (
                            <Text style={styles.emptyText}>No recent rides found.</Text>
                        ) : (
                            <ScrollView style={styles.list}>
                                {recentLocations.map((loc, index) => (
                                    <TouchableOpacity
                                        key={index}
                                        style={[
                                            styles.item,
                                            index < recentLocations.length - 1 && styles.borderBottom
                                        ]}
                                        onPress={() => {
                                            onSelect(loc);
                                            onClose();
                                        }}
                                    >
                                        <View style={styles.iconContainer}>
                                            <Text style={styles.icon}>🕒</Text>
                                        </View>
                                        <View style={styles.textContainer}>
                                            <Text style={styles.address} numberOfLines={1}>
                                                {loc.address}
                                            </Text>
                                            <Text style={styles.subtext}>
                                                Recently visited
                                            </Text>
                                        </View>
                                        <Text style={styles.arrow}>→</Text>
                                    </TouchableOpacity>
                                ))}
                            </ScrollView>
                        )}

                        <TouchableOpacity style={styles.closeButton} onPress={onClose}>
                            <Text style={styles.closeText}>Close</Text>
                        </TouchableOpacity>
                    </GlassView>
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
    modalContainer: {
        borderRadius: theme.borderRadius.xl,
        padding: theme.spacing.xl,
        maxHeight: '60%',
    },
    title: {
        fontSize: theme.typography.sizes.xl,
        fontWeight: theme.typography.weights.bold,
        color: theme.colors.text.primary,
        marginBottom: theme.spacing.lg,
        textAlign: 'center',
    },
    emptyText: {
        color: theme.colors.text.secondary,
        textAlign: 'center',
        marginBottom: theme.spacing.lg,
    },
    list: {
        marginBottom: theme.spacing.md,
    },
    item: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: theme.spacing.md,
    },
    borderBottom: {
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.glass.border,
    },
    iconContainer: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: theme.colors.glass.backgroundLight,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: theme.spacing.md,
    },
    icon: {
        fontSize: 18,
    },
    textContainer: {
        flex: 1,
        marginRight: theme.spacing.md,
    },
    address: {
        color: theme.colors.text.primary,
        fontSize: theme.typography.sizes.md,
        fontWeight: theme.typography.weights.medium,
        marginBottom: 2,
    },
    subtext: {
        color: theme.colors.text.secondary,
        fontSize: theme.typography.sizes.xs,
    },
    arrow: {
        color: theme.colors.text.tertiary,
        fontSize: 18,
    },
    closeButton: {
        alignItems: 'center',
        padding: theme.spacing.md,
        marginTop: theme.spacing.sm,
    },
    closeText: {
        color: theme.colors.text.secondary,
        fontSize: theme.typography.sizes.md,
    },
});
