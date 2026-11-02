import type { GPalette } from '@gtaxi/design-system-native/src/gPresence';

const core = ['#B7A9FF', '#7A5CFF', '#3FD9E8'];

export const G_PALETTE: Record<'day' | 'night', GPalette> = {
    night: {
        page: ['#1B1140', '#0F0A24', '#07060F'], ring: '#9D8CFF', core, coreLip: '#3F2FB0', onCore: '#FFFFFF',
        ink: '#FFFFFF', dim: 'rgba(255,255,255,0.72)', field: 'rgba(255,255,255,0.08)', fieldLine: 'rgba(255,255,255,0.18)',
    },
    day: {
        page: ['#FFFFFF', '#F2EEFF', '#E6F8FB'], ring: '#7A5CFF', core, coreLip: '#3F2FB0', onCore: '#FFFFFF',
        ink: '#21152E', dim: 'rgba(33,21,46,0.68)', field: '#FFFFFF', fieldLine: 'rgba(33,21,46,0.14)',
    },
};

// Where G's screen names go in this app.
export const G_SCREENS: Record<string, string> = {
    wallet: 'Wallet', trips: 'Trips', grocery: 'GroceryStorefront', food: 'FoodDelivery', laundry: 'LaundryLanding',
    escape: 'EscapeStorefront', saved_places: 'SavedPlaces', referrals: 'Referral', help: 'Help',
};
