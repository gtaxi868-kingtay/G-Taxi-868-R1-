import React from 'react';
import { render } from '@testing-library/react-native';
import { SearchingDriverScreen } from '../SearchingDriverScreen';

jest.mock('@gtaxi/core', () => ({ supabase: { channel: () => ({ on: () => ({ subscribe: jest.fn() }) }), from: () => ({ select: () => ({ eq: () => ({ single: jest.fn(), maybeSingle: jest.fn() }), order: () => ({ limit: () => ({ data: null }) }) }) }), functions: { invoke: jest.fn() } }, initializeSupabaseClient: () => ({ supabase: { channel: jest.fn() } }), ENV: {} }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(), notificationAsync: jest.fn(), ImpactFeedbackStyle: { Light: 'Light', Medium: 'Medium', Heavy: 'Heavy' }, NotificationFeedbackType: { Success: 'Success' } }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('expo-blur', () => ({ BlurView: 'BlurView' }));
jest.mock('react-native-maps', () => {
  const { View } = require('react-native');
  const React = require('react');
  const MapView = ({ children }: any) => React.createElement(View, null, children);
  return { __esModule: true, default: MapView, MapView, Marker: 'Marker', PROVIDER_DEFAULT: 'google', UrlTile: 'UrlTile' };
});
jest.mock('@gtaxi/design-system', () => ({ ANIMATION: { spring: { damping: 20, stiffness: 100, mass: 0.8 } }, SURFACE: { base: '#141122', containerLow: 'rgba(255,255,255,0.08)' }, VOICES: { rider: { accent: '#d2bbff', accentDark: '#a88be0', textMuted: 'rgba(174,169,181,0.65)' } } }));
jest.mock('@gtaxi/design-system/utils/style-rules', () => ({ elevationGlow: () => ({}), glassSurface: () => ({}), ghostBorder: () => ({}) }));

describe('SearchingDriverScreen', () => {
  it('renders without crashing', () => {
    const navigation = { navigate: jest.fn(), replace: jest.fn(), goBack: jest.fn(), reset: jest.fn(), addListener: jest.fn() };
    const route = { params: { rideId: 'test-ride-1', destination: { latitude: 10.65, longitude: -61.50, address: 'Dest' }, pickup: { latitude: 10.66, longitude: -61.51, address: 'Pickup' } } };
    const { getByText } = render(<SearchingDriverScreen navigation={navigation as any} route={route as any} />);
    expect(getByText(/Finding your G-Taxi/i)).toBeTruthy();
  });
});
