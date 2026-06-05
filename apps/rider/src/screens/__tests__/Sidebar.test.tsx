import React from 'react';
import { render } from '@testing-library/react-native';
import { Sidebar } from '../../components/Sidebar';

jest.mock('@gtaxi/core', () => ({ supabase: { auth: { signOut: jest.fn() } } }));
jest.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'test' } }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(), notificationAsync: jest.fn(), ImpactFeedbackStyle: { Light: 'Light' }, NotificationFeedbackType: { Success: 'Success' }, selectionAsync: jest.fn() }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('@/design-system/primitives', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { Txt: ({ children }: any) => React.createElement(Text, null, children) };
});
jest.mock('@gtaxi/design-system', () => ({ Logo: 'Logo', SURFACE: { base: '#141122', containerLow: 'rgba(255,255,255,0.08)', containerHigh: 'rgba(255,255,255,0.1)' }, VOICES: { rider: { accent: '#d2bbff', accentDark: '#a88be0', bg: '#0F0D16', surface: 'rgba(255,255,255,0.08)', text: '#E9E3F0', textMuted: 'rgba(174,169,181,0.65)', border: 'rgba(119, 116, 127, 0.15)' } }, ANIMATION: { spring: { damping: 20, stiffness: 100, mass: 0.8 } } }));

describe('Sidebar', () => {
  it('renders when visible', () => {
    const navigation = { navigate: jest.fn() };
    const { getByText } = render(<Sidebar visible={true} onClose={jest.fn()} navigation={navigation as any} />);
    expect(getByText(/YOUR TRIPS/i)).toBeTruthy();
  });

  it('returns null when not visible', () => {
    const navigation = { navigate: jest.fn() };
    const { queryByText } = render(<Sidebar visible={false} onClose={jest.fn()} navigation={navigation as any} />);
    expect(queryByText(/YOUR TRIPS/i)).toBeNull();
  });
});
