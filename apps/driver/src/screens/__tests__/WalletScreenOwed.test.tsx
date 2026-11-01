import React from 'react';
import { render } from '@testing-library/react-native';
import { WalletScreen } from '../WalletScreen';

jest.mock('@gtaxi/core', () => {
  const q: any = new Proxy({}, { get: (_t, k) => (k === 'then' ? (ok: any, err: any) => Promise.resolve({ data: [], error: null }).then(ok, err) : k === 'single' || k === 'maybeSingle' ? () => Promise.resolve({ data: null, error: null }) : () => q) });
  return { supabase: { from: () => q, rpc: jest.fn(() => Promise.resolve({ data: -65000, error: null })), functions: { invoke: jest.fn() }, auth: { getSession: jest.fn() }, storage: { from: jest.fn() } } };
});
jest.mock('../../context/AuthContext', () => ({ useAuth: () => ({ driver: { id: 'd1' }, user: { id: 'u1' } }) }));
jest.mock('@stripe/stripe-react-native', () => ({ useStripe: () => ({ initPaymentSheet: jest.fn(), presentPaymentSheet: jest.fn() }) }));

describe('WalletScreen when the driver owes over the limit', () => {
  it('says how much, that they are locked, and never quotes a flat platform %', async () => {
    const { findByText, getByText, queryByText } = render(<WalletScreen navigation={{ navigate: jest.fn(), goBack: jest.fn() }} />);
    expect(await findByText('YOU OWE G868')).toBeTruthy();
    expect(getByText('TT$650.00')).toBeTruthy();
    expect(getByText("Can't go online until settled")).toBeTruthy();
    expect(getByText('Settle what I owe')).toBeTruthy();
    expect(queryByText(/15%/)).toBeNull();
  }, 20000);
});
