import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockRpc = jest.fn();
jest.mock('@gtaxi/core', () => ({ initializeSupabaseClient: () => ({ supabase: { rpc: (...a: any[]) => mockRpc(...a) } }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(() => Promise.resolve()), notificationAsync: jest.fn(() => Promise.resolve()), ImpactFeedbackStyle: { Medium: 'Medium' }, NotificationFeedbackType: { Success: 'Success' } }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('@gtaxi/design-system', () => ({ SURFACE: { base: '#141122' }, VOICES: { merchant: { accent: '#007070', textMuted: 'rgba(174,169,181,0.65)' } } }));
jest.mock('@gtaxi/design-system/utils/style-rules', () => ({ glassSurface: () => ({}), ghostBorder: () => ({}) }));

import { PropertyManagementScreen, rateStatus } from '../PropertyManagementScreen';

const HOTEL = {
    id: 'h1', name: 'St Lawrence Beach House', location_zone: 'Crown Point', max_guests: 6, nights: 3,
    quoted_rate_per_night_cents: null, quote_expires_at: null, rate_set_by_hotel: false,
};

describe('PropertyManagementScreen (rooms & rates)', () => {
    beforeEach(() => mockRpc.mockReset());

    it('lists the hotel from its own G-Escape record and saves a rate in cents', async () => {
        mockRpc.mockImplementation((name: string) => Promise.resolve(
            name === 'merchant_my_lodging' ? { data: [HOTEL], error: null } : { data: { success: true }, error: null },
        ));
        const { findByText, getByLabelText, getByText } = render(<PropertyManagementScreen navigation={{ goBack: jest.fn() }} />);
        expect(await findByText('St Lawrence Beach House')).toBeTruthy();
        expect(getByText('No rate today')).toBeTruthy();
        fireEvent.changeText(getByLabelText('New nightly rate for St Lawrence Beach House'), '1,200.50');
        fireEvent.press(getByText('Save rate'));
        await waitFor(() => expect(mockRpc).toHaveBeenCalledWith('merchant_set_lodging_rate', { p_lodging_id: 'h1', p_rate_cents: 120050, p_valid_days: 30 }));
    }, 20000);

    it('shows the server refusal in plain words', async () => {
        mockRpc.mockImplementation((name: string) => Promise.resolve(
            name === 'merchant_my_lodging' ? { data: [HOTEL], error: null }
                : { data: { success: false, error: 'Enter a nightly rate between TT$50 and TT$100,000.' }, error: null },
        ));
        const { findByText, getByLabelText, getByText } = render(<PropertyManagementScreen navigation={{ goBack: jest.fn() }} />);
        await findByText('St Lawrence Beach House');
        fireEvent.changeText(getByLabelText('New nightly rate for St Lawrence Beach House'), '5');
        fireEvent.press(getByText('Save rate'));
        expect(await findByText('Enter a nightly rate between TT$50 and TT$100,000.')).toBeTruthy();
    });

    it('explains how to get connected when no hotel is on the account', async () => {
        mockRpc.mockResolvedValue({ data: [], error: null });
        const { findByText } = render(<PropertyManagementScreen navigation={{ goBack: jest.fn() }} />);
        expect(await findByText(/ask G868 for your claim link/i)).toBeTruthy();
    });

    it('rateStatus counts days left', () => {
        const now = Date.parse('2026-10-26T12:00:00Z');
        expect(rateStatus({ ...HOTEL, quoted_rate_per_night_cents: 100000, quote_expires_at: '2026-11-25T12:00:00Z' }, now).label).toBe('Live for 30 days');
        expect(rateStatus({ ...HOTEL, quoted_rate_per_night_cents: 100000, quote_expires_at: '2026-10-01T00:00:00Z' }, now).label).toBe('Rate expired');
    });
});
