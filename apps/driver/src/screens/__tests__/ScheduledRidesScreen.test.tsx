import React from 'react';
import { render } from '@testing-library/react-native';
import { ScheduledRidesScreen } from '../ScheduledRidesScreen';

jest.mock('@gtaxi/core', () => ({ supabase: { channel: () => ({ on: () => ({ subscribe: jest.fn() }) }), from: () => ({ select: () => ({ eq: () => ({ order: () => ({ limit: () => ({ data: null }) }) }) }) }) } }));

describe('ScheduledRidesScreen', () => {
  it('renders without crashing', () => {
    const navigation = { navigate: jest.fn(), goBack: jest.fn() };
    const { getByText } = render(<ScheduledRidesScreen navigation={navigation as any} />);
    expect(getByText(/Scheduled/i)).toBeTruthy();
  });
});
