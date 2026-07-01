import React from 'react';
import { render } from '@testing-library/react-native';
import { OrdersScreen } from '../OrdersScreen';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-blur', () => ({ BlurView: 'BlurView' }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('@gtaxi/design-system', () => ({ SURFACE: { base: '#141122' }, VOICES: { merchant: { accent: '#007070', accentDark: '#005050', textMuted: 'rgba(174,169,181,0.65)' } } }));
jest.mock('@gtaxi/design-system/utils/style-rules', () => ({ elevationGlow: () => ({}), ghostBorder: () => ({}) }));

describe('Merchant OrdersScreen', () => {
  it('renders without crashing', () => {
    const navigation = { navigate: jest.fn() };
    const { getAllByText } = render(<OrdersScreen navigation={navigation as any} />);
    expect(getAllByText(/Orders/i).length).toBeGreaterThan(0);
  });
});
