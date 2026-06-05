import React from 'react';
import { render } from '@testing-library/react-native';
import { StrategySettingsScreen } from '../StrategySettingsScreen';

jest.mock('@gtaxi/core', () => ({ supabase: { channel: () => ({ on: () => ({ subscribe: jest.fn() }) }), from: () => ({ select: () => ({ eq: () => ({ single: jest.fn(() => Promise.resolve({ data: null })) }) }), upsert: jest.fn() }) } }));
jest.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'test' } }) }));

describe('StrategySettingsScreen', () => {
  it('renders without crashing', async () => {
    const navigation = { navigate: jest.fn(), goBack: jest.fn() };
    const { findByText } = render(<StrategySettingsScreen navigation={navigation as any} />);
    const el = await findByText(/AI strategy/i, {}, { timeout: 30000 });
    expect(el).toBeTruthy();
  }, 60000);
});
