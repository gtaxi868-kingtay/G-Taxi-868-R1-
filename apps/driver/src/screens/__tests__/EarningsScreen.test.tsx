import React from 'react';
import { render } from '@testing-library/react-native';
import { EarningsScreen } from '../EarningsScreen';

let mockRows: any[] = [];
jest.mock('@gtaxi/core', () => {
  const q: any = new Proxy({}, { get: (_t, k) => (k === 'then' ? (ok: any, err: any) => Promise.resolve({ data: mockRows, error: null }).then(ok, err) : () => q) });
  const ch: any = { on: () => ch, subscribe: () => ch };
  return { supabase: { from: () => q, channel: () => ch, removeChannel: jest.fn() } };
});
jest.mock('../../context/AuthContext', () => ({ useAuth: () => ({ driver: { id: 'test' } }) }));

describe('EarningsScreen', () => {
  it('invites a new driver to start, instead of an empty page', async () => {
    mockRows = [];
    const { findByText } = render(<EarningsScreen navigation={{ navigate: jest.fn() }} />);
    expect(await findByText('No trips yet')).toBeTruthy();
  });

  it("shows today's pay from finished trips", async () => {
    mockRows = [{ id: 't1', created_at: new Date().toISOString(), completed_at: new Date().toISOString(), driver_payout_cents: 4550, total_fare_cents: 5700, payment_method: 'cash', dropoff_address: 'San Fernando' }];
    const { findByText, getAllByText } = render(<EarningsScreen navigation={{ navigate: jest.fn() }} />);
    expect(await findByText('San Fernando')).toBeTruthy();
    expect(getAllByText('TT$45.50').length).toBeGreaterThan(0);
  });
});
