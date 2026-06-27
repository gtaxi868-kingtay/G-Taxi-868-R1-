import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { HomeScreen } from '../HomeScreen';

jest.mock('@gtaxi/core', () => {
  const eqResult = { single: jest.fn(() => Promise.resolve({ data: null, error: null })), maybeSingle: jest.fn(() => Promise.resolve({ data: null, error: null })), order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) };
  const rpcResult = { maybeSingle: () => Promise.resolve({ data: null, error: null }), single: () => Promise.resolve({ data: null, error: null }), then: (cb: any) => Promise.resolve({ data: [], error: null }).then(cb) };
  const channelObj: any = { on: () => channelObj, subscribe: jest.fn(() => channelObj), unsubscribe: jest.fn() };
  const supabaseMock = { channel: () => channelObj, removeChannel: jest.fn(), from: () => ({ select: () => ({ eq: () => eqResult, order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }) }), functions: { invoke: jest.fn(() => Promise.resolve({ data: null, error: null })) }, rpc: jest.fn(() => rpcResult) };
  return { supabase: supabaseMock, initializeSupabaseClient: () => ({ supabase: supabaseMock }), DEFAULT_LOCATION: { latitude: 10.6918, longitude: -61.2225 }, ENV: { MAPBOX_PUBLIC_TOKEN: '' }, SavedPlace: {}, Location: {}, haversineMeters: jest.fn(), isWithinRadius: jest.fn(), checkGeofenceZone: jest.fn() };
});
jest.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'test' }, profile: { name: 'Test User' }, refreshProfile: jest.fn() }) }));
jest.mock('../../context/RideContext', () => ({ useRide: () => ({ activeRide: null, loading: false, checkActiveRide: jest.fn(), clearActiveRide: jest.fn() }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(), notificationAsync: jest.fn(), ImpactFeedbackStyle: { Light: 'Light', Medium: 'Medium', Heavy: 'Heavy' }, NotificationFeedbackType: { Success: 'Success', Warning: 'Warning' }, selectionAsync: jest.fn() }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('expo-location', () => ({ requestForegroundPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted' })), getCurrentPositionAsync: jest.fn(() => Promise.resolve({ coords: { latitude: 10.6918, longitude: -61.2225, accuracy: 100 } })), watchPositionAsync: jest.fn(() => ({ remove: jest.fn() })), LocationObject: {}, Accuracy: { High: 'High', Balanced: 'Balanced', Low: 'Low' } }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn(), MediaTypeOptions: { Images: 'Images' } }));
jest.mock('react-native-maps', () => {
  const { View } = require('react-native');
  const React = require('react');
  const MapView = ({ children }: any) => React.createElement(View, null, children);
  return { __esModule: true, default: MapView, MapView, Marker: 'Marker', PROVIDER_DEFAULT: 'google', UrlTile: 'UrlTile' };
});
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn() }));
jest.mock('@react-native-community/netinfo', () => ({ useNetInfo: () => ({ isConnected: true }) }));
jest.mock('@gtaxi/design-system', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { GlassCard: ({ children }: any) => React.createElement(View, null, children), Skeleton: () => React.createElement(View, null), ANIMATION: { spring: { damping: 20, stiffness: 100, mass: 0.8 } }, SURFACE: { base: '#141122', containerLow: 'rgba(255,255,255,0.08)', containerHigh: 'rgba(255,255,255,0.1)' }, VOICES: { rider: { accent: '#d2bbff', accentDark: '#a88be0', bg: '#0F0D16', surface: 'rgba(255,255,255,0.08)', text: '#E9E3F0', textMuted: 'rgba(174,169,181,0.65)', border: 'rgba(119, 116, 127, 0.15)' } } };
});
jest.mock('@gtaxi/design-system/utils/style-rules', () => ({ elevationGlow: () => ({}), glassSurface: () => ({}), ghostBorder: () => ({}) }));
jest.mock('@gtaxi/design-system/native', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { LiquidGlass: ({ children }: any) => React.createElement(View, null, children), Skeleton: () => React.createElement(View, null) };
});
jest.mock('../../components/home/LayerDeck', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { LayerDeck: ({ children }: any) => React.createElement(View, null, children), Layer: ({ children }: any) => React.createElement(View, null, children) };
});
jest.mock('../../components/Sidebar', () => ({ Sidebar: 'Sidebar' }));
jest.mock('../../components/SavedPlaceModal', () => ({ SavedPlaceModal: 'SavedPlaceModal' }));
jest.mock('../../components/RecentRidesModal', () => ({ RecentRidesModal: 'RecentRidesModal' }));
jest.mock('../../services/api', () => ({ getSavedPlaces: jest.fn(() => Promise.resolve([])), savePlace: jest.fn(), getRecentRides: jest.fn(() => Promise.resolve([])), estimateFare: jest.fn() }));
jest.mock('../../hooks/useNearbyDrivers', () => ({ useNearbyDrivers: () => ({ drivers: [], loading: false }) }));
jest.mock('../../utils/currency', () => ({ formatTTDDollars: (v: number) => `$${(v / 100).toFixed(2)}` }));

describe('HomeScreen', () => {
  it('renders without crashing', async () => {
    const navigation = { navigate: jest.fn(), replace: jest.fn(), reset: jest.fn() };
    const tree = render(<HomeScreen navigation={navigation as any} route={{} as any} />);
    // Smoke test: the screen mounts and produces a non-empty tree without throwing.
    // (Headline copy is AI-generated/dynamic, so we don't assert on volatile text.)
    await waitFor(() => expect(tree.toJSON()).toBeTruthy());
  });
});
