import { describe, expect, it } from 'vitest';
import { monthLabel } from '../LaneDemand';

describe('monthLabel', () => {
    it('keeps the month whatever the time zone', () => {
        expect(monthLabel('2027-03-01')).toContain('March');
        expect(monthLabel('2027-03-01')).toContain('2027');
    });
});
