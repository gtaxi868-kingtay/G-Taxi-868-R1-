// A stop the rider chose before booking (a shop from the Home map, or one of
// G's "add a stop on the way" suggestions), in the exact shape
// RideConfirmation already sends to create_ride. No server change: create_ride
// validates count and wait only, ride_stops has no stop_type constraint, and
// _shared/pricing.ts prices 'grocery' / 'pharmacy' stops specially and every
// other type at the default stop rate.
export type StopParam = {
    name: string;
    latitude: number;
    longitude: number;
    address?: string;
    merchantId?: string;
    storeType?: string;
};

export type StopSuggestion = {
    place_name: string;
    place_address: string;
    lat: number;
    lng: number;
    stop_type: string;
    emoji: string;
    estimated_wait_minutes: number;
    is_preferred: boolean;
    is_network_partner?: boolean;
    merchant_id?: string;
};

export function stopFromParam(p: StopParam | null | undefined): StopSuggestion | null {
    if (!p || !p.name || !Number.isFinite(p.latitude) || !Number.isFinite(p.longitude)) return null;
    const type = p.storeType === 'grocery' || p.storeType === 'pharmacy' ? p.storeType : 'merchant';
    const s: StopSuggestion = {
        place_name: p.name,
        place_address: p.address || p.name,
        lat: p.latitude,
        lng: p.longitude,
        stop_type: type,
        emoji: '🛍️',
        estimated_wait_minutes: 5,
        is_preferred: true,
    };
    if (p.merchantId) { s.is_network_partner = true; s.merchant_id = p.merchantId; }
    return s;
}
