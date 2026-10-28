import { describe, it, expect } from 'vitest';
import { auditLabel, STATUS_TEXT } from '../BusinessPayouts';

describe('business payouts admin', () => {
    it('tells admin exactly what to do at each step', () => {
        expect(STATUS_TEXT.requested).toMatch(/G Approvals/);
        expect(STATUS_TEXT.approved).toMatch(/send the bank transfer, then mark paid/);
    });
    it('turns audit rows into plain words, money in TT$', () => {
        expect(auditLabel({ action: 'rate_added', detail: { rate_cents: 125000, from: '2026-10-26', to: '2026-11-24' } }))
            .toBe('Rate added: TT$1,250.00 a night, 2026-10-26 to 2026-11-24');
        expect(auditLabel({ action: 'payout_paid', detail: { total_cents: 105000, reference: 'RBL-1' } })).toBe('Payout paid: TT$1,050.00 (ref RBL-1)');
        expect(auditLabel({ action: 'bank_details_set', detail: { bank: 'Republic Bank', last4: '6789' } })).toBe('Bank details saved (Republic Bank, ending 6789)');
        expect(auditLabel({ action: 'something_new', detail: {} })).toBe('something new');
    });
});
