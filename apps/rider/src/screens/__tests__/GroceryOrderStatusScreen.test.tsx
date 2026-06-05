import React from 'react';
import { render } from '@testing-library/react-native';
import { GroceryOrderStatusScreen } from '../GroceryOrderStatusScreen';

jest.mock('@gtaxi/core', () => ({ supabase: { channel: () => ({ on: () => ({ subscribe: jest.fn(), unsubscribe: jest.fn() }) }), from: () => ({ select: () => ({ eq: () => ({ single: jest.fn().mockResolvedValue({ data: { id: 'order-1', status: 'pending', merchant_id: 'm-1', rider_id: 'r-1' } }), maybeSingle: jest.fn() }), order: () => ({ limit: () => ({ data: null }) }) }) }), functions: { invoke: jest.fn() }, removeChannel: jest.fn() }, initializeSupabaseClient: () => ({ supabase: {} }), ENV: { MAPBOX_PUBLIC_TOKEN: '' } }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(), notificationAsync: jest.fn(), ImpactFeedbackStyle: { Light: 'Light', Medium: 'Medium' }, NotificationFeedbackType: { Success: 'Success' } }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('expo-blur', () => ({ BlurView: 'BlurView' }));
jest.mock('react-native-maps', () => {
  const { View } = require('react-native');
  const React = require('react');
  const MapView = ({ children }: any) => React.createElement(View, null, children);
  return { __esModule: true, default: MapView, MapView, Marker: 'Marker', PROVIDER_DEFAULT: 'google', UrlTile: 'UrlTile' };
});
jest.mock('@gtaxi/design-system', () => ({ ANIMATION: { spring: { damping: 20, stiffness: 100, mass: 0.8 } }, SURFACE: { base: '#141122' }, VOICES: { rider: { accent: '#d2bbff', accentDark: '#a88be0', textMuted: 'rgba(174,169,181,0.65)' } } }));
jest.mock('@gtaxi/design-system/utils/style-rules', () => ({ elevationGlow: () => ({}), glassSurface: () => ({}), ghostBorder: () => ({}) }));
jest.mock('@/design-system/primitives', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { Txt: ({ children }: any) => React.createElement(Text, null, children) };
});

describe('GroceryOrderStatusScreen', () => {
  it('renders without crashing', () => {
    const navigation = { navigate: jest.fn(), goBack: jest.fn() };
    const route = { params: { orderId: 'test-order-1' } };
    const { getByText } = render(<GroceryOrderStatusScreen navigation={navigation as any} route={route as any} />);
    expect(getByText('Order Status')).toBeTruthy();
  });
});
