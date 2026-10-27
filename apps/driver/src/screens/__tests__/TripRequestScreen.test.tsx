import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { TripRequestScreen } from '../TripRequestScreen';

jest.mock('@gtaxi/core', () => {
  const result = Promise.resolve({ data: null, error: null });
  const q: any = new Proxy({}, { get: (_t, k) => (k === 'then' ? result.then.bind(result) : k === 'maybeSingle' || k === 'single' ? () => result : () => q) });
  return { supabase: { from: () => q, functions: { invoke: jest.fn(() => Promise.resolve({ data: null, error: null })) } } };
});
const mockAccept = jest.fn((..._a: any[]) => Promise.resolve({ error: null, statusCode: 200 }));
jest.mock('../../services/api', () => ({ acceptRide: (...a: any[]) => mockAccept(...a), declineRide: jest.fn(() => Promise.resolve({})) }));
jest.mock('../../context/AuthContext', () => ({ useAuth: () => ({ driver: { id: 'drv1' } }) }));

const offer = { id: 'off1', ride_id: 'ride1', driver_payout_cents: 4560, distance_meters: 7300, duration_min: 14, timeout_seconds: 15, expires_at: new Date(Date.now() + 15000).toISOString(), pickup_address: 'Grand Bazaar', dropoff_address: 'Piarco' };

describe('TripRequestScreen', () => {
  it('leads with the pay and the place, and Accept accepts', async () => {
    const navigation = { addListener: jest.fn(() => jest.fn()), goBack: jest.fn(), replace: jest.fn() };
    const { getByText, getByLabelText } = render(<TripRequestScreen navigation={navigation} route={{ params: { offer } }} />);
    expect(getByText('TT$45.60')).toBeTruthy();
    expect(getByText('7.3 km')).toBeTruthy();
    expect(getByText('Grand Bazaar')).toBeTruthy();
    fireEvent.press(getByLabelText('Accept'));
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('ActiveTrip', { rideId: 'ride1' }));
    expect(mockAccept).toHaveBeenCalledWith('ride1', 'drv1');
  });
});
