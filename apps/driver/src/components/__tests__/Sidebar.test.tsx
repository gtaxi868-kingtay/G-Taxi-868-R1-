import React from 'react';
import { render } from '@testing-library/react-native';
import { Sidebar } from '../Sidebar';

jest.mock('@gtaxi/core', () => ({ supabase: { channel: () => ({ on: () => ({ subscribe: jest.fn() }) }), from: () => ({ select: () => ({ eq: () => ({ order: () => ({ data: null }) }) }) }), auth: { signOut: jest.fn() } } }));

describe('Sidebar', () => {
  it('renders without crashing', () => {
    const navigation = { navigate: jest.fn() };
    const onClose = jest.fn();
    const { getByText } = render(<Sidebar visible={true} onClose={onClose} navigation={navigation as any} user={{ name: 'Test', rating: 5.0 }} />);
    expect(getByText(/WALLET/i)).toBeTruthy();
  });
});
