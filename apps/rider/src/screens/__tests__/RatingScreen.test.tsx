import React from 'react';
import { render } from '@testing-library/react-native';
import { RatingScreen } from '../RatingScreen';

jest.mock('@gtaxi/core', () => ({ supabase: { channel: () => ({ on: () => ({ subscribe: jest.fn() }) }), from: () => ({ select: () => ({ eq: () => ({ single: jest.fn(), maybeSingle: jest.fn(), order: () => ({ limit: () => ({ data: null }) }) }) }) }) }, auth: { getUser: () => ({ data: { user: { id: 'test' } } }) } }));
jest.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'test' } }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(), notificationAsync: jest.fn(), ImpactFeedbackStyle: { Light: 'Light' }, NotificationFeedbackType: { Success: 'Success' }, selectionAsync: jest.fn() }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('@/design-system/primitives', () => ({ Txt: 'Txt' }));
jest.mock('../services/api', () => ({ processTip: jest.fn(), formatCurrency: jest.fn() }));

describe('RatingScreen', () => {
  it('renders without crashing', () => {
    const navigation = { navigate: jest.fn(), goBack: jest.fn() };
    const route = { params: { driver: { id: 'test-driver', name: 'Test Driver' }, fare: { total_fare_cents: 5000 }, rideId: 'test-ride', paymentMethod: 'cash' } };
    const { getByText } = render(<RatingScreen navigation={navigation as any} route={route as any} />);
    expect(getByText(/Test Driver/i)).toBeTruthy();
  });
});
