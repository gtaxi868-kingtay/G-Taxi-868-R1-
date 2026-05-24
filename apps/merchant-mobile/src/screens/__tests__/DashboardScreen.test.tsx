import React from 'react';
import { render } from '@testing-library/react-native';
import { DashboardScreen } from '../DashboardScreen';

jest.mock('@gtaxi/core', () => ({ supabase: { channel: () => ({ on: () => ({ subscribe: jest.fn() }) }), from: () => ({ select: () => ({ eq: () => ({ order: () => ({ limit: () => ({ data: { data: [] } }) }), single: jest.fn() }) }) }), functions: { invoke: jest.fn() } }, ENV: {} }));
jest.mock('../../context/AuthContext', () => ({ useAuth: () => ({ merchant: { id: 'm-1', name: 'Test Merchant' } }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-blur', () => ({ BlurView: 'BlurView' }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('@gtaxi/design-system', () => ({ SURFACE: { base: '#141122', containerLow: 'rgba(255,255,255,0.08)' }, VOICES: { merchant: { accent: '#007070', accentDark: '#005050', textMuted: 'rgba(174,169,181,0.65)' } }, ANIMATION: { spring: { damping: 20, stiffness: 100 } } }));
jest.mock('@gtaxi/design-system/utils/style-rules', () => ({ elevationGlow: () => ({}), glassSurface: () => ({}), ghostBorder: () => ({}) }));

describe('Merchant DashboardScreen', () => {
  it('renders without crashing', () => {
    const navigation = { navigate: jest.fn() };
    const { getByText } = render(<DashboardScreen navigation={navigation as any} />);
    expect(getByText(/Dashboard/i)).toBeTruthy();
  });
});
