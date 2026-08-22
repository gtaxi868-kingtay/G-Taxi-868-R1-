import React from 'react';
import { render } from '@testing-library/react-native';
import { RideConfirmationScreen } from '../RideConfirmationScreen';

jest.mock('@gtaxi/core', () => {
  // RideConfirmationScreen reads `supabase` from initializeSupabaseClient('native')'s
  // return value, not the module's top-level `supabase` export — the previous
  // version of this mock gave that call a separate, incomplete stub object
  // (only `.auth.getUser`), so `supabase.from(...)` failed with "not a function"
  // even though the mock above it looked complete. Same object, both places.
  const mockSupabase = {
    channel: () => ({ on: () => ({ subscribe: jest.fn() }) }),
    from: () => ({
      select: () => ({
        eq: () => ({ single: jest.fn(), maybeSingle: jest.fn() }),
        order: () => Promise.resolve({ data: null }),
      }),
    }),
    functions: { invoke: jest.fn().mockResolvedValue({ data: { success: true, data: {} } }) },
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'test' } } }) },
    storage: { from: () => ({ upload: jest.fn(), getPublicUrl: () => ({ data: { publicUrl: '' } }) }) },
  };
  return {
    supabase: mockSupabase,
    initializeSupabaseClient: () => ({ supabase: mockSupabase, getSupabase: jest.fn(() => mockSupabase) }),
    ENV: { MAPBOX_PUBLIC_TOKEN: '' },
  };
});
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
jest.mock('expo-camera', () => ({ CameraView: 'CameraView', useCameraPermissions: () => [false, jest.fn()] }));
jest.mock('@gtaxi/design-system', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { ANIMATION: { spring: { damping: 20, stiffness: 100, mass: 0.8 } }, SURFACE: { base: '#141122', containerLow: 'rgba(255,255,255,0.08)', containerHigh: 'rgba(255,255,255,0.1)' }, VOICES: { rider: { accent: '#d2bbff', accentDark: '#a88be0', bg: '#0F0D16', surface: 'rgba(255,255,255,0.08)', text: '#E9E3F0', textMuted: 'rgba(174,169,181,0.65)', border: 'rgba(119, 116, 127, 0.15)' } }, GlassCard: ({ children, style }: any) => React.createElement(View, { style }, children) };
});
jest.mock('@gtaxi/design-system/utils/style-rules', () => ({ elevationGlow: () => ({}), glassSurface: () => ({}), ghostBorder: () => ({}) }));
jest.mock('../../services/api', () => ({ estimateFare: jest.fn().mockResolvedValue({ success: true, data: { total_fare_cents: 2500, distance_meters: 5000, duration_seconds: 600 } }), createRide: jest.fn(), getWalletBalance: jest.fn().mockResolvedValue({ success: true, data: 10000 }) }));
jest.mock('../../utils/currency', () => ({ formatTTDDollars: (v: number) => `TTD $${v.toFixed(2)}` }));

describe('RideConfirmationScreen', () => {
  it('renders without crashing', () => {
    const navigation = { navigate: jest.fn(), replace: jest.fn(), goBack: jest.fn() };
    const route = { params: { destination: { latitude: 10.65, longitude: -61.50, address: 'Test Dest' }, pickup: { latitude: 10.66, longitude: -61.51, address: 'Test Pickup' } } };
    const _smoke = render(<RideConfirmationScreen navigation={navigation as any} route={route as any} />);
    expect(_smoke.toJSON()).toBeTruthy();
  });
});
