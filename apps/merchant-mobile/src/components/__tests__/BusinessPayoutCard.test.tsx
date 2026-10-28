jest.mock('@gtaxi/core', () => ({ initializeSupabaseClient: () => ({ supabase: { rpc: jest.fn() } }) }));
jest.mock('@gtaxi/design-system', () => ({ VOICES: { merchant: { accent: '#007070' } } }));
import { payoutLine } from '../BusinessPayoutCard';

const base = { owed_room_cents: 0, owed_lobby_cents: 0, payouts: [] as any[], has_bank_details: true };
describe('payoutLine', () => {
    it('says plainly when there is nothing to collect', () => {
        expect(payoutLine(base)).toEqual({ canRequest: false, text: 'Nothing to collect yet.' });
    });
    it('needs bank details before a request', () => {
        expect(payoutLine({ ...base, owed_room_cents: 100000, has_bank_details: false }).canRequest).toBe(false);
    });
    it('one payout at a time', () => {
        expect(payoutLine({ ...base, owed_lobby_cents: 5000 }).canRequest).toBe(true);
        expect(payoutLine({ ...base, owed_lobby_cents: 5000, payouts: [{ id: 'p', status: 'approved', total_cents: 5000 }] }).text).toMatch(/on its way/);
    });
});
