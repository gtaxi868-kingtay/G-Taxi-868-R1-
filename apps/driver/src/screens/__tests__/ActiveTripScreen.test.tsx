import React from 'react';
import { render, waitFor, fireEvent } from '@testing-library/react-native';
import { ActiveTripScreen } from '../ActiveTripScreen';

let mockRide: any = null;
jest.mock('@gtaxi/core', () => {
  const builder = (table: string): any => {
    const q: any = new Proxy({}, { get: (_t, k) => {
      if (k === 'then') return (ok: any, err: any) => Promise.resolve({ data: [], error: null }).then(ok, err);
      if (k === 'single' || k === 'maybeSingle') return () => Promise.resolve({ data: table === 'rides' ? mockRide : null, error: null });
      return () => q;
    } });
    return q;
  };
  const ch: any = { on: () => ch, subscribe: () => ch, unsubscribe: jest.fn() };
  return { supabase: { from: (t: string) => builder(t), channel: () => ch, functions: { invoke: jest.fn(() => Promise.resolve({ data: null, error: null })) }, rpc: jest.fn(() => Promise.resolve({ data: null, error: null })) } };
});
jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => {}), removeItem: jest.fn(async () => {}) } }));
jest.mock('@g868/shared/env', () => ({ ENV: { MAPBOX_PUBLIC_TOKEN: '' } }));
jest.mock('../../hooks/useLocationTracking', () => ({ useLocationTracking: () => ({ location: { coords: { latitude: 10.6, longitude: -61.3 } }, signalStatus: 'lock' }) }));
jest.mock('../../services/api', () => ({ updateRideStatus: jest.fn(), setLocationTrackingMode: jest.fn() }));
jest.mock('../../components/GuardianSosPanel', () => ({ GuardianSosPanel: () => null }));

function nav() {
  const listeners: Record<string, any> = {};
  return { listeners, addListener: jest.fn((name: string, fn: any) => { listeners[name] = fn; return jest.fn(); }), reset: jest.fn(), navigate: jest.fn() };
}

describe('ActiveTripScreen', () => {
  it('lets the driver leave once the trip is done (was stuck behind the guard)', async () => {
    mockRide = { id: 'r1', status: 'completed', payment_method: 'card', driver_payout_cents: 3200, total_fare_cents: 4000, metadata: {} };
    const navigation = nav();
    const { getByText, getByLabelText } = render(<ActiveTripScreen route={{ params: { rideId: 'r1' } }} navigation={navigation} />);
    await waitFor(() => expect(getByText('Trip done')).toBeTruthy());
    expect(getByText('TT$32.00')).toBeTruthy();
    const e = { preventDefault: jest.fn(), data: {} };
    navigation.listeners.beforeRemove(e);
    expect(e.preventDefault).not.toHaveBeenCalled();
    fireEvent.press(getByLabelText('Back to Drive'));
    expect(navigation.reset).toHaveBeenCalled();
  });

  it('asks a cash driver to collect the full fare, not their share', async () => {
    mockRide = { id: 'r2', status: 'completed', payment_method: 'cash', driver_payout_cents: 3200, total_fare_cents: 4000, metadata: { carried_fee_cents: 500 } };
    const { getByText } = render(<ActiveTripScreen route={{ params: { rideId: 'r2' } }} navigation={nav()} />);
    await waitFor(() => expect(getByText('TT$45.00')).toBeTruthy());
    expect(getByText('TT$32.00')).toBeTruthy();
  });

  it('still blocks leaving in the middle of a trip', async () => {
    mockRide = { id: 'r3', status: 'in_progress', payment_method: 'cash', metadata: {} };
    const navigation = nav();
    const { getByText } = render(<ActiveTripScreen route={{ params: { rideId: 'r3' } }} navigation={navigation} />);
    await waitFor(() => expect(getByText('Drive to drop-off')).toBeTruthy());
    const e = { preventDefault: jest.fn(), data: {} };
    navigation.listeners.beforeRemove(e);
    expect(e.preventDefault).toHaveBeenCalled();
  });
});
