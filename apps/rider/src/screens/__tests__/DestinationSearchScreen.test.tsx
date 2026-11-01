import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { DestinationSearchScreen } from '../DestinationSearchScreen';

// @gtaxi/core is mocked completely in jest.setup.js (chainable builder + rpc + ENV)
jest.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'test' } }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(), notificationAsync: jest.fn(), ImpactFeedbackStyle: { Light: 'Light' }, NotificationFeedbackType: { Success: 'Success' }, selectionAsync: jest.fn() }));
jest.mock('@gtaxi/design-system', () => ({ SURFACE: { base: '#141122', containerLow: 'rgba(255,255,255,0.08)', containerHigh: 'rgba(255,255,255,0.1)' }, VOICES: { rider: { accent: '#d2bbff', accentDark: '#a88be0', bg: '#0F0D16', surface: 'rgba(255,255,255,0.08)', text: '#E9E3F0', textMuted: 'rgba(174,169,181,0.65)', border: 'rgba(119, 116, 127, 0.15)' } }, ANIMATION: { spring: { damping: 20, stiffness: 100, mass: 0.8 } } }));
jest.mock('@gtaxi/design-system/utils/style-rules', () => ({ ghostBorder: () => ({}), elevationGlow: () => ({}), glassSurface: () => ({}) }));

describe('DestinationSearchScreen', () => {
  it('renders without crashing', () => {
    const navigation = { navigate: jest.fn(), goBack: jest.fn() };
    const route = { params: { currentLocation: { latitude: 10.69, longitude: -61.22 } } };
    const _smoke = render(<DestinationSearchScreen navigation={navigation as any} route={route as any} />);
    expect(_smoke.toJSON()).toBeTruthy();
  });

  it('always offers a way out, even before anything is typed', () => {
    const navigation = { navigate: jest.fn(), goBack: jest.fn(), setParams: jest.fn() };
    const route = { params: { currentLocation: { latitude: 10.69, longitude: -61.22 } } };
    const { getByLabelText } = render(<DestinationSearchScreen navigation={navigation as any} route={route as any} />);
    fireEvent.press(getByLabelText('Set it on the map'));
    expect(navigation.navigate).toHaveBeenCalledWith('PinOnMap', { near: { latitude: 10.69, longitude: -61.22 }, label: '' });
  });

  it('carries a hand-placed pin through to booking', () => {
    const navigation = { navigate: jest.fn(), goBack: jest.fn(), setParams: jest.fn() };
    const route = { params: { currentLocation: { latitude: 10.69, longitude: -61.22 }, pinned: { latitude: 10.6, longitude: -61.3, address: 'Blue gate' } } };
    render(<DestinationSearchScreen navigation={navigation as any} route={route as any} />);
    expect(navigation.navigate).toHaveBeenCalledWith('RideConfirmation', expect.objectContaining({
      destination: { latitude: 10.6, longitude: -61.3, address: 'Blue gate' },
    }));
  });
});
