import React from 'react';
import { render } from '@testing-library/react-native';
import { ProfileScreen } from '../ProfileScreen';

jest.mock('@gtaxi/core', () => ({ supabase: { channel: () => ({ on: () => ({ subscribe: jest.fn() }) }), from: () => ({ select: () => ({ eq: () => ({ single: jest.fn(), maybeSingle: jest.fn(), order: () => ({ limit: () => ({ data: null }) }) }) }) }) } }));
jest.mock('../../context/AuthContext', () => ({ useAuth: () => ({ driver: { id: 'test', name: 'Test', rating: 5.0, verified_status: 'approved', vehicle_model: 'Sedan', plate_number: 'PDT 1234' }, user: { id: 'test' }, signOut: jest.fn() }) }));

describe('ProfileScreen', () => {
  it('renders without crashing', () => {
    const navigation = { navigate: jest.fn(), goBack: jest.fn() };
    const { getByText } = render(<ProfileScreen navigation={navigation as any} />);
    expect(getByText(/Operator Profile/i)).toBeTruthy();
  });
});
