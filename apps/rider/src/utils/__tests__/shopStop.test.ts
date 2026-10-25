import { stopFromParam } from '../shopStop';

describe('stopFromParam', () => {
    it('turns a shop picked on Home into the stop shape create_ride already accepts', () => {
        expect(stopFromParam({ name: 'Chaud Café', latitude: 10.65, longitude: -61.5, address: '1 Queen St', merchantId: 'm1', storeType: 'restaurant' }))
            .toEqual({
                place_name: 'Chaud Café', place_address: '1 Queen St', lat: 10.65, lng: -61.5,
                stop_type: 'merchant', emoji: '🛍️', estimated_wait_minutes: 5, is_preferred: true,
                is_network_partner: true, merchant_id: 'm1',
            });
    });

    it('keeps the special stop pricing for groceries and pharmacies', () => {
        expect(stopFromParam({ name: 'Hi-Lo', latitude: 1, longitude: 2, storeType: 'grocery' })?.stop_type).toBe('grocery');
        expect(stopFromParam({ name: 'Rx', latitude: 1, longitude: 2, storeType: 'pharmacy' })?.stop_type).toBe('pharmacy');
    });

    it('falls back to the name when there is no address, and ignores bad input', () => {
        expect(stopFromParam({ name: 'Shop', latitude: 1, longitude: 2 })?.place_address).toBe('Shop');
        expect(stopFromParam(undefined)).toBeNull();
        expect(stopFromParam({ name: 'X', latitude: NaN, longitude: 2 })).toBeNull();
    });
});
