import React from 'react';
import { render } from '@testing-library/react-native';
import { DashboardScreen } from '../DashboardScreen';

// Chainable query builder: every filter returns the builder; awaiting it (or
// maybeSingle) resolves to no rows.
jest.mock('../../components/GButton', () => ({ GButton: () => null }));
jest.mock('@gtaxi/core', () => {
  const result = Promise.resolve({ data: null, error: null });
  const q: any = new Proxy({}, { get: (_t, k) => (k === 'then' ? result.then.bind(result) : k === 'maybeSingle' || k === 'single' ? () => result : () => q) });
  return { supabase: { from: () => q, functions: { invoke: jest.fn(() => Promise.resolve({ data: null, error: null })) }, rpc: jest.fn(() => result), channel: () => ({ on: () => ({ subscribe: jest.fn() }) }), removeChannel: jest.fn(), auth: { getSession: jest.fn() } }, OutboxService: { getInstance: () => ({ enqueue: jest.fn(), process: jest.fn(), getPendingCount: jest.fn(), clear: jest.fn(), start: jest.fn(), stop: jest.fn() }) } };
});
jest.mock('@g868/shared/env', () => ({ DEFAULT_LOCATION: { latitude: 10.6918, longitude: -61.2225 }, ENV: { MAPBOX_PUBLIC_TOKEN: 'test' } }));
jest.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'test' }, session: { access_token: 'test' }, loading: false, driver: { id: 'test', is_online: false, name: 'Test', verified_status: 'approved' }, toggleOnline: jest.fn(), signOut: jest.fn(), refreshPushToken: jest.fn() }) }));
jest.mock('../../hooks/useLocationTracking', () => ({ useLocationTracking: () => ({ location: null, signalStatus: 'none' }) }));
jest.mock('@react-navigation/native', () => ({ useFocusEffect: (cb: any) => { const React = require('react'); React.useEffect(cb, []); } }));
jest.mock('../../services/realtime', () => ({ useRideOfferSubscription: () => ({ offer: null, clearOffer: jest.fn() }), useDeliveryOfferSubscription: () => ({ offer: null, clearOffer: jest.fn() }) }));

describe('DashboardScreen (Drive tab)', () => {
  it('shows the map-first home: name, today, goal and the big Go online button', () => {
    const navigation = { navigate: jest.fn() };
    const { getByText, getByLabelText } = render(<DashboardScreen navigation={navigation as any} />);
    expect(getByText('Test')).toBeTruthy();
    expect(getByText('TODAY')).toBeTruthy();
    expect(getByText("Today's goal: TT$300")).toBeTruthy();
    expect(getByLabelText('Go online')).toBeTruthy();
    expect(getByLabelText('Finish a trip to start a streak')).toBeTruthy();
  });
});
