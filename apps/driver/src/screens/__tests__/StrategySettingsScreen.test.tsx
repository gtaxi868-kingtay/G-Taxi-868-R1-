import React from 'react';
import { render } from '@testing-library/react-native';
import { StrategySettingsScreen } from '../StrategySettingsScreen';

jest.mock('@gtaxi/core', () => ({ supabase: { channel: () => ({ on: () => ({ subscribe: jest.fn() }) }), from: () => ({ select: () => ({ eq: () => ({ single: jest.fn() }) }), upsert: jest.fn() }) } }));
jest.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'test' } }) }));

describe('StrategySettingsScreen', () => {
  it('renders without crashing', () => {
    const navigation = { navigate: jest.fn(), goBack: jest.fn() };
    const { getByText } = render(<StrategySettingsScreen navigation={navigation as any} />);
    expect(getByText(/AI strategy/i)).toBeTruthy();
  });
});
