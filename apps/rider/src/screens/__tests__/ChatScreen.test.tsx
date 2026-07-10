import React from 'react';
import { render } from '@testing-library/react-native';
import { ChatScreen } from '../ChatScreen';

jest.mock('@gtaxi/core', () => ({ supabase: { channel: () => ({ on: () => ({ subscribe: jest.fn() }) }), from: () => ({ select: () => ({ eq: () => ({ single: jest.fn(), maybeSingle: jest.fn(), order: () => ({ limit: () => ({ data: null }) }) }) }) }) } }));
jest.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'test' } }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(), notificationAsync: jest.fn(), ImpactFeedbackStyle: { Light: 'Light' }, NotificationFeedbackType: { Success: 'Success' }, selectionAsync: jest.fn() }));
jest.mock('@gtaxi/design-system/native', () => { const R = require('react'); const { View } = require('react-native'); return { LiquidGlass: ({ children }: any) => R.createElement(View, null, children) }; });

describe('ChatScreen', () => {
  it('renders without crashing', () => {
    const navigation = { navigate: jest.fn(), goBack: jest.fn() };
    const route = { params: { rideId: 'test-ride', driver: { name: 'Test Driver' } } };
    const { getByText } = render(<ChatScreen navigation={navigation as any} route={route as any} />);
    expect(getByText(/Test Driver/i)).toBeTruthy();
  });
});
