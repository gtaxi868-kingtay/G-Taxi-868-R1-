import React from 'react';
import { render } from '@testing-library/react-native';
import { ActiveRideScreen } from '../ActiveRideScreen';

jest.mock('@gtaxi/core', () => ({ supabase: { channel: () => ({ on: () => ({ subscribe: jest.fn(), unsubscribe: jest.fn() }) }), from: () => ({ select: () => ({ eq: () => ({ single: jest.fn().mockResolvedValue({ data: { id: 'test', status: 'assigned', rider_id: 'rider-1', payment_method: 'cash', pickup_lat: 10.66, pickup_lng: -61.51, dropoff_lat: 10.65, dropoff_lng: -61.50, pickup_address: 'A', dropoff_address: 'B' } }), maybeSingle: jest.fn(() => Promise.resolve({ data: null })) }) }) }), functions: { invoke: jest.fn() }, removeChannel: jest.fn() }, initializeSupabaseClient: () => ({ supabase: {} }), ENV: { MAPBOX_PUBLIC_TOKEN: '' } }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(), notificationAsync: jest.fn(), ImpactFeedbackStyle: { Light: 'Light', Medium: 'Medium', Heavy: 'Heavy' }, NotificationFeedbackType: { Success: 'Success', Warning: 'Warning' } }));
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
jest.mock('../../services/api', () => ({ updateRideStatus: jest.fn() }));

describe('ActiveRideScreen', () => {
  it('renders loading state initially', () => {
    const navigation = { navigate: jest.fn(), addListener: jest.fn(), reset: jest.fn() };
    const route = { params: { rideId: 'test-ride-1', paymentMethod: 'cash' } };
    const { getByText } = render(<ActiveRideScreen navigation={navigation as any} route={route as any} />);
    expect(getByText(/Connecting to your ride/i)).toBeTruthy();
  });
});
