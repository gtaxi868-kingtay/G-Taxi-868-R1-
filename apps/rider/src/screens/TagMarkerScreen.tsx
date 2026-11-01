import React from 'react';
import * as Haptics from 'expo-haptics';
import { AppScreenProps } from '../navigation/types';
import { Button, EmptyState, Screen, Txt } from '../ui/kit';

// A rider lands here when NfcScanScreen's routeNfcTag() classifies a scanned
// tag as 'blank': not yet set up as a shop, taxi stand or personal tag.
// Riders cannot set tags up (no RLS grants them that; commanders and admin
// do, through reviewed flows), so this screen just says so plainly.
export function TagMarkerScreen({ navigation, route }: AppScreenProps<'TagMarker'>) {
    const tagUid = route?.params?.tagUid || '';
    const back = () => { Haptics.selectionAsync(); navigation.goBack(); };

    return (
        <Screen onBack={back} title="">
            <EmptyState
                icon="pricetag-outline"
                title="This tag is not set up yet"
                body="Your area's G-Lead can register it. You can still book a ride as normal."
                action={<Button title="Continue" onPress={back} />}
            />
            {tagUid ? <Txt variant="caption" tone="faint" style={{ textAlign: 'center' }}>Tag {tagUid}</Txt> : null}
        </Screen>
    );
}
