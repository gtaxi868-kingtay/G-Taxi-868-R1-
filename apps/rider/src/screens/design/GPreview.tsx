import React from 'react';
import { View } from 'react-native';
import { GPresence } from '@gtaxi/design-system-native/src/gPresence';
import { G_PALETTE } from '../../components/gBrand';

// Design review only. The real G screen with a scripted answer.
export function GPreview() {
    const mood = new URLSearchParams(window.location.search).get('mood') === 'day' ? 'day' : 'night';
    return (
        <View style={{ flex: 1 }}>
            <GPresence
                visible
                palette={G_PALETTE[mood]}
                name="Gershwane"
                hint="Try: take me to Piarco, or what's in my wallet?"
                ask={async ({ text }) => {
                    await new Promise((done) => setTimeout(done, 2500));
                    return {
                        heard: text,
                        reply: 'Piarco International Airport is about 25 minutes away. Want me to set it up?',
                        actions: [
                            { id: 'ride', label: 'Ride to Piarco International Airport', icon: 'car' },
                            { id: 'wallet', label: 'Open your wallet', icon: 'wallet' },
                        ],
                    };
                }}
                onAction={() => {}}
                onClose={() => {}}
            />
        </View>
    );
}
