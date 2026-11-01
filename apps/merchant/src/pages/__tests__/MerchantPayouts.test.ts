import { describe, it, expect } from 'vitest';
import { payoutSummary } from '../MerchantPayouts';

const base = { owed_room_cents: 0, owed_lobby_cents: 0, payouts: [] as any[], has_bank_details: true };

describe('payoutSummary', () => {
    it('explains when there is nothing yet, in plain words', () => {
        expect(payoutSummary(base)).toMatchObject({ canRequest: false });
        expect(payoutSummary(base).text).toMatch(/after a guest checks out/);
    });
    it('asks for bank details before allowing a request', () => {
        expect(payoutSummary({ ...base, owed_room_cents: 100000, has_bank_details: false }))
            .toEqual({ canRequest: false, text: 'You have TT$1,000.00 to collect. Add your bank details below to request it.' });
    });
    it('allows one request at a time', () => {
        expect(payoutSummary({ ...base, owed_lobby_cents: 5000 })).toEqual({ canRequest: true, text: 'You have TT$50.00 to collect.' });
        expect(payoutSummary({ ...base, owed_lobby_cents: 5000, payouts: [{ status: 'requested', total_cents: 105000 }] as any }).canRequest).toBe(false);
    });
});
