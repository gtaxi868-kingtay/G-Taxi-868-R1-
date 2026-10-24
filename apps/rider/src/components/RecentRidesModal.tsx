import React from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Location } from '@gtaxi/core';
import { Button, EmptyState, GUTTER, RADIUS, Row, SPACE, Txt, useTheme } from '../ui/kit';

interface RecentRidesModalProps {
    visible: boolean;
    onClose: () => void;
    onSelect: (location: Location) => void;
    recentLocations: Location[];
}

export function RecentRidesModal({ visible, onClose, onSelect, recentLocations }: RecentRidesModalProps) {
    const m = useTheme();
    const insets = useSafeAreaInsets();
    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
            <Pressable style={{ flex: 1, backgroundColor: 'rgba(10,6,20,0.55)' }} onPress={onClose} accessibilityLabel="Close" />
            <View style={{ backgroundColor: m.sheet[1], borderTopLeftRadius: RADIUS.sheet, borderTopRightRadius: RADIUS.sheet, padding: GUTTER, paddingBottom: Math.max(insets.bottom, SPACE.lg) + SPACE.sm, maxHeight: '75%' }}>
                <Txt variant="title">Go there again</Txt>
                {recentLocations.length === 0 ? (
                    <EmptyState icon="time-outline" title="No recent trips yet" body="Places you ride to will show up here." />
                ) : (
                    <ScrollView style={{ marginTop: SPACE.sm }}>
                        {recentLocations.map((loc, index) => (
                            <Row key={index} icon="time-outline" title={(loc.address || 'Recent place').split(',')[0]} subtitle={loc.address}
                                last={index === recentLocations.length - 1} onPress={() => { onSelect(loc); onClose(); }} />
                        ))}
                    </ScrollView>
                )}
                <Button title="Close" variant="ghost" style={{ marginTop: SPACE.lg }} onPress={onClose} />
            </View>
        </Modal>
    );
}
