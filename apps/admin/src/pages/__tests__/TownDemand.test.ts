import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabase', () => ({ supabase: {} }));

import { buildTownDemand, draftMessage, kmBetween, whatsAppNumber, type WaitlistEntry } from '../TownDemand';

const entry = (over: Partial<WaitlistEntry>): WaitlistEntry => ({
    id: Math.random().toString(), full_name: 'Test Person', phone: '868 712 3456', user_type: 'ride',
    status: 'pending', community: null, source: 'g868:Rider', details: null, ...over,
});
const marabella = { area: 'San Fernando', town_lat: 10.307, town_lng: -61.452 };
const penal = { area: 'Princes Town / Debe', town_lat: 10.168, town_lng: -61.453 };
const arima = { area: 'Arima', town_lat: 10.637, town_lng: -61.283 };
const driver = (name: string, community: string, details: WaitlistEntry['details']) =>
    entry({ full_name: name, community, details, user_type: 'drive', source: 'g868:Driver' });

describe('buildTownDemand', () => {
    it('counts each town and lists the closest drivers first', () => {
        const { towns } = buildTownDemand([
            entry({ community: 'Marabella', details: marabella }),
            entry({ community: 'Marabella', details: marabella }),
            entry({ community: 'Marabella', details: marabella, user_type: 'sell', source: 'g868:G-Partner (merchant)' }),
            driver('Far Driver', 'Arima', arima),
            driver('Near Driver', 'Penal', penal),
        ]);
        expect(towns).toHaveLength(1);
        expect(towns[0]).toMatchObject({ town: 'Marabella', riders: 2, shops: 1, approximate: false });
        expect(towns[0].drivers.map((d) => d.name)).toEqual(['Near Driver', 'Far Driver']);
        expect(Math.round(towns[0].drivers[0].km)).toBe(15);
    });

    it('puts the busiest town first and keeps same-named towns apart', () => {
        const { towns } = buildTownDemand([
            entry({ community: 'Penal', details: penal }),
            entry({ community: 'Arima', details: arima }),
            entry({ community: 'Arima', details: arima }),
            entry({ community: 'Arima', details: marabella }),
        ]);
        expect(towns.map((t) => [t.town, t.riders])).toEqual([['Arima', 2], ['Arima', 1], ['Penal', 1]]);
    });

    it('uses the area centre for older sign-ups and says so', () => {
        const { towns } = buildTownDemand([entry({ community: 'San Fernando' })]);
        expect(towns[0].approximate).toBe(true);
    });

    it('leaves out rejected people and counts those with no town', () => {
        const { towns, unplaced } = buildTownDemand([
            entry({ community: 'Marabella', details: marabella, status: 'rejected' }),
            driver('Gone Driver', 'Penal', penal),
            entry({ community: null }),
        ].map((r) => (r.full_name === 'Gone Driver' ? { ...r, status: 'rejected' } : r)));
        expect(towns).toHaveLength(0);
        expect(unplaced).toBe(1);
    });

    it('never lists a G-Lead as a driver and shows at most five', () => {
        const many = Array.from({ length: 7 }, (_, i) => driver(`Driver ${i}`, 'Penal', penal));
        const { towns } = buildTownDemand([
            entry({ community: 'Marabella', details: marabella }),
            ...many,
            entry({ full_name: 'Lead', community: 'Penal', details: penal, user_type: 'drive', source: 'g868:G-Lead (territory)' }),
        ]);
        expect(towns[0].drivers).toHaveLength(5);
        expect(towns[0].drivers.some((d) => d.name === 'Lead')).toBe(false);
    });
});

describe('helpers', () => {
    it('reads T&T numbers and refuses others', () => {
        expect(whatsAppNumber('868 712 3456')).toBe('18687123456');
        expect(whatsAppNumber('712-3456')).toBe('18687123456');
        expect(whatsAppNumber('+1 868 712 3456')).toBe('18687123456');
        expect(whatsAppNumber('305 555 0100')).toBeNull();
        expect(whatsAppNumber(null)).toBeNull();
    });

    it('measures distance and drafts a true count', () => {
        expect(kmBetween([10, -61], [10, -61])).toBe(0);
        expect(draftMessage('Ann Marie Joseph', 'Penal', 1)).toContain('Hi Ann, this is G 868. 1 person near Penal');
        expect(draftMessage('Sam', 'Penal', 4)).toContain('4 people near Penal');
    });
});
