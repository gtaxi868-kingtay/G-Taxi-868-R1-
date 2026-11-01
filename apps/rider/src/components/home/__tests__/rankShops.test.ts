import { attachOffers, rankShops, type MapShop } from '../rankShops';

const shop = (id: string, km: number, featured = false, extra: Partial<MapShop> = {}): MapShop => ({
    id, name: id, lat: 10.6, lng: -61.5, distance_m: km * 1000, is_featured: featured, is_open: true, store_type: 'restaurant', ...extra,
});

describe('rankShops (founder: "mix, paid boosted")', () => {
    it('with no paid shops, nearest first', () => {
        expect(rankShops([shop('far', 5), shop('near', 0.3), shop('mid', 2)]).map(s => s.id)).toEqual(['near', 'mid', 'far']);
    });

    it('a paid shop is boosted ahead of a free shop that is a bit closer', () => {
        expect(rankShops([shop('free', 1.5), shop('paid', 2.5, true)]).map(s => s.id)).toEqual(['paid', 'free']);
    });

    it('but a paid shop far away does not bury a shop right next to the rider', () => {
        expect(rankShops([shop('paid-far', 9, true), shop('free-next-door', 0.2)]).map(s => s.id)).toEqual(['free-next-door', 'paid-far']);
    });

    it('drops shops too far to be "near you" and shops with no location', () => {
        const out = rankShops([shop('ok', 3), shop('too-far', 14), shop('no-loc', 1, false, { lat: null as any })]);
        expect(out.map(s => s.id)).toEqual(['ok']);
    });

    it('is stable and does not mutate its input', () => {
        const input = [shop('a', 2), shop('b', 1)];
        const copy = JSON.stringify(input);
        rankShops(input);
        expect(JSON.stringify(input)).toBe(copy);
    });
});

describe('attachOffers', () => {
    const offer = { merchant_id: 'a', headline: 'Deal', offer_text: null, image_url: null, accent_color: '#8B5CF6' };
    const shop = (id: string) => ({ id, name: id, lat: 10.6, lng: -61.5, distance_m: 100, is_featured: false, is_open: true, store_type: 'grocery' });

    it('puts each offer on its own shop only', () => {
        const [a, b] = attachOffers([shop('a'), shop('b')], [offer]);
        expect(a.offer).toEqual(offer);
        expect(b.offer).toBeNull();
    });
});
