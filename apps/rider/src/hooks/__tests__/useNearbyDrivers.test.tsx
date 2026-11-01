// Regression guard (2026-10-25): the hook used to hand back Animated.Value
// objects as lat/lng. HomeScreen passed them straight into <Marker coordinate>
// and into the distance maths, so car pins got an unreadable position and the
// "~N min" driver ETA could never show (Number.isFinite(Animated.Value) is
// false). Positions must be plain numbers; gliding is the marker's job.
import React from 'react';
import { AppState } from 'react-native';
import { render, waitFor } from '@testing-library/react-native';
import { useNearbyDrivers } from '../useNearbyDrivers';

jest.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
jest.mock('@gtaxi/core', () => ({
    supabase: {
        rpc: jest.fn(() => Promise.resolve({ data: [{ id: 'd1', lat: 10.65, lng: -61.51 }], error: null })),
    },
}));

let latest: any = null;
function Probe() { latest = useNearbyDrivers(10.66, -61.52); return null; }

describe('useNearbyDrivers', () => {
    it('returns drivers with plain numeric positions', async () => {
        // The hook only polls while the app is in front.
        (AppState as any).currentState = 'active';
        const { unmount } = render(<Probe />);
        await waitFor(() => expect(latest.drivers.length).toBe(1));
        const d = latest.drivers[0];
        expect(typeof d.lat).toBe('number');
        expect(typeof d.lng).toBe('number');
        expect(d).toMatchObject({ id: 'd1', lat: 10.65, lng: -61.51 });
        unmount();
    });
});
