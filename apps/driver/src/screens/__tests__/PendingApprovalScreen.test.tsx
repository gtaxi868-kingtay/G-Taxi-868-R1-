import React from 'react';
import { render } from '@testing-library/react-native';
import { PendingApprovalScreen } from '../PendingApprovalScreen';

jest.mock('../../context/AuthContext', () => ({ useAuth: () => ({ signOut: jest.fn() }) }));

describe('PendingApprovalScreen', () => {
  it('renders without crashing', () => {
    const { getByText } = render(<PendingApprovalScreen />);
    expect(getByText(/OPERATOR APPROVAL PENDING/i)).toBeTruthy();
  });
});
