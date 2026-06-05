import React from 'react';
import { render } from '@testing-library/react-native';
import { WalletTopUpScreen } from '../WalletTopUpScreen';

jest.mock('@gtaxi/core', () => {
  const eqResult = { single: jest.fn(() => Promise.resolve({ data: null })), maybeSingle: jest.fn(), order: () => ({ limit: () => ({ data: null }) }) };
  return { supabase: { channel: () => ({ on: () => ({ subscribe: jest.fn() }) }), from: () => ({ select: () => ({ eq: () => eqResult }) }), rpc: jest.fn(() => Promise.resolve({ data: 0, error: null })), auth: { getSession: () => ({ data: { session: { access_token: 'test' } } }) } } };
});
jest.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'test' } }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(), notificationAsync: jest.fn(), ImpactFeedbackStyle: { Light: 'Light' }, NotificationFeedbackType: { Success: 'Success' }, selectionAsync: jest.fn() }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('@/design-system/primitives', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { Txt: ({ children }: any) => React.createElement(Text, null, children) };
});
jest.mock('@stripe/stripe-react-native', () => ({ useStripe: () => ({ initPaymentSheet: jest.fn(), presentPaymentSheet: jest.fn() }) }));
jest.mock('@gtaxi/shared/env', () => ({ ENV: { SUPABASE_URL: 'https://test.supabase.co' } }));

describe('WalletTopUpScreen', () => {
  it('renders without crashing', () => {
    const navigation = { navigate: jest.fn(), goBack: jest.fn() };
    const { getByText } = render(<WalletTopUpScreen navigation={navigation as any} />);
    expect(getByText(/Financial Support/i)).toBeTruthy();
  });
});
