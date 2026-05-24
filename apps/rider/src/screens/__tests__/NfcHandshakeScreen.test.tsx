import React from 'react';
import { render } from '@testing-library/react-native';
import { NfcHandshakeScreen } from '../NfcHandshakeScreen';

jest.mock('@gtaxi/core', () => ({ supabase: { channel: () => ({ on: () => ({ subscribe: jest.fn() }) }), from: () => ({ select: () => ({ eq: () => ({ single: jest.fn(), maybeSingle: jest.fn(), order: () => ({ limit: () => ({ data: null }) }) }) }) }) }, auth: { getSession: () => ({ data: { session: null } }) }, functions: { invoke: jest.fn() } }));
jest.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'test' } }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(), notificationAsync: jest.fn(), ImpactFeedbackStyle: { Light: 'Light' }, NotificationFeedbackType: { Success: 'Success' }, selectionAsync: jest.fn() }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('@/design-system/primitives', () => ({ Txt: 'Txt' }));

describe('NfcHandshakeScreen', () => {
  it('renders without crashing', () => {
    const navigation = { navigate: jest.fn(), goBack: jest.fn() };
    const route = { params: {} };
    const { getByText } = render(<NfcHandshakeScreen navigation={navigation as any} route={route as any} />);
    expect(getByText(/Establishing Unified Handshake/i)).toBeTruthy();
  });
});
