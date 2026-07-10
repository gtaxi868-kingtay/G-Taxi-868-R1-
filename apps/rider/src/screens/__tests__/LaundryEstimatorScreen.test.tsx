import React from 'react';
import { render } from '@testing-library/react-native';
import { LaundryEstimatorScreen } from '../LaundryEstimatorScreen';

jest.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'test' } }) }));
jest.mock('@react-native-community/slider', () => 'Slider');

describe('LaundryEstimatorScreen', () => {
  it('renders without crashing', () => {
    const navigation = { navigate: jest.fn(), goBack: jest.fn() };
    const route = { params: { service: { id: 'wash_fold', label: 'Wash & Fold', icon: '🫧', baseRate: 500 }, merchant: { id: 'test-merchant', name: 'Test Laundry' } } };
    const { getByText } = render(<LaundryEstimatorScreen navigation={navigation as any} route={route as any} />);
    expect(getByText(/Wash & Fold/i)).toBeTruthy();
  });
});
