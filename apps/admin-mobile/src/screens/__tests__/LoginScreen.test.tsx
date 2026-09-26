import React from 'react';
import { render } from '@testing-library/react-native';
import { LoginScreen } from '../LoginScreen';

jest.mock('../../context/AuthContext', () => ({ useAuth: () => ({ signIn: jest.fn(), user: null }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('@gtaxi/design-system', () => ({ SURFACE: { base: '#141122' }, VOICES: { admin: { accent: '#3b374a', accentDark: '#2d2938', textMuted: 'rgba(174,169,181,0.65)' } }, ANIMATION: { spring: { damping: 20, stiffness: 100 } } }));
jest.mock('@gtaxi/design-system/utils/style-rules', () => ({ elevationGlow: () => ({}), glassSurface: () => ({}), ghostBorder: () => ({}) }));
// @gtaxi/design-system-native's own `export * from './rainLogin'` barrel
// re-export doesn't propagate through Jest's CommonJS transform (RainLogin/
// CrystalInput/CrystalButton all resolve undefined via the package's index,
// even though requiring './rainLogin' directly works fine) -- a real gap in
// the shared package worth its own investigation, not something to route
// around in app code. Mocked here the same simple-stand-in way GlassCard etc.
// are mocked elsewhere so this screen's own logic can still be exercised.
jest.mock('@gtaxi/design-system-native', () => {
  const React = require('react');
  const { View, Text, TextInput, Pressable } = require('react-native');
  return {
    RainLogin: ({ title, subtitle, children, footer }: any) =>
      React.createElement(View, null,
        title ? React.createElement(Text, null, title) : null,
        subtitle ? React.createElement(Text, null, subtitle) : null,
        children,
        footer
      ),
    CrystalInput: ({ label, value, onChangeText, placeholder, testID }: any) =>
      React.createElement(View, null,
        label ? React.createElement(Text, null, label) : null,
        React.createElement(TextInput, { testID, value, onChangeText, placeholder })
      ),
    CrystalButton: ({ title, onPress, loading }: any) =>
      React.createElement(Pressable, { onPress },
        React.createElement(Text, null, loading ? 'Loading...' : title)
      ),
  };
});

const mockNavigation = { navigate: jest.fn() } as any;

describe('Admin LoginScreen', () => {
  it('renders without crashing', () => {
    const { getByText } = render(<LoginScreen navigation={mockNavigation} />);
    expect(getByText(/Admin/i)).toBeTruthy();
  });
});
