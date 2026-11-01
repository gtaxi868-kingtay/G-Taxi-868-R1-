import { judgeFace } from '../faceCheck';

const W = 1000, H = 1400;
const face = (over: Partial<{ left: number; top: number; width: number; height: number; rotationY: number; rotationZ: number; l: number; r: number }> = {}) => ({
    frame: { left: over.left ?? 300, top: over.top ?? 450, width: over.width ?? 400, height: over.height ?? 500 },
    rotationY: over.rotationY ?? 0,
    rotationZ: over.rotationZ ?? 0,
    leftEyeOpenProbability: over.l,
    rightEyeOpenProbability: over.r,
});

describe('judgeFace', () => {
    it('accepts a centred, front-on face', () => {
        expect(judgeFace([face()], W, H)).toEqual({ ok: true, hint: 'Hold still…' });
    });
    it('asks for a face when none is seen', () => {
        expect(judgeFace([], W, H)).toMatchObject({ ok: false, reason: 'none' });
        expect(judgeFace(null, W, H)).toMatchObject({ ok: false, reason: 'none' });
        expect(judgeFace([face()], 0, H)).toMatchObject({ ok: false, reason: 'none' });
    });
    it('guides distance', () => {
        expect(judgeFace([face({ left: 450, width: 100 })], W, H)).toMatchObject({ reason: 'far', hint: 'Move a little closer' });
        expect(judgeFace([face({ left: 25, width: 950 })], W, H)).toMatchObject({ reason: 'near' });
    });
    it('guides centring', () => {
        expect(judgeFace([face({ left: 0 })], W, H)).toMatchObject({ reason: 'off-centre' });
        expect(judgeFace([face({ top: 0 })], W, H)).toMatchObject({ reason: 'off-centre' });
    });
    it('asks to look straight and open eyes', () => {
        expect(judgeFace([face({ rotationY: 40 })], W, H)).toMatchObject({ reason: 'turned' });
        expect(judgeFace([face({ l: 0.05, r: 0.1 })], W, H)).toMatchObject({ reason: 'eyes' });
        // One eye reported open is enough (a wink, glare on glasses).
        expect(judgeFace([face({ l: 0.05, r: 0.9 })], W, H).ok).toBe(true);
    });
    it('judges the nearest face when several are in frame', () => {
        expect(judgeFace([face({ left: 0, width: 120 }), face()], W, H).ok).toBe(true);
    });
});
