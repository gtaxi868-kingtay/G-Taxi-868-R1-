import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PinMap } from '../components/PinMap';
import { Button, Field, GUTTER, IconButton, RADIUS, SPACE, Txt, useTheme } from '../ui/kit';
import { DEFAULT_LOCATION } from '@gtaxi/core';
import { AppScreenProps } from '../navigation/types';

// The way out when a place has no name search can find: plenty of T&T stops
// are "the blue gate after the bakery". Move the map, say what the driver
// should look for, and carry on exactly as if search had found it.
export function PinOnMapScreen({ navigation, route }: AppScreenProps<'PinOnMap'>) {
    const m = useTheme();
    const insets = useSafeAreaInsets();
    const start = route.params?.near;
    const [point, setPoint] = useState({
        latitude: start?.latitude ?? DEFAULT_LOCATION.latitude,
        longitude: start?.longitude ?? DEFAULT_LOCATION.longitude,
    });
    const [label, setLabel] = useState(route.params?.label ?? '');

    const confirm = () => {
        navigation.navigate({
            name: 'DestinationSearch',
            params: { pinned: { ...point, address: label.trim() || 'Pin on the map' } },
            merge: true,
        } as never);
    };

    return (
        <View style={{ flex: 1, backgroundColor: m.page }}>
            <PinMap latitude={point.latitude} longitude={point.longitude}
                onSettled={(latitude, longitude) => setPoint({ latitude, longitude })} />
            <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 230, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="location" size={46} color="#6E5BE0" style={{ marginBottom: 46 }} />
            </View>
            <View style={{ position: 'absolute', top: insets.top + SPACE.sm, left: GUTTER }}>
                <IconButton icon="chevron-back" label="Go back" onPress={() => navigation.goBack()} />
            </View>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
                <View style={{ backgroundColor: m.sheet[1], borderTopLeftRadius: RADIUS.sheet, borderTopRightRadius: RADIUS.sheet,
                    paddingHorizontal: GUTTER, paddingTop: SPACE.lg, paddingBottom: Math.max(insets.bottom, SPACE.lg) + SPACE.sm }}>
                    <Txt variant="title">Move the map to the spot</Txt>
                    <Field style={{ marginTop: SPACE.md }} placeholder="What should the driver look for?" value={label}
                        onChangeText={setLabel} maxLength={80} accessibilityLabel="What should the driver look for?" />
                    <Button title="Use this spot" icon="checkmark" onPress={confirm} style={{ marginTop: SPACE.md }} />
                </View>
            </KeyboardAvoidingView>
        </View>
    );
}
