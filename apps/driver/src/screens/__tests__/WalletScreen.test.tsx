import React from 'react';
import { render } from '@testing-library/react-native';
import { WalletScreen } from '../WalletScreen';

jest.mock('@gtaxi/core', () => ({ supabase: { channel: () => ({ on: () => ({ subscribe: jest.fn() }) }), from: () => ({ select: () => ({ eq: () => ({ order: () => ({ limit: () => ({ data: null }) }) }) }), insert: jest.fn() }), rpc: jest.fn().mockResolvedValue({ data: null }), auth: { getSession: jest.fn() } } }));
jest.mock('../../context/AuthContext', () => ({ useAuth: () => ({ driver: { id: 'test' }, user: { email: 'test@test.com' } }) }));
jest.mock('@stripe/stripe-react-native', () => ({ useStripe: () => ({ initPaymentSheet: jest.fn(), presentPaymentSheet: jest.fn() }) }));

describe('WalletScreen', () => {
  it('renders without crashing', async () => {
    const navigation = { navigate: jest.fn(), goBack: jest.fn() };
    const { findByText } = render(<WalletScreen navigation={navigation as any} />);
    expect(await findByText(/^Wallet$/i)).toBeTruthy();
  });
});
