import React from 'react';
import { render } from '@testing-library/react-native';
import { NfcScanScreen } from '../NfcScanScreen';

jest.mock('@gtaxi/core', () => ({ supabase: { channel: () => ({ on: () => ({ subscribe: jest.fn() }) }), from: () => ({ select: () => ({ eq: () => ({ single: jest.fn(), maybeSingle: jest.fn(), order: () => ({ limit: () => ({ data: null }) }) }) }) }) }, routeNfcTag: jest.fn(), RoutedNode: {}, OutboxService: { getInstance: () => ({ enqueue: jest.fn(), process: jest.fn(), getPendingCount: jest.fn(), clear: jest.fn(), start: jest.fn(), stop: jest.fn() }) } }));
jest.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'test' } }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(), notificationAsync: jest.fn(), ImpactFeedbackStyle: { Light: 'Light' }, NotificationFeedbackType: { Success: 'Success' }, selectionAsync: jest.fn() }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('@gtaxi/design-system', () => ({ SURFACE: { base: '#141122', containerLow: 'rgba(255,255,255,0.08)', containerHigh: 'rgba(255,255,255,0.1)' }, VOICES: { rider: { accent: '#d2bbff', accentDark: '#a88be0', bg: '#0F0D16', surface: 'rgba(255,255,255,0.08)', text: '#E9E3F0', textMuted: 'rgba(174,169,181,0.65)', border: 'rgba(119, 116, 127, 0.15)' } }, ANIMATION: { spring: { damping: 20, stiffness: 100, mass: 0.8 } } }));
jest.mock('@gtaxi/design-system/utils/style-rules', () => ({ ghostBorder: () => ({}), elevationGlow: () => ({}), glassSurface: () => ({}) }));

describe('NfcScanScreen', () => {
  it('renders without crashing', () => {
    const navigation = { navigate: jest.fn(), goBack: jest.fn() };
    const { getByText } = render(<NfcScanScreen navigation={navigation as any} route={{} as any} />);
    expect(getByText(/Tap or Scan/i)).toBeTruthy();
  });
});
