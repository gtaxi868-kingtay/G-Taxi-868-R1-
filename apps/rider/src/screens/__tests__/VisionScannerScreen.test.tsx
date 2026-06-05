import React from 'react';
import { render } from '@testing-library/react-native';
import { VisionScannerScreen } from '../VisionScannerScreen';

jest.mock('@gtaxi/core', () => ({ supabase: { channel: () => ({ on: () => ({ subscribe: jest.fn() }) }), from: () => ({ select: () => ({ eq: () => ({ single: jest.fn(), maybeSingle: jest.fn(), order: () => ({ limit: () => ({ data: null }) }) }) }) }) }, functions: { invoke: jest.fn() } }));
jest.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'test' } }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(), notificationAsync: jest.fn(), ImpactFeedbackStyle: { Light: 'Light' }, NotificationFeedbackType: { Success: 'Success' }, selectionAsync: jest.fn() }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('expo-camera', () => ({ CameraView: 'CameraView', useCameraPermissions: () => [{ granted: true }, jest.fn()] }));
jest.mock('@gtaxi/shared', () => ({ AIGateway: { identifyProduct: jest.fn() } }));

describe('VisionScannerScreen', () => {
  it('renders without crashing', () => {
    const navigation = { navigate: jest.fn(), goBack: jest.fn() };
    const { getByText } = render(<VisionScannerScreen navigation={navigation as any} />);
    expect(getByText(/AI Vision Scanner/i)).toBeTruthy();
  });
});
