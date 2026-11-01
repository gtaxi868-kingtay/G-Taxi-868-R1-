// Safety photo camera that takes the picture by itself once it sees the
// rider's face centred and steady (founder: "fires after face detection, not
// button press"). It checks a small test frame every ~half second with
// on-device ML Kit (nothing leaves the phone until the final photo), guides
// the rider in plain words, then captures. A "Take photo" button appears after
// a few seconds, and immediately when face detection isn't available (web
// preview, or an older install without the native module), so nobody is stuck.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, NativeModules, StyleSheet, View, useWindowDimensions } from 'react-native';
import { CameraView } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import * as FileSystem from 'expo-file-system';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { judgeFace, RIDER_SAFETY_RULES, type FaceLike, type FaceRules } from '../utils/faceCheck';
import { BRAND_GRADIENT, Button, GUTTER, RADIUS, SPACE, Txt } from '../ui/kit';

type Detector = { detect: (uri: string, o: object) => Promise<FaceLike[]> };
const detector: Detector | null = NativeModules.FaceDetection
    ? require('@react-native-ml-kit/face-detection').default
    : null;

const STEADY_FRAMES = 2;      // two good checks in a row (~1 s) = holding still
const MANUAL_AFTER_MS = 8000; // then offer the button as well
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Smallest picture size whose long side is at least 960 px: plenty for a
// safety photo, and keeps each test frame quick to take and check.
function pickSize(sizes: string[]): string | null {
    const parsed = sizes
        .map((s) => { const m = /^(\d+)x(\d+)$/.exec(s); return m ? { s, long: Math.max(+m[1], +m[2]) } : null; })
        .filter((x): x is { s: string; long: number } => !!x && x.long >= 960)
        .sort((a, b) => a.long - b.long);
    return parsed[0]?.s ?? null;
}

