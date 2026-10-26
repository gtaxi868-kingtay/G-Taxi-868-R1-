import { describe, it, expect } from 'vitest';
import { rateStatus, suggestionNeedsTTD, todayTT, type LodgingRow } from '../MerchantRooms';

const NOW = Date.parse('2026-10-26T12:00:00Z');
const row = (over: Partial<LodgingRow> = {}): LodgingRow => ({
    id: 'h1', name: 'Beach House', destination_code: 'TAB', location_zone: 'Crown Point',
    min_guests: 2, max_guests: 6, nights: 3, is_active: true,
    quoted_rate_per_night_cents: 120000, quoted_at: '2026-10-20T00:00:00Z',
    quote_expires_at: '2026-11-25T12:00:00Z', rate_set_by_hotel: true, ...over,
});

describe('rateStatus', () => {
    it('shows days left on the rate covering today', () => {
        expect(rateStatus(row(), NOW)).toEqual({ label: 'Live for 30 days', tone: 'live' });
    });
    it('warns when G is about to stop using the rate (3 days or less)', () => {
        expect(rateStatus(row({ quote_expires_at: '2026-10-28T12:00:00Z' }), NOW)).toEqual({ label: 'Expires in 2 days', tone: 'soon' });
        expect(rateStatus(row({ quote_expires_at: '2026-10-27T11:00:00Z' }), NOW).label).toBe('Expires in 1 day');
    });
    it('says plainly when there is no usable rate today', () => {
        expect(rateStatus(row({ quoted_rate_per_night_cents: null }), NOW).label).toBe('No rate today');
        expect(rateStatus(row({ quote_expires_at: '2026-10-01T00:00:00Z' }), NOW).label).toBe('Rate expired');
    });
});

describe('suggestions', () => {
    it('a TT$ price can be accepted as is; anything else needs the hotel to type TT$', () => {
        expect(suggestionNeedsTTD({ id: 's', source: 'website', rate_cents: 125000, currency: 'TTD', amount_text: 'TT$1,250', excerpt: null })).toBe(false);
        expect(suggestionNeedsTTD({ id: 's', source: 'website', rate_cents: 18500, currency: 'USD', amount_text: 'US$185', excerpt: null })).toBe(true);
        expect(suggestionNeedsTTD({ id: 's', source: 'website', rate_cents: 65000, currency: null, amount_text: '$650', excerpt: null })).toBe(true);
    });
    it('"today" is the Trinidad date, not the UTC one', () => {
        // 02:00 UTC on 27 Oct is still 26 Oct (22:00) in Trinidad.
        expect(todayTT(Date.parse('2026-10-27T02:00:00Z'))).toBe('2026-10-26');
        expect(todayTT(Date.parse('2026-10-27T05:00:00Z'))).toBe('2026-10-27');
    });
});
