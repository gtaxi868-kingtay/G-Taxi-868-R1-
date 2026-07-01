import React from 'react';
import { render } from '@testing-library/react-native';
import { ScheduledRidesScreen } from '../ScheduledRidesScreen';

// @gtaxi/core mocked completely in jest.setup.js (chainable builder)
jest.mock('../../context/AuthContext', () => ({ useAuth: () => ({ driver: { id: 'test-driver' } }) }));

describe('ScheduledRidesScreen', () => {
  it('renders without crashing', () => {
    const navigation = { navigate: jest.fn(), goBack: jest.fn() };
    const { getByText } = render(<ScheduledRidesScreen navigation={navigation as any} />);
    expect(getByText(/Scheduled/i)).toBeTruthy();
  });
});
