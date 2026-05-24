import React from 'react';
import { render } from '@testing-library/react-native';
import { ActiveRideRestorationHandler } from '../../components/ActiveRideRestorationHandler';

jest.mock('@gtaxi/core', () => ({ supabase: { channel: () => ({ on: () => ({ subscribe: jest.fn() }) }), from: () => ({ select: () => ({ eq: () => ({ single: jest.fn(), maybeSingle: jest.fn(), order: () => ({ limit: () => ({ data: null }) }) }) }) }) } }));
jest.mock('../../context/RideContext', () => ({ useRide: () => ({ activeRide: null, loading: true, checkActiveRide: jest.fn() }) }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn(), reset: jest.fn(), getState: jest.fn() }) }));

describe('ActiveRideRestorationHandler', () => {
  it('renders null without crashing', () => {
    const { toJSON } = render(<ActiveRideRestorationHandler />);
    expect(toJSON()).toBeNull();
  });
});
