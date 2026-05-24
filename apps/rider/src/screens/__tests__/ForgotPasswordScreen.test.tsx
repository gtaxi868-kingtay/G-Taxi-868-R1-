import React from 'react';
import { render } from '@testing-library/react-native';
import { ForgotPasswordScreen } from '../ForgotPasswordScreen';

jest.mock('@gtaxi/core', () => ({ supabase: { auth: { resetPasswordForEmail: jest.fn() } }, initializeSupabaseClient: () => ({}), ENV: {} }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(), ImpactFeedbackStyle: { Light: 'Light' } }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('@gtaxi/design-system', () => ({ SURFACE: { base: '#141122' }, VOICES: { rider: { accent: '#d2bbff', accentDark: '#a88be0', textMuted: 'rgba(174,169,181,0.65)' } } }));
jest.mock('@gtaxi/design-system/utils/style-rules', () => ({ elevationGlow: () => ({}), glassSurface: () => ({}), ghostBorder: () => ({}) }));

describe('ForgotPasswordScreen', () => {
  it('renders without crashing', () => {
    const navigation = { navigate: jest.fn(), goBack: jest.fn() };
    const { getByText } = render(<ForgotPasswordScreen navigation={navigation as any} route={{} as any} />);
    expect(getByText(/Reset/i)).toBeTruthy();
  });
});
