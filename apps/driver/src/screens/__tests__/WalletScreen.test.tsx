import React from 'react';
import { render } from '@testing-library/react-native';
import { WalletScreen } from '../WalletScreen';

jest.mock('@gtaxi/core', () => ({ supabase: { channel: () => ({ on: () => ({ subscribe: jest.fn() }) }), from: () => ({ select: () => ({ eq: () => ({ order: () => ({ limit: () => ({ data: null }) }) }) }), insert: jest.fn() }), rpc: jest.fn(), auth: { getSession: jest.fn() } } }));
jest.mock('../../context/AuthContext', () => ({ useAuth: () => ({ driver: { id: 'test' }, user: { email: 'test@test.com' } }) }));
jest.mock('@stripe/stripe-react-native', () => ({ useStripe: () => ({ initPaymentSheet: jest.fn(), presentPaymentSheet: jest.fn() }) }));

describe('WalletScreen', () => {
  it('renders without crashing', () => {
    const navigation = { navigate: jest.fn(), goBack: jest.fn() };
    const { getByText } = render(<WalletScreen navigation={navigation as any} />);
    expect(getByText(/Wallet/i)).toBeTruthy();
  });
});
