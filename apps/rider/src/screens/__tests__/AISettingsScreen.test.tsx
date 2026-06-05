import React from 'react';
import { render } from '@testing-library/react-native';
import { AISettingsScreen } from '../AISettingsScreen';

jest.mock('@gtaxi/core', () => ({ supabase: { channel: () => ({ on: () => ({ subscribe: jest.fn() }) }), from: () => ({ select: () => ({ eq: () => ({ single: jest.fn(() => Promise.resolve({ data: null })), maybeSingle: jest.fn(), order: () => ({ limit: () => ({ data: null }) }) }) }) }) } }));
jest.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'test' } }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(), notificationAsync: jest.fn(), ImpactFeedbackStyle: { Light: 'Light' }, NotificationFeedbackType: { Success: 'Success' }, selectionAsync: jest.fn() }));
jest.mock('@react-native-async-storage/async-storage', () => ({ removeItem: jest.fn() }));
jest.mock('@/design-system/primitives', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { Txt: ({ children }: any) => React.createElement(Text, null, children) };
});

describe('AISettingsScreen', () => {
  it('renders without crashing', async () => {
    const navigation = { navigate: jest.fn(), goBack: jest.fn() };
    const { findByText } = render(<AISettingsScreen navigation={navigation as any} />);
    expect(await findByText(/AI & Safety/i)).toBeTruthy();
  });
});
