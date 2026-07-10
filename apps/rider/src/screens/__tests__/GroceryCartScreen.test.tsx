import React from 'react';
import { render } from '@testing-library/react-native';
import { GroceryCartScreen } from '../GroceryCartScreen';

jest.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'test' } }) }));

describe('GroceryCartScreen', () => {
  it('renders without crashing', () => {
    const navigation = { navigate: jest.fn(), goBack: jest.fn() };
    const route = { params: { merchant: { id: 'test-merchant', name: 'Test Store' }, cart: [] } };
    const { getByText } = render(<GroceryCartScreen navigation={navigation as any} route={route as any} />);
    expect(getByText('Your Cart')).toBeTruthy();
  });
});
