import React from 'react';
import { render } from '@testing-library/react-native';
import { PaymentScreen } from '../PaymentScreen';

jest.mock('@gtaxi/core', () => ({ supabase: { channel: () => ({ on: () => ({ subscribe: jest.fn() }) }), from: () => ({ select: () => ({ eq: () => ({ single: jest.fn(), maybeSingle: jest.fn(), order: () => ({ limit: () => ({ data: null }) }) }) }) }), auth: { getUser: () => Promise.resolve({ data: { user: { id: 'test' } } }) }, functions: { invoke: jest.fn() } } }));
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

describe('PaymentScreen', () => {
  it('renders without crashing', () => {
    const navigation = { navigate: jest.fn(), goBack: jest.fn() };
    const route = { params: { ride_id: 'test-ride', fare_cents: 5000, payment_method: 'cash' } };
    const { getByText } = render(<PaymentScreen navigation={navigation as any} route={route as any} />);
    expect(getByText('Payment')).toBeTruthy();
  });
});
