import React from 'react';
import { render } from '@testing-library/react-native';
import { SignupScreen } from '../SignupScreen';

jest.mock('@gtaxi/core', () => ({ supabase: { auth: { signUp: jest.fn() }, from: () => ({ select: () => ({ eq: () => ({ single: jest.fn() }) }), insert: () => ({ single: jest.fn() }) }), functions: { invoke: jest.fn() } }, initializeSupabaseClient: () => ({ supabase: { auth: { signUp: jest.fn() } } }), ENV: {} }));
jest.mock('../../context/AuthContext', () => ({ useAuth: () => ({ signUp: jest.fn(), user: null }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(), notificationAsync: jest.fn(), ImpactFeedbackStyle: { Light: 'Light', Medium: 'Medium', Heavy: 'Heavy' } }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('@gtaxi/design-system', () => ({ ANIMATION: { spring: { damping: 20, stiffness: 100, mass: 0.8 } }, SURFACE: { base: '#141122' }, VOICES: { rider: { accent: '#d2bbff', accentDark: '#a88be0', textMuted: 'rgba(174,169,181,0.65)' } } }));
jest.mock('@gtaxi/design-system/utils/style-rules', () => ({ elevationGlow: () => ({}), glassSurface: () => ({}), ghostBorder: () => ({}) }));

describe('SignupScreen', () => {
  it('renders without crashing', () => {
    const navigation = { navigate: jest.fn(), goBack: jest.fn() };
    const { getByText } = render(<SignupScreen navigation={navigation as any} route={{} as any} />);
    expect(getByText(/Sign Up/i)).toBeTruthy();
  });
});
