import React from 'react';
import { render } from '@testing-library/react-native';
import { LaundryOrderStatusScreen } from '../LaundryOrderStatusScreen';

jest.mock('@gtaxi/core', () => ({ supabase: { channel: () => ({ on: () => ({ subscribe: jest.fn() }) }), from: () => ({ select: () => ({ eq: () => ({ single: jest.fn(), maybeSingle: jest.fn(), order: () => ({ limit: () => ({ data: null }) }) }) }) }) } }));
jest.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'test' } }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(), notificationAsync: jest.fn(), ImpactFeedbackStyle: { Light: 'Light' }, NotificationFeedbackType: { Success: 'Success' }, selectionAsync: jest.fn() }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('@/design-system/primitives', () => ({ Txt: 'Txt' }));

describe('LaundryOrderStatusScreen', () => {
  it('renders without crashing', () => {
    const navigation = { navigate: jest.fn(), goBack: jest.fn() };
    const route = { params: { orderId: 'test-order-123', service: { label: 'Wash & Fold' }, weight: 5, priceCents: 2500 } };
    const { getByText } = render(<LaundryOrderStatusScreen navigation={navigation as any} route={route as any} />);
    expect(getByText(/Order Status/i)).toBeTruthy();
  });
});
