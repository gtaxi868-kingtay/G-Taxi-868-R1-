import React from 'react';
import { render } from '@testing-library/react-native';
import { EarningsScreen } from '../EarningsScreen';

jest.mock('@gtaxi/core', () => ({ supabase: { channel: () => ({ on: () => ({ subscribe: jest.fn() }) }), from: () => ({ select: () => ({ eq: () => ({ order: () => ({ limit: () => ({ data: null }) }) }) }) }), removeChannel: jest.fn() } }));
jest.mock('../../context/AuthContext', () => ({ useAuth: () => ({ driver: { id: 'test' } }) }));

describe('EarningsScreen', () => {
  it('renders without crashing', () => {
    const navigation = { navigate: jest.fn(), goBack: jest.fn() };
    const { getByText } = render(<EarningsScreen navigation={navigation as any} />);
    expect(getByText(/Partner Hub/i)).toBeTruthy();
  });
});
