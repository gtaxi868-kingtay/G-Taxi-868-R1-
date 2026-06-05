import React from 'react';
import { render } from '@testing-library/react-native';
import { WalletScreen } from '../WalletScreen';

jest.mock('@gtaxi/core', () => ({ supabase: { channel: () => ({ on: () => ({ subscribe: jest.fn() }) }), from: () => ({ select: () => ({ eq: () => ({ single: jest.fn(), maybeSingle: jest.fn(), order: () => ({ limit: () => ({ data: null }) }) }) }) }) }, rpc: () => ({ then: (cb: any) => cb({ data: 0, error: null }) }), removeChannel: jest.fn() }));
jest.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'test' } }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(), notificationAsync: jest.fn(), ImpactFeedbackStyle: { Light: 'Light' }, NotificationFeedbackType: { Success: 'Success' }, selectionAsync: jest.fn() }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('@/design-system/primitives', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { Txt: ({ children }: any) => React.createElement(Text, null, children) };
});

describe('WalletScreen', () => {
  it('renders without crashing', () => {
    const navigation = { navigate: jest.fn(), goBack: jest.fn() };
    const { getByText } = render(<WalletScreen navigation={navigation as any} />);
    expect(getByText(/Luxe Wallet/i)).toBeTruthy();
  });
});
