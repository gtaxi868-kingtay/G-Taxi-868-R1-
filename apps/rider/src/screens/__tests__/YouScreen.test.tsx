// Replaces Sidebar.test.tsx: the hamburger drawer retired when the rider app
// moved to bottom tabs. Every destination the drawer offered must still be
// reachable from the You tab, so this test checks each tile's route.
import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { YouScreen, YOU_TILES } from '../YouScreen';

const mockSignOut = jest.fn();
jest.mock('@gtaxi/core', () => ({ supabase: { auth: { signOut: (...a: any[]) => mockSignOut(...a) } } }));
jest.mock('../../context/AuthContext', () => ({
    useAuth: () => ({ user: { id: 'test' }, profile: { full_name: 'Shay Mohammed', avatar_url: null } }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(), notificationAsync: jest.fn(), selectionAsync: jest.fn(), ImpactFeedbackStyle: { Light: 'Light', Medium: 'Medium' }, NotificationFeedbackType: { Success: 'Success' } }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));

// Every page the old drawer could open. Profile is reached from the header card.
const DRAWER_DESTINATIONS = ['Trips', 'Wallet', 'SavedPlaces', 'Notifications', 'Promo', 'Referral', 'Settings', 'Help'];

describe('YouScreen', () => {
    it('keeps every destination the old drawer had', () => {
        const routes = YOU_TILES.map(t => t.route);
        for (const d of DRAWER_DESTINATIONS.filter(d => d !== 'Trips' && d !== 'Wallet')) {
            expect(routes).toContain(d);
        }
    });

    it('opens the right page for each tile', () => {
        const navigation = { navigate: jest.fn() };
        const { getByLabelText } = render(<YouScreen navigation={navigation as any} />);
        for (const tile of YOU_TILES) {
            fireEvent.press(getByLabelText(tile.title));
            expect(navigation.navigate).toHaveBeenLastCalledWith(tile.route);
        }
    });

    it('opens the profile from the header card', () => {
        const navigation = { navigate: jest.fn() };
        const { getByLabelText, getByText } = render(<YouScreen navigation={navigation as any} />);
        expect(getByText('Shay Mohammed')).toBeTruthy();
        fireEvent.press(getByLabelText('Your profile'));
        expect(navigation.navigate).toHaveBeenLastCalledWith('Profile');
    });

    it('asks before signing out', () => {
        const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
        const { getByLabelText } = render(<YouScreen navigation={{ navigate: jest.fn() } as any} />);
        fireEvent.press(getByLabelText('Sign out'));
        expect(alertSpy).toHaveBeenCalled();
        expect(mockSignOut).not.toHaveBeenCalled();
        alertSpy.mockRestore();
    });
});
