import React from 'react';
import { render } from '@testing-library/react-native';
import { ChatScreen } from '../ChatScreen';

jest.mock('@gtaxi/core', () => ({ supabase: { channel: () => ({ on: () => ({ subscribe: jest.fn() }) }), from: () => ({ select: () => ({ eq: () => ({ order: () => ({ data: null }) }) }), insert: jest.fn() }) } }));
jest.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'test' } }) }));

describe('ChatScreen', () => {
  it('renders without crashing', () => {
    const navigation = { navigate: jest.fn(), goBack: jest.fn() };
    const route = { params: { rideId: 'test', rider: { name: 'Rider' } } };
    const { getByPlaceholderText } = render(<ChatScreen navigation={navigation as any} route={route as any} />);
    expect(getByPlaceholderText(/TRANSMIT TO RIDER/i)).toBeTruthy();
  });
});
