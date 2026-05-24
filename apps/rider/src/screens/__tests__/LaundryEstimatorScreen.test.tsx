import React from 'react';
import { render } from '@testing-library/react-native';
import { LaundryEstimatorScreen } from '../LaundryEstimatorScreen';

jest.mock('@gtaxi/core', () => ({ supabase: { channel: () => ({ on: () => ({ subscribe: jest.fn() }) }), from: () => ({ select: () => ({ eq: () => ({ single: jest.fn(), maybeSingle: jest.fn(), order: () => ({ limit: () => ({ data: null }) }) }) }) }) } }));
jest.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'test' } }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(), notificationAsync: jest.fn(), ImpactFeedbackStyle: { Light: 'Light' }, NotificationFeedbackType: { Success: 'Success' }, selectionAsync: jest.fn() }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('@react-native-community/slider', () => 'Slider');

describe('LaundryEstimatorScreen', () => {
  it('renders without crashing', () => {
    const navigation = { navigate: jest.fn(), goBack: jest.fn() };
    const route = { params: { service: { id: 'wash_fold', label: 'Wash & Fold', icon: '🫧', baseRate: 500 }, merchant: { id: 'test-merchant', name: 'Test Laundry' } } };
    const { getByText } = render(<LaundryEstimatorScreen navigation={navigation as any} route={route as any} />);
    expect(getByText(/Wash & Fold/i)).toBeTruthy();
  });
});
