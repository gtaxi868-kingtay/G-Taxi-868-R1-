import React from 'react';
import { render } from '@testing-library/react-native';
import { HomeScreen } from '../HomeScreen';

jest.mock('@gtaxi/core', () => ({ supabase: { channel: () => ({ on: () => ({ subscribe: jest.fn() }) }), from: () => ({ select: () => ({ eq: () => ({ single: jest.fn(), maybeSingle: jest.fn(), order: () => ({ limit: () => ({ data: null }) }) }) }) }), functions: { invoke: jest.fn() }, rpc: jest.fn() }, initializeSupabaseClient: () => ({ supabase: { channel: () => ({ on: () => ({ subscribe: jest.fn() }) }), from: () => ({ select: () => ({ eq: () => ({ single: jest.fn(), maybeSingle: jest.fn(), order: () => ({ limit: () => ({ data: null }) }) }) }) }), functions: { invoke: jest.fn() }, rpc: jest.fn() } }), DEFAULT_LOCATION: { latitude: 10.6918, longitude: -61.2225 }, ENV: { MAPBOX_PUBLIC_TOKEN: '' }, SavedPlace: {}, Location: {}, haversineMeters: jest.fn(), isWithinRadius: jest.fn(), checkGeofenceZone: jest.fn() }));
jest.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'test' }, profile: { name: 'Test User' }, refreshProfile: jest.fn() }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(), notificationAsync: jest.fn(), ImpactFeedbackStyle: { Light: 'Light', Medium: 'Medium', Heavy: 'Heavy' }, NotificationFeedbackType: { Success: 'Success', Warning: 'Warning' }, selectionAsync: jest.fn() }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('expo-location', () => ({ requestForegroundPermissionsAsync: jest.fn(), getCurrentPositionAsync: jest.fn(), watchPositionAsync: jest.fn(), LocationObject: {} }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn(), MediaTypeOptions: { Images: 'Images' } }));
jest.mock('react-native-maps', () => ({ MapView: 'MapView', Marker: 'Marker', PROVIDER_DEFAULT: 'google', UrlTile: 'UrlTile' }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn() }));
jest.mock('@react-native-community/netinfo', () => ({ useNetInfo: () => ({ isConnected: true }) }));
jest.mock('@gtaxi/design-system', () => ({ ANIMATION: { spring: { damping: 20, stiffness: 100, mass: 0.8 } }, SURFACE: { base: '#141122', containerLow: 'rgba(255,255,255,0.08)', containerHigh: 'rgba(255,255,255,0.1)' }, VOICES: { rider: { accent: '#d2bbff', accentDark: '#a88be0', bg: '#0F0D16', surface: 'rgba(255,255,255,0.08)', text: '#E9E3F0', textMuted: 'rgba(174,169,181,0.65)', border: 'rgba(119, 116, 127, 0.15)' } } }));
jest.mock('@gtaxi/design-system/utils/style-rules', () => ({ elevationGlow: () => ({}), glassSurface: () => ({}), ghostBorder: () => ({}) }));
jest.mock('../components/Sidebar', () => ({ Sidebar: 'Sidebar' }));
jest.mock('../components/SavedPlaceModal', () => ({ SavedPlaceModal: 'SavedPlaceModal' }));
jest.mock('../components/RecentRidesModal', () => ({ RecentRidesModal: 'RecentRidesModal' }));
jest.mock('../services/api', () => ({ getSavedPlaces: jest.fn(), savePlace: jest.fn(), getRecentRides: jest.fn(), estimateFare: jest.fn() }));
jest.mock('../hooks/useNearbyDrivers', () => ({ useNearbyDrivers: () => ({ drivers: [], loading: false }) }));
jest.mock('../utils/currency', () => ({ formatTTDDollars: (v: number) => `$${(v / 100).toFixed(2)}` }));

describe('HomeScreen', () => {
  it('renders without crashing', () => {
    const navigation = { navigate: jest.fn(), replace: jest.fn(), reset: jest.fn() };
    const { getByText } = render(<HomeScreen navigation={navigation as any} route={{} as any} />);
    expect(getByText(/Get a taxi anywhere/i)).toBeTruthy();
  });
});
