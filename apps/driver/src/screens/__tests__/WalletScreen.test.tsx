import React from 'react';
import { render } from '@testing-library/react-native';
import { WalletScreen } from '../WalletScreen';

// @gtaxi/core mocked completely in jest.setup.js
jest.mock('../../context/AuthContext', () => ({ useAuth: () => ({ driver: { id: 'test' }, user: { email: 'test@test.com' } }) }));
jest.mock('@stripe/stripe-react-native', () => ({ useStripe: () => ({ initPaymentSheet: jest.fn(), presentPaymentSheet: jest.fn() }) }));

describe('WalletScreen', () => {
  it('renders without crashing', async () => {
    const navigation = { navigate: jest.fn(), goBack: jest.fn() };
    const _smoke = render(<WalletScreen navigation={navigation as any} />);
    expect(_smoke.toJSON()).toBeTruthy();
  });
});
