// Regression guard (2026-10-25): two screens mounting usePlatformFlags at once
// (Home + the shared useServices hook) crashed Home with "cannot add
// postgres_changes callbacks for realtime:platform-flags after subscribe()".
// supabase-js hands back the SAME channel object for the same name, and that
// object refuses .on() once subscribed. Each hook instance needs its own name.
import React from 'react';
import { render } from '@testing-library/react-native';
import { usePlatformFlags } from '../usePlatformFlags';

const mockChannels = new Map<string, any>();
jest.mock('@gtaxi/core', () => ({
    supabase: {
        from: () => ({ select: () => Promise.resolve({ data: [], error: null }) }),
        channel: (name: string) => {
            if (!mockChannels.has(name)) {
                let subscribed = false;
                const ch: any = {
                    on: () => { if (subscribed) throw new Error(`cannot add postgres_changes callbacks for realtime:${name} after subscribe().`); return ch; },
                    subscribe: () => { subscribed = true; return ch; },
                };
                mockChannels.set(name, ch);
            }
            return mockChannels.get(name);
        },
        removeChannel: jest.fn(),
    },
}));

function Probe() { usePlatformFlags(); return null; }

describe('usePlatformFlags', () => {
    it('can be mounted by two screens at once without crashing', () => {
        expect(() => render(<><Probe /><Probe /></>)).not.toThrow();
    });
});