export function FaceAutoCapture({
    onCapture, onCancel, busy = false, error = null, onRetry,
    title = 'Safety photo',
    subtitle = 'Kept private, only used if something goes wrong on this ride.',
    rules = RIDER_SAFETY_RULES,
}: {
    onCapture: (base64: string) => void;
    onCancel: () => void;
    busy?: boolean;
    error?: string | null;
    onRetry?: () => void;
    title?: string;
    subtitle?: string;
    rules?: FaceRules;
}) {
    const insets = useSafeAreaInsets();
    const { width } = useWindowDimensions();
    const cameraRef = useRef<CameraView>(null);
    const capturingRef = useRef(false);
    const [ready, setReady] = useState(false);
    const [pictureSize, setPictureSize] = useState<string | undefined>(undefined);
    const [hint, setHint] = useState(detector ? 'Fit your face in the oval' : 'Look at the camera, then tap Take photo');
    const [locked, setLocked] = useState(false);
    const [showManual, setShowManual] = useState(!detector);
    const progress = useRef(new Animated.Value(0)).current;
    const flash = useRef(new Animated.Value(0)).current;

    const paused = busy || !!error;

    useEffect(() => {
        if (!detector) return;
        const t = setTimeout(() => setShowManual(true), MANUAL_AFTER_MS);
        return () => clearTimeout(t);
    }, []);

    const setProgress = (to: number) =>
        Animated.timing(progress, { toValue: to, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();

    const capture = useCallback(async () => {
        if (capturingRef.current || !cameraRef.current) return;
        capturingRef.current = true;
        try {
            const photo = await cameraRef.current.takePictureAsync({ quality: 0.5, base64: true, shutterSound: false });
            if (!photo?.base64) throw new Error('no photo');
            flash.setValue(1);
            Animated.timing(flash, { toValue: 0, duration: 380, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
            setHint('Got it');
            onCapture(photo.base64);
        } catch {
            setHint('The camera had a problem. Tap Take photo.');
            setShowManual(true);
        } finally {
            capturingRef.current = false;
        }
    }, [onCapture, flash]);

    const onCameraReady = useCallback(async () => {
        try {
            const sizes = (await cameraRef.current?.getAvailablePictureSizesAsync()) ?? [];
            const size = pickSize(sizes);
            if (size) setPictureSize(size);
        } catch { /* keep the camera default */ }
        // Let a new picture size settle before the first test frame.
        setTimeout(() => setReady(true), 300);
    }, []);

    // The watch loop: test frame -> face check -> hint, until steady -> capture.
    useEffect(() => {
        if (!detector || !ready || paused) return;
        let alive = true;
        let streak = 0;
        (async () => {
            while (alive) {
                try {
                    const probe = await cameraRef.current?.takePictureAsync({ quality: 0.2, shutterSound: false });
                    if (!alive || !probe) break;
                    const faces = await detector.detect(probe.uri, { performanceMode: 'fast', classificationMode: 'all', minFaceSize: 0.15 });
                    FileSystem.deleteAsync(probe.uri, { idempotent: true }).catch(() => {});
                    if (!alive) break;
                    const verdict = judgeFace(faces, probe.width, probe.height, rules);
                    streak = verdict.ok ? streak + 1 : 0;
                    setHint(verdict.hint);
                    setLocked(verdict.ok);
                    setProgress(Math.min(streak / STEADY_FRAMES, 1));
                    if (streak === 1) Haptics.selectionAsync().catch(() => {});
                    if (streak >= STEADY_FRAMES) { await capture(); break; }
                } catch {
                    // Detection unavailable on this phone: fall back to the button.
                    if (alive) { setShowManual(true); setHint('Look at the camera, then tap Take photo'); }
                    break;
                }
                await sleep(150);
            }
        })();
        return () => { alive = false; };
    }, [ready, paused, capture, rules]);

    // Reset the ring whenever the loop restarts (after an upload error).
    useEffect(() => { if (paused) { setLocked(false); progress.setValue(0); } }, [paused, progress]);

    const ovalW = Math.min(width * 0.68, 300);
    const ovalH = ovalW * 1.32;
    const DIM = 900; // a thick dark border around the oval makes the cut-out
    const ringColor = locked ? BRAND_GRADIENT[1] : 'rgba(255,255,255,0.85)';
    const barWidth = progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });

    return (
        <View style={{ flex: 1, backgroundColor: '#000' }}>
            <CameraView ref={cameraRef} facing="front" style={StyleSheet.absoluteFill}
                pictureSize={pictureSize} onCameraReady={onCameraReady}
                onMountError={() => { setShowManual(false); setHint('Could not open the camera.'); }} />

            {/* Dimmed screen with an oval window */}
            <View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }]}>
                <View style={{
                    width: ovalW + DIM * 2, height: ovalH + DIM * 2, borderRadius: ovalW / 2 + DIM,
                    borderWidth: DIM, borderColor: 'rgba(15,11,24,0.62)', marginTop: -SPACE.xxl * 2,
                }} />
            </View>
            <View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
                <View style={{
                    width: ovalW, height: ovalH, borderRadius: ovalW / 2, marginTop: -SPACE.xxl * 2,
                    borderWidth: locked ? 4 : 2, borderColor: ringColor,
                }} />
            </View>

            {/* Hint above the oval */}
            <View pointerEvents="none" style={{ position: 'absolute', top: insets.top + SPACE.xl, left: GUTTER, right: GUTTER, alignItems: 'center' }}>
                <View style={{ paddingHorizontal: SPACE.lg, paddingVertical: SPACE.sm, borderRadius: 999, backgroundColor: locked ? 'rgba(63,217,232,0.22)' : 'rgba(15,11,24,0.55)' }}>
                    <Txt variant="bodyStrong" style={{ color: '#FFFFFF', textAlign: 'center' }} accessibilityLiveRegion="polite">{error ? 'Photo not saved' : hint}</Txt>
                </View>
            </View>

            <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#FFFFFF', opacity: flash }]} />

            {/* Bottom card */}
            <View style={{ position: 'absolute', left: GUTTER, right: GUTTER, bottom: Math.max(insets.bottom, SPACE.lg) + SPACE.lg, padding: SPACE.xl, borderRadius: RADIUS.card, backgroundColor: 'rgba(15,11,24,0.82)' }}>
                <Txt variant="headline" style={{ color: '#FFFFFF', textAlign: 'center' }}>{title}</Txt>
                <Txt variant="caption" style={{ color: 'rgba(255,255,255,0.7)', textAlign: 'center', marginTop: SPACE.xs }}>
                    {error ?? (detector ? 'It takes itself when your face is in the oval. ' : '') + subtitle}
                </Txt>
                {detector && !error ? (
                    <View style={{ height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.15)', marginTop: SPACE.md, overflow: 'hidden' }}>
                        <Animated.View style={{ height: 4, width: barWidth, backgroundColor: BRAND_GRADIENT[1] }} />
                    </View>
                ) : null}
                <View style={{ flexDirection: 'row', gap: SPACE.md, marginTop: SPACE.lg }}>
                    <Button title="Cancel" variant="secondary" size="md" style={{ flex: 1 }} onPress={onCancel} disabled={busy} />
                    {error && onRetry ? (
                        <Button title="Try again" icon="refresh" size="md" style={{ flex: 1 }} onPress={onRetry} />
                    ) : showManual || busy ? (
                        <Button title={busy ? 'Saving…' : 'Take photo'} icon="camera" size="md" style={{ flex: 1 }}
                            loading={busy} onPress={capture} />
                    ) : null}
                </View>
            </View>
        </View>
    );
}
