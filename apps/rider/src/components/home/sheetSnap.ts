// Pure maths for the Home drag sheet, kept out of the gesture code so it can be
// unit-tested. Heights are "how much sheet is showing" in px.
//
// Marked as worklets so the gesture can call them on the UI thread.

// A flick faster than this (px/s) moves one stop in that direction.
const FLICK = 650;

// snaps: ascending [peek, half, full]. velocity: + means the finger moved UP.
export function pickSnap(snaps: number[], current: number, velocity: number): number {
    'worklet';
    if (velocity > FLICK) {
        for (const s of snaps) if (s > current + 1) return s;
        return snaps[snaps.length - 1];
    }
    if (velocity < -FLICK) {
        for (let i = snaps.length - 1; i >= 0; i--) if (snaps[i] < current - 1) return snaps[i];
        return snaps[0];
    }
    let best = snaps[0];
    for (const s of snaps) if (Math.abs(s - current) < Math.abs(best - current)) best = s;
    return best;
}

// available: tallest the sheet may get (leaves the map's top bar visible).
// peek: measured height of the always-visible part (handle + Where-to + cards).
export function sheetSnaps({ available, peek }: { available: number; peek: number }): [number, number, number] {
    const full = Math.round(available);
    const lo = Math.min(Math.round(peek), full - 2);
    const half = Math.round(Math.max(lo + 1, Math.min(full - 1, lo + (full - lo) * 0.45)));
    return [lo, half, full];
}
