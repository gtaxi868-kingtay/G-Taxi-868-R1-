import { describe, it, expect } from 'vitest';
import { rateStatus, type LodgingRow } from '../MerchantRooms';

const NOW = Date.parse('2026-10-26T12:00:00Z');
const row = (over: Partial<LodgingRow> = {}): LodgingRow => ({
    id: 'h1', name: 'Beach House', destination_code: 'TAB', location_zone: 'Crown Point',
    min_guests: 2, max_guests: 6, nights: 3, is_active: true,
    quoted_rate_per_night_cents: 120000, quoted_at: '2026-10-20T00:00:00Z',
    quote_expires_at: '2026-11-25T12:00:00Z', rate_set_by_hotel: true, ...over,
});

describe('rateStatus', () => {
    it('shows days left on a live rate', () => {
        expect(rateStatus(row(), NOW)).toEqual({ label: 'Live for 30 days', tone: 'live' });
    });
    it('warns when G is about to stop using the rate (3 days or less)', () => {
        expect(rateStatus(row({ quote_expires_at: '2026-10-28T12:00:00Z' }), NOW)).toEqual({ label: 'Expires in 2 days', tone: 'soon' });
        expect(rateStatus(row({ quote_expires_at: '2026-10-27T11:00:00Z' }), NOW).label).toBe('Expires in 1 day');
    });
    it('says plainly when there is no usable rate', () => {
        expect(rateStatus(row({ quoted_rate_per_night_cents: null }), NOW).label).toBe('No rate yet');
        expect(rateStatus(row({ quote_expires_at: '2026-10-01T00:00:00Z' }), NOW).label).toBe('Rate expired');
    });
});
