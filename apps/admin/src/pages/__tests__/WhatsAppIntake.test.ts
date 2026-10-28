import { describe, it, expect } from 'vitest';
import { parseIntake } from '../WhatsAppIntake';

const SLUGS = ['kapok', 'innat87', 'fortywinks', 'jta', 'persads', 'buzo', 'sails', 'venimange', 'westbees', 'valsayn', 'lamer', 'levisage', 'hisanna'];

describe('parseIntake', () => {
    it('finds the ref in every shape the partner pages might send', () => {
        expect(parseIntake('Hi, I want to connect. ref=kapok', SLUGS).ref_slug).toBe('kapok');
        expect(parseIntake('ref: JTA please call me', SLUGS).ref_slug).toBe('jta');
        expect(parseIntake('Saw https://g868.tt/p?ref=venimange', SLUGS).ref_slug).toBe('venimange');
        expect(parseIntake('#buzo interested', SLUGS).ref_slug).toBe('buzo');
        expect(parseIntake('Hello from innat87', SLUGS).ref_slug).toBe('innat87');
    });
    it('never matches a slug hidden inside another word, or an unknown ref', () => {
        expect(parseIntake('the sailsman called', SLUGS).ref_slug).toBe(null);
        expect(parseIntake('ref=unknownplace', SLUGS).ref_slug).toBe(null);
    });
    it('tells a driver from a business', () => {
        expect(parseIntake('ref=sails I want to start driving', SLUGS).kind).toBe('driver_start');
        expect(parseIntake('ref=sails connect us', SLUGS).kind).toBe('connect');
        expect(parseIntake('ref=sails hello', SLUGS).kind).toBe('other');
    });
    it('picks out a T&T phone number', () => {
        expect(parseIntake('ref=lamer call 868-555-1234', SLUGS).phone).toBe('8685551234');
        expect(parseIntake('ref=lamer +1 (868) 555 1234', SLUGS).phone).toBe('+18685551234');
    });
});
