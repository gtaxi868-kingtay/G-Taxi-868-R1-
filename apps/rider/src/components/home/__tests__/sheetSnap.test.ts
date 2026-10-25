import { pickSnap, sheetSnaps } from '../sheetSnap';

const SNAPS = [240, 460, 700]; // peek, half, full (px of sheet showing)

describe('pickSnap', () => {
    it('settles on the nearest stop when let go slowly', () => {
        expect(pickSnap(SNAPS, 250, 0)).toBe(240);
        expect(pickSnap(SNAPS, 400, 0)).toBe(460);
        expect(pickSnap(SNAPS, 600, 0)).toBe(700);
    });

    it('a quick flick moves one stop in the flick direction, even from close by', () => {
        // positive velocity = finger moving UP = sheet growing
        expect(pickSnap(SNAPS, 260, 1200)).toBe(460);
        expect(pickSnap(SNAPS, 480, 1200)).toBe(700);
        expect(pickSnap(SNAPS, 680, -1200)).toBe(460);
        expect(pickSnap(SNAPS, 450, -1200)).toBe(240);
    });

    it('never goes past the first or last stop', () => {
        expect(pickSnap(SNAPS, 100, -3000)).toBe(240);
        expect(pickSnap(SNAPS, 900, 3000)).toBe(700);
    });
});

describe('sheetSnaps', () => {
    it('builds peek / half / full from the space available', () => {
        const s = sheetSnaps({ available: 700, peek: 230 });
        expect(s[0]).toBe(230);
        expect(s[2]).toBe(700);
        expect(s[1]).toBeGreaterThan(s[0]);
        expect(s[1]).toBeLessThan(s[2]);
    });

    it('stays strictly increasing on a short phone', () => {
        const s = sheetSnaps({ available: 420, peek: 380 });
        expect(s[0]).toBeLessThan(s[1]);
        expect(s[1]).toBeLessThan(s[2]);
        expect(s[2]).toBe(420);
    });
});
