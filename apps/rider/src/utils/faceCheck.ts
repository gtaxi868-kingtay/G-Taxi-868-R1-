// Decides whether a camera frame holds a face good enough to auto-capture the
// safety photo, and if not, the one plain hint that fixes it. Pure so it can
// be tested without a camera. Faces come from ML Kit (frame in image pixels).
export type FaceLike = {
    frame: { left: number; top: number; width: number; height: number };
    rotationY?: number;   // turned left/right
    rotationZ?: number;   // head tilt
    leftEyeOpenProbability?: number;
    rightEyeOpenProbability?: number;
};

export type FaceRules = {
    minWidth: number;     // face width / image width
    maxWidth: number;
    maxOffsetX: number;   // face centre from image centre, as a share of width
    maxOffsetY: number;
    maxTurn: number;      // degrees
    minEyesOpen: number;  // ML Kit probability; skipped when not reported
};

// Rider safety photo: forgiving. It only has to show who is getting in the car.
export const RIDER_SAFETY_RULES: FaceRules = {
    minWidth: 0.25, maxWidth: 0.85, maxOffsetX: 0.2, maxOffsetY: 0.25, maxTurn: 22, minEyesOpen: 0.3,
};

export type FaceVerdict =
    | { ok: true; hint: string }
    | { ok: false; hint: string; reason: 'none' | 'far' | 'near' | 'off-centre' | 'turned' | 'eyes' };

export function judgeFace(
    faces: FaceLike[] | null | undefined,
    imageWidth: number,
    imageHeight: number,
    rules: FaceRules = RIDER_SAFETY_RULES,
): FaceVerdict {
    if (!faces || faces.length === 0 || !(imageWidth > 0) || !(imageHeight > 0)) {
        return { ok: false, reason: 'none', hint: 'Fit your face in the oval' };
    }
    // Several people in frame is fine (a parent with a child); judge the nearest.
    const face = faces.reduce((a, b) => (b.frame.width > a.frame.width ? b : a));
    const size = face.frame.width / imageWidth;
    if (size < rules.minWidth) return { ok: false, reason: 'far', hint: 'Move a little closer' };
    if (size > rules.maxWidth) return { ok: false, reason: 'near', hint: 'Move back a little' };

    const cx = (face.frame.left + face.frame.width / 2) / imageWidth - 0.5;
    const cy = (face.frame.top + face.frame.height / 2) / imageHeight - 0.5;
    if (Math.abs(cx) > rules.maxOffsetX || Math.abs(cy) > rules.maxOffsetY) {
        return { ok: false, reason: 'off-centre', hint: 'Centre your face in the oval' };
    }
    if (Math.abs(face.rotationY ?? 0) > rules.maxTurn || Math.abs(face.rotationZ ?? 0) > rules.maxTurn) {
        return { ok: false, reason: 'turned', hint: 'Look straight at the camera' };
    }
    const eyes = [face.leftEyeOpenProbability, face.rightEyeOpenProbability].filter((p): p is number => typeof p === 'number');
    if (eyes.length > 0 && Math.max(...eyes) < rules.minEyesOpen) {
        return { ok: false, reason: 'eyes', hint: 'Keep your eyes open' };
    }
    return { ok: true, hint: 'Hold still…' };
}
