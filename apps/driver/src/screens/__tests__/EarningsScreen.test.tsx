import React from 'react';
import { render } from '@testing-library/react-native';
import { EarningsScreen } from '../EarningsScreen';

jest.mock('@gtaxi/core', () => ({ supabase: { channel: () => ({ on: () => ({ subscribe: jest.fn() }) }), from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: () => ({ data: null }) }) }) }) }) }), removeChannel: jest.fn() } }));
jest.mock('../../context/AuthContext', () => ({ useAuth: () => ({ driver: { id: 'test' } }) }));

describe('EarningsScreen', () => {
  it('renders without crashing', async () => {
    const navigation = { navigate: jest.fn(), goBack: jest.fn() };
    const { findByText } = render(<EarningsScreen navigation={navigation as any} />);
    expect(await findByText(/Partner Hub/i)).toBeTruthy();
  });
});
