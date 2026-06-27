import React from 'react';
import { render } from '@testing-library/react-native';
import { DashboardScreen } from '../DashboardScreen';

jest.mock('@gtaxi/core', () => ({ supabase: { channel: () => ({ on: () => ({ subscribe: jest.fn() }) }), from: () => ({ select: () => ({ eq: () => ({ single: jest.fn(), maybeSingle: jest.fn(), order: () => ({ limit: () => ({ data: null }) }) }) }) }), functions: { invoke: jest.fn() }, rpc: jest.fn(), removeChannel: jest.fn() }, auth: { getSession: jest.fn() }, OutboxService: { getInstance: () => ({ enqueue: jest.fn(), process: jest.fn(), getPendingCount: jest.fn(), clear: jest.fn(), start: jest.fn(), stop: jest.fn() }) } }));
jest.mock('@gtaxi/shared/env', () => ({ DEFAULT_LOCATION: { latitude: 10.6918, longitude: -61.2225 }, ENV: { MAPBOX_PUBLIC_TOKEN: 'test' } }));
jest.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'test' }, session: { access_token: 'test' }, loading: false, driver: { id: 'test', is_online: false, name: 'Test', verified_status: 'approved' }, toggleOnline: jest.fn(), signOut: jest.fn(), refreshPushToken: jest.fn() }) }));
jest.mock('../../hooks/useLocationTracking', () => ({ useLocationTracking: () => ({ location: null, signalStatus: 'none' }) }));
jest.mock('../../services/realtime', () => ({ useRideOfferSubscription: () => ({ offer: null, clearOffer: jest.fn() }), useDeliveryOfferSubscription: () => ({ offer: null, clearOffer: jest.fn() }) }));

describe('DashboardScreen', () => {
  it('renders without crashing', () => {
    const navigation = { navigate: jest.fn(), goBack: jest.fn(), replace: jest.fn() };
    const { getByText } = render(<DashboardScreen navigation={navigation as any} />);
    expect(getByText(/G-TAXI/i)).toBeTruthy();
  });
});
