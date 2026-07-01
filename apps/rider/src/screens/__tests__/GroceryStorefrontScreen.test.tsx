import React from 'react';
import { render } from '@testing-library/react-native';
import { GroceryStorefrontScreen } from '../GroceryStorefrontScreen';

// @gtaxi/core mocked completely in jest.setup.js
jest.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'test' } }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(), notificationAsync: jest.fn(), ImpactFeedbackStyle: { Light: 'Light' }, NotificationFeedbackType: { Success: 'Success' }, selectionAsync: jest.fn() }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('@gtaxi/design-system', () => ({ LoadingOverlay: 'LoadingOverlay', SURFACE: { base: '#141122', containerLow: 'rgba(255,255,255,0.08)', containerHigh: 'rgba(255,255,255,0.1)' }, VOICES: { rider: { accent: '#d2bbff', accentDark: '#a88be0', bg: '#0F0D16', surface: 'rgba(255,255,255,0.08)', text: '#E9E3F0', textMuted: 'rgba(174,169,181,0.65)', border: 'rgba(119, 116, 127, 0.15)' } }, ANIMATION: { spring: { damping: 20, stiffness: 100, mass: 0.8 } } }));

describe('GroceryStorefrontScreen', () => {
  it('renders without crashing', () => {
    const navigation = { navigate: jest.fn(), goBack: jest.fn() };
    const _smoke = render(<GroceryStorefrontScreen navigation={navigation as any} />);
    expect(_smoke.toJSON()).toBeTruthy();
  });
});
