import React from 'react';
import { render } from '@testing-library/react-native';
import { LegalScreen } from '../LegalScreen';

jest.mock('@gtaxi/core', () => ({ supabase: { channel: () => ({ on: () => ({ subscribe: jest.fn() }) }), from: () => ({ select: () => ({ eq: () => ({ single: jest.fn(), maybeSingle: jest.fn(), order: () => ({ limit: () => ({ data: null }) }) }) }) }) } }));
jest.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'test' } }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(), notificationAsync: jest.fn(), ImpactFeedbackStyle: { Light: 'Light' }, NotificationFeedbackType: { Success: 'Success' }, selectionAsync: jest.fn() }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('@/design-system/primitives', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { Txt: (props: any) => React.createElement(Text, null, props.children) };
});
jest.mock('@gtaxi/design-system', () => ({ SURFACE: { base: '#141122', containerLow: 'rgba(255,255,255,0.08)', containerHigh: 'rgba(255,255,255,0.1)' }, VOICES: { rider: { accent: '#d2bbff', accentDark: '#a88be0', bg: '#0F0D16', surface: 'rgba(255,255,255,0.08)', text: '#E9E3F0', textMuted: 'rgba(174,169,181,0.65)', border: 'rgba(119, 116, 127, 0.15)' } } }));
jest.mock('@gtaxi/design-system/native', () => { const R = require('react'); const { View } = require('react-native'); return { GlassCard: R.forwardRef(({ children }: any, ref: any) => R.createElement(View, { ref }, children)), LiquidGlass: ({ children }: any) => R.createElement(View, null, children) }; });
jest.mock('@gtaxi/design-system/utils/style-rules', () => ({ ghostBorder: () => ({}) }));

describe('LegalScreen', () => {
  it('renders without crashing', () => {
    const navigation = { navigate: jest.fn(), goBack: jest.fn() };
    const route = { params: {}, key: 'test', name: 'Legal' as const };
    const { getByText } = render(<LegalScreen navigation={navigation as any} route={route as any} />);
    expect(getByText(/LEGAL & PRIVACY PROTOCOL/i)).toBeTruthy();
  });
});
