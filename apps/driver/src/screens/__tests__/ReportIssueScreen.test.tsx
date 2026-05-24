import React from 'react';
import { render } from '@testing-library/react-native';
import { ReportIssueScreen } from '../ReportIssueScreen';

jest.mock('@gtaxi/core', () => ({ initializeSupabaseClient: () => ({ supabase: { channel: () => ({ on: () => ({ subscribe: jest.fn() }) }), from: () => ({ insert: jest.fn() }), auth: { getSession: jest.fn() } } }) }));

describe('ReportIssueScreen', () => {
  it('renders without crashing', () => {
    const navigation = { navigate: jest.fn(), goBack: jest.fn() };
    const { getByText } = render(<ReportIssueScreen navigation={navigation as any} />);
    expect(getByText(/Report Issue/i)).toBeTruthy();
  });
});
