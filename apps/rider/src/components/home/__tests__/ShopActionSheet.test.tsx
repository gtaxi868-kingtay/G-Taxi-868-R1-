import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { ShopActionSheet } from '../ShopActionSheet';

const mockToast = jest.fn();
jest.mock('../../Toast', () => ({ toast: (...a: any[]) => mockToast(...a) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn(), impactAsync: jest.fn(), ImpactFeedbackStyle: {} }));

const SHOP = { id: 'm1', name: 'Corner Shop', lat: 10.6, lng: -61.5, distance_m: 640, is_featured: false, is_open: true, store_type: 'grocery' };

describe('ShopActionSheet', () => {
    it('offers all four actions the founder chose', () => {
        const { getByLabelText } = render(<ShopActionSheet shop={SHOP} onClose={jest.fn()} onAction={jest.fn()} />);
        for (const label of ['Ride there', 'Stop on my way', 'Driver grabs it', 'Deliver to me']) expect(getByLabelText(label)).toBeTruthy();
    });

    it('ride, stop and deliver close the card and run the action for this shop', () => {
        for (const [label, action] of [['Ride there', 'ride'], ['Stop on my way', 'stop'], ['Deliver to me', 'deliver']] as const) {
            const onAction = jest.fn(); const onClose = jest.fn();
            const { getByLabelText, unmount } = render(<ShopActionSheet shop={SHOP} onClose={onClose} onAction={onAction} />);
            fireEvent.press(getByLabelText(label));
            expect(onClose).toHaveBeenCalled();
            expect(onAction).toHaveBeenCalledWith(action, SHOP);
            unmount();
        }
    });

    it('"Driver grabs it" is not live yet: it explains, it does not start an order', () => {
        const onAction = jest.fn();
        const { getByLabelText } = render(<ShopActionSheet shop={SHOP} onClose={jest.fn()} onAction={onAction} />);
        fireEvent.press(getByLabelText('Driver grabs it'));
        expect(onAction).not.toHaveBeenCalled();
        expect(mockToast).toHaveBeenCalledWith(expect.stringMatching(/coming soon/i));
    });

    it('renders nothing without a shop', () => {
        const { toJSON } = render(<ShopActionSheet shop={null} onClose={jest.fn()} onAction={jest.fn()} />);
        expect(toJSON()).toBeNull();
    });
});
