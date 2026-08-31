import React from 'react';
import { render } from '@testing-library/react-native';
import { ProductListingScreen } from '../ProductListingScreen';

const productQuery = {
  select: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  order: jest.fn().mockResolvedValue({ data: [{ id: 'p1', name: 'Bread', price_cents: 200, description: 'Fresh loaf', is_available: true, merchant_id: 'test-merchant' }], error: null })
};

jest.mock('@gtaxi/core', () => ({
  supabase: { from: jest.fn(() => productQuery) },
  channel: () => ({ on: () => ({ subscribe: jest.fn() }) }),
}));
jest.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'test' } }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(), notificationAsync: jest.fn(), ImpactFeedbackStyle: { Light: 'Light', Medium: 'Medium' }, NotificationFeedbackType: { Success: 'Success' }, selectionAsync: jest.fn() }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('@gtaxi/design-system', () => ({ SURFACE: { base: '#141122', containerLow: 'rgba(255,255,255,0.08)', containerHigh: 'rgba(255,255,255,0.1)' }, VOICES: { rider: { accent: '#d2bbff', accentDark: '#a88be0', bg: '#0F0D16', surface: 'rgba(255,255,255,0.08)', text: '#E9E3F0', textMuted: 'rgba(174,169,181,0.65)', border: 'rgba(119, 116, 127, 0.15)' } }, ANIMATION: { spring: { damping: 20, stiffness: 100, mass: 0.8 } } }));
jest.mock('@gtaxi/design-system/utils/style-rules', () => ({ ghostBorder: () => ({}), elevationGlow: () => ({}) }));

describe('ProductListingScreen', () => {
  it('renders without crashing', () => {
    const navigation = { navigate: jest.fn(), goBack: jest.fn() };
    const route = { params: { merchant: { id: 'test-merchant', name: 'Test Store', category: 'grocery' } } };
    const { getByText } = render(<ProductListingScreen navigation={navigation as any} route={route as any} />);
    expect(getByText(/Test Store/i)).toBeTruthy();
  });
});
