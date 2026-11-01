import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { PendingApprovalScreen, areaLine } from '../PendingApprovalScreen';

const mockRpc = jest.fn();
jest.mock('@gtaxi/core', () => ({ supabase: { rpc: (...a: unknown[]) => mockRpc(...a) } }));
jest.mock('../../context/AuthContext', () => ({ useAuth: () => ({ signOut: jest.fn() }) }));

describe('PendingApprovalScreen', () => {
  beforeEach(() => mockRpc.mockReset());

  it('renders without crashing', async () => {
    mockRpc.mockResolvedValue({ data: null, error: new Error('offline') });
    const { getByText, queryByText } = render(<PendingApprovalScreen />);
    expect(getByText(/OPERATOR APPROVAL PENDING/i)).toBeTruthy();
    await waitFor(() => expect(mockRpc).toHaveBeenCalledWith('driver_area_signups'));
    expect(queryByText(/joined/)).toBeNull();
  });

  it('shows who has joined near the driver', async () => {
    mockRpc.mockResolvedValue({ data: { town: 'Penal', riders: 12, shops: 3, radius_km: 15 }, error: null });
    const { findByText } = render(<PendingApprovalScreen />);
    expect(await findByText('12 riders and 3 shops have joined within 15 km of Penal.')).toBeTruthy();
  });

  it('stays hidden when nobody has joined yet', async () => {
    mockRpc.mockResolvedValue({ data: { town: 'Penal', riders: 0, shops: 0, radius_km: 15 }, error: null });
    const { queryByText } = render(<PendingApprovalScreen />);
    await waitFor(() => expect(mockRpc).toHaveBeenCalled());
    expect(queryByText(/joined/)).toBeNull();
  });

  it('reads right for one person', () => {
    expect(areaLine({ town: null, riders: 1, shops: 0, radius_km: 15 })).toBe('1 rider has joined near you.');
  });
});
