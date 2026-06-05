import React from 'react';
import { render } from '@testing-library/react-native';
import { NfcHandshakeScreen } from '../NfcHandshakeScreen';

jest.mock('@gtaxi/core', () => ({ supabase: { channel: () => ({ on: () => ({ subscribe: jest.fn() }) }), from: () => ({ select: () => ({ eq: () => ({ single: jest.fn(), maybeSingle: jest.fn(), order: () => ({ limit: () => ({ data: null }) }) }) }) }), auth: { getSession: () => Promise.resolve({ data: { session: { user: { id: 'test' }, access_token: 'test' } } }) }, functions: { invoke: jest.fn(() => Promise.resolve({ data: { type: 'KIOSK_HANDSHAKE', kioskId: 'test-kiosk' }, error: null })) } }, OutboxService: { getInstance: () => ({ enqueue: jest.fn().mockResolvedValue(undefined), process: jest.fn(), getPendingCount: jest.fn(), clear: jest.fn(), start: jest.fn(), stop: jest.fn() }) } }));
jest.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'test' } }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(), notificationAsync: jest.fn(), ImpactFeedbackStyle: { Light: 'Light' }, NotificationFeedbackType: { Success: 'Success' }, selectionAsync: jest.fn() }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('@/design-system/primitives', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { Txt: ({ children }: any) => React.createElement(Text, null, children) };
});

describe('NfcHandshakeScreen', () => {
  it('renders without crashing', () => {
    const navigation = { navigate: jest.fn(), goBack: jest.fn() };
    const route = { params: { tagUid: 'test-tag-uid' } };
    const { getByText } = render(<NfcHandshakeScreen navigation={navigation as any} route={route as any} />);
    expect(getByText(/Establishing Unified Handshake/i)).toBeTruthy();
  });
});
