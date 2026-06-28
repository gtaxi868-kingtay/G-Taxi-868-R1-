import React from 'react';
import { render } from '@testing-library/react-native';
import { RegisterScreen } from '../RegisterScreen';

jest.mock('../../context/AuthContext', () => ({ useAuth: () => ({ signUp: jest.fn() }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-blur', () => ({ BlurView: 'BlurView' }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('@gtaxi/design-system', () => ({ SURFACE: { base: '#141122' }, VOICES: { merchant: { accent: '#007070', accentDark: '#005050', textMuted: 'rgba(174,169,181,0.65)' } }, ANIMATION: { spring: { damping: 20, stiffness: 100 } } }));
jest.mock('@gtaxi/design-system/utils/style-rules', () => ({ elevationGlow: () => ({}), glassSurface: () => ({}), ghostBorder: () => ({}) }));

describe('Merchant RegisterScreen', () => {
  it('renders without crashing', () => {
    const navigation = { navigate: jest.fn(), goBack: jest.fn() };
    const { getAllByText } = render(<RegisterScreen navigation={navigation as any} />);
    expect(getAllByText(/Register/i).length).toBeGreaterThan(0);
  });
});
