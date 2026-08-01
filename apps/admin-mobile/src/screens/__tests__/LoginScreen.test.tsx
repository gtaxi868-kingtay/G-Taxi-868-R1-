import React from 'react';
import { render } from '@testing-library/react-native';
import { LoginScreen } from '../LoginScreen';

jest.mock('../../context/AuthContext', () => ({ useAuth: () => ({ signIn: jest.fn(), user: null }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('@gtaxi/design-system', () => ({ SURFACE: { base: '#141122' }, VOICES: { admin: { accent: '#3b374a', accentDark: '#2d2938', textMuted: 'rgba(174,169,181,0.65)' } }, ANIMATION: { spring: { damping: 20, stiffness: 100 } } }));
jest.mock('@gtaxi/design-system/utils/style-rules', () => ({ elevationGlow: () => ({}), glassSurface: () => ({}), ghostBorder: () => ({}) }));

const mockNavigation = { navigate: jest.fn() } as any;

describe('Admin LoginScreen', () => {
  it('renders without crashing', () => {
    const { getByText } = render(<LoginScreen navigation={mockNavigation} />);
    expect(getByText(/Admin/i)).toBeTruthy();
  });
});
