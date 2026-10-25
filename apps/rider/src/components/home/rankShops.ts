// Order of the shop cards on the Home map. Founder decision 2026-10-24:
// "mix, paid boosted" — every nearby shop shows, paid ones move up.
//
// "Paid" here is `is_featured` from g_rank_merchants: the shop has an active
// merchant_promotions row. That is the only paid signal a rider is allowed to
// read (merchant_subscriptions is admin-only under RLS). Today 0 rows exist, so
// every shop ranks by distance alone.
//
// The boost counts a paid shop as half as far away. Putting paid shops first
// outright was rejected: a paid shop 19 km away would then sit ahead of one
// 200 m from the rider, and the cards would stop meaning "near you".
export type MapShop = {
    id: string;
    name: string;
    lat: number;
    lng: number;
    distance_m: number;
    is_featured: boolean;
    is_open: boolean;
    store_type: string;
    category?: string;
    address?: string;
    cover_image_url?: string | null;
    avg_delivery_minutes?: number;
    delivery_fee_cents?: number;
    is_usual?: boolean;
};

const MAX_KM = 10;            // beyond this a shop is not "near you"
const PAID_DISTANCE_FACTOR = 0.5;

export function rankShops(shops: MapShop[]): MapShop[] {
    return shops
        .filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lng) && s.lat !== null && s.lng !== null)
        .filter(s => (s.distance_m ?? Infinity) <= MAX_KM * 1000)
        .map((s, i) => ({ s, i, key: (s.distance_m ?? 0) * (s.is_featured ? PAID_DISTANCE_FACTOR : 1) }))
        .sort((a, b) => a.key - b.key || a.i - b.i)
        .map(x => x.s);
}
