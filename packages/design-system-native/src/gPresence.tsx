import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import * as Speech from 'expo-speech';
import * as Haptics from 'expo-haptics';

// G, full screen. One living presence for every app; each brings its colours.
// It always shows what is happening, says its answer aloud, and turns what it
// found into keys the person can press. Money and bookings are still confirmed
// by the person on the normal screens.

export type GPalette = {
    page: string[];         // top to bottom
    ring: string;
    core: string[];
    coreLip: string;
    onCore: string;
    ink: string;
    dim: string;
    field: string;
    fieldLine: string;
};

export type GAction = { id: string; label: string; icon?: keyof typeof Ionicons.glyphMap; payload?: Record<string, unknown> };
export type GState = 'ready' | 'listening' | 'thinking' | 'answer' | 'problem';
export type GReply = { reply?: string | null; actions?: GAction[]; problem?: string | null };

type Ask = (input: { text?: string; audioUri?: string }) => Promise<GReply & { heard?: string }>;

const WORDS: Record<GState, string> = {
    ready: 'Tell me what you need',
    listening: "I'm listening",
    thinking: 'On it',
    answer: '',
    problem: '',
};

function Orb({ state, palette }: { state: GState; palette: GPalette }) {
    const pulse = useRef(new Animated.Value(0)).current;
    const spin = useRef(new Animated.Value(0)).current;
    const live = state === 'listening' || state === 'thinking';

    useEffect(() => {
        pulse.setValue(0);
        const beat = Animated.loop(Animated.timing(pulse, {
            toValue: 1, duration: state === 'listening' ? 1100 : state === 'thinking' ? 1500 : 2800,
            easing: Easing.out(Easing.quad), useNativeDriver: true,
        }));
        beat.start();
        return () => beat.stop();
    }, [state, pulse]);

    useEffect(() => {
        spin.setValue(0);
        if (state !== 'thinking') return;
        const turn = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 1400, easing: Easing.linear, useNativeDriver: true }));
        turn.start();
        return () => turn.stop();
    }, [state, spin]);

    const ring = (at: number, reach: number) => ({
        opacity: pulse.interpolate({ inputRange: [0, at, 1], outputRange: [0, live ? 0.7 : 0.4, 0] }),
        transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.82, reach] }) }],
    });

    return (
        <View style={s.orbBox} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Animated.View style={[s.ring, { borderColor: palette.ring }, ring(0.25, 1.75)]} />
            <Animated.View style={[s.ring, { borderColor: palette.ring }, ring(0.5, 1.4)]} />
            {state === 'thinking' && (
                <Animated.View style={[s.arc, { borderTopColor: palette.ring, transform: [{ rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }]} />
            )}
            <LinearGradient colors={palette.core as [string, string, string]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[s.core, { borderBottomColor: palette.coreLip }]}>
                <Text style={[s.g, { color: palette.onCore }]}>G</Text>
            </LinearGradient>
        </View>
    );
}

export function GPresence({ visible, palette, ask, onAction, onClose, name, hint, startListening, invite }: {
    visible: boolean;
    palette: GPalette;
    ask: Ask;
    onAction: (a: GAction) => void;
    onClose: () => void;
    name?: string;
    hint?: string;
    startListening?: boolean;
    /** Asks once to let G learn this person. Without it G still works, but forgets. */
    invite?: { title: string; body: string; accept: string; onAccept: () => void };
}) {
    const [state, setState] = useState<GState>('ready');
    const [heard, setHeard] = useState('');
    const [reply, setReply] = useState('');
    const [actions, setActions] = useState<GAction[]>([]);
    const [text, setText] = useState('');
    const [muted, setMuted] = useState(false);
    const recording = useRef<Audio.Recording | null>(null);
    const fade = useRef(new Animated.Value(0)).current;
    const open = useRef(false);

    const stopTalking = () => { try { Speech.stop(); } catch { /* nothing playing */ } };

    const show = useCallback((r: GReply) => {
        const words = r.problem ?? r.reply ?? "I'm here. Tell me what you need.";
        setReply(words);
        setActions(r.actions ?? []);
        setState(r.problem ? 'problem' : 'answer');
        fade.setValue(0);
        Animated.timing(fade, { toValue: 1, duration: 260, useNativeDriver: true }).start();
        Haptics.notificationAsync(r.problem ? Haptics.NotificationFeedbackType.Warning : Haptics.NotificationFeedbackType.Success).catch(() => {});
        if (!muted) { stopTalking(); Speech.speak(words, { language: 'en-US', rate: 1.0 }); }
    }, [fade, muted]);

    const send = useCallback(async (input: { text?: string; audioUri?: string }) => {
        stopTalking();
        setState('thinking');
        setReply('');
        setActions([]);
        if (input.text) setHeard(input.text);
        const late = new Promise<GReply>((done) => setTimeout(() => done({ problem: "That's taking too long. Check your signal and try again." }), 30000));
        const r = await Promise.race([ask(input), late]);
        if (!open.current) return;
        if ('heard' in r && r.heard) setHeard(r.heard as string);
        show(r);
    }, [ask, show]);

    const listen = useCallback(async () => {
        stopTalking();
        try {
            const { status } = await Audio.requestPermissionsAsync();
            if (status !== 'granted') { show({ problem: 'G needs your microphone. Turn it on in your phone settings, or type instead.' }); return; }
            await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
            const { recording: rec } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
            recording.current = rec;
            setHeard('');
            setReply('');
            setActions([]);
            setState('listening');
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
        } catch {
            show({ problem: "I couldn't start the mic. Try again, or type instead." });
        }
    }, [show]);

    const finish = useCallback(async () => {
        const rec = recording.current;
        recording.current = null;
        if (!rec) return;
        try {
            await rec.stopAndUnloadAsync();
            await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
            const uri = rec.getURI();
            if (!uri) throw new Error('no recording');
            await send({ audioUri: uri });
        } catch {
            show({ problem: "I didn't catch that. Try again, a little closer to the mic." });
        }
    }, [send, show]);

    useEffect(() => {
        open.current = visible;
        if (visible) {
            setState('ready'); setHeard(''); setReply(''); setActions([]); setText('');
            if (startListening) listen();
        } else {
            stopTalking();
            recording.current?.stopAndUnloadAsync().catch(() => {});
            recording.current = null;
        }
    }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

    const typed = () => {
        const value = text.trim();
        if (!value) return;
        setText('');
        send({ text: value });
    };

    const listening = state === 'listening';

    return (
        <Modal visible={visible} animationType="fade" statusBarTranslucent onRequestClose={onClose}>
            <LinearGradient colors={palette.page as [string, string, string]} style={StyleSheet.absoluteFillObject} />
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.fill}>
                <View style={s.top}>
                    <Pressable onPress={() => { setMuted((v) => { if (!v) stopTalking(); return !v; }); }} style={s.topBtn} accessibilityRole="button" accessibilityLabel={muted ? 'Turn G voice on' : 'Turn G voice off'}>
                        <Ionicons name={muted ? 'volume-mute' : 'volume-high'} size={22} color={palette.ink} />
                    </Pressable>
                    <Pressable onPress={onClose} style={s.topBtn} accessibilityRole="button" accessibilityLabel="Close G">
                        <Ionicons name="close" size={26} color={palette.ink} />
                    </Pressable>
                </View>

                <ScrollView contentContainerStyle={s.middle} keyboardShouldPersistTaps="handled">
                    <Orb state={state} palette={palette} />
                    {heard ? <Text style={[s.heard, { color: palette.dim }]} numberOfLines={3}>“{heard}”</Text> : null}
                    {WORDS[state] ? (
                        <Text style={[s.status, { color: palette.ink }]} accessibilityLiveRegion="polite">
                            {state === 'ready' && name ? `Hi ${name}. ${WORDS.ready}` : WORDS[state]}
                        </Text>
                    ) : (
                        <Animated.View style={{ opacity: fade, alignSelf: 'stretch' }}>
                            <Text style={[s.reply, { color: palette.ink }]} accessibilityLiveRegion="polite">{reply}</Text>
                            {actions.map((a) => (
                                <Pressable key={a.id} onPress={() => { stopTalking(); onAction(a); }} accessibilityRole="button" accessibilityLabel={a.label} style={s.keyWrap}>
                                    <View style={[s.keyLip, { backgroundColor: palette.coreLip }]} />
                                    <LinearGradient colors={palette.core as [string, string, string]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.key}>
                                        {a.icon ? <Ionicons name={a.icon} size={20} color={palette.onCore} /> : null}
                                        <Text style={[s.keyText, { color: palette.onCore }]} numberOfLines={1}>{a.label}</Text>
                                    </LinearGradient>
                                </Pressable>
                            ))}
                        </Animated.View>
                    )}
                    {state === 'ready' && hint ? <Text style={[s.hint, { color: palette.dim }]}>{hint}</Text> : null}
                    {state === 'ready' && invite ? (
                        <View style={[s.invite, { backgroundColor: palette.field, borderColor: palette.fieldLine }]}>
                            <Text style={[s.inviteTitle, { color: palette.ink }]}>{invite.title}</Text>
                            <Text style={[s.hint, { color: palette.dim, marginTop: 4 }]}>{invite.body}</Text>
                            <Pressable onPress={invite.onAccept} accessibilityRole="button" accessibilityLabel={invite.accept} style={[s.keyWrap, { marginTop: 12, marginBottom: 0 }]}>
                                <View style={[s.keyLip, { backgroundColor: palette.coreLip }]} />
                                <LinearGradient colors={palette.core as [string, string, string]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.key}>
                                    <Text style={[s.keyText, { color: palette.onCore }]}>{invite.accept}</Text>
                                </LinearGradient>
                            </Pressable>
                        </View>
                    ) : null}
                </ScrollView>

                <View style={s.bottom}>
                    <Pressable onPress={listening ? finish : listen} disabled={state === 'thinking'} style={[s.mic, { backgroundColor: listening ? '#E5484D' : palette.field, borderColor: palette.fieldLine, opacity: state === 'thinking' ? 0.5 : 1 }]} accessibilityRole="button" accessibilityLabel={listening ? 'Stop and send' : 'Talk to G'}>
                        <Ionicons name={listening ? 'stop' : 'mic'} size={26} color={listening ? '#FFFFFF' : palette.ink} />
                    </Pressable>
                    <TextInput
                        style={[s.input, { backgroundColor: palette.field, borderColor: palette.fieldLine, color: palette.ink }]}
                        placeholder="Or type to G"
                        placeholderTextColor={palette.dim}
                        value={text}
                        onChangeText={setText}
                        onSubmitEditing={typed}
                        returnKeyType="send"
                        accessibilityLabel="Type to G"
                    />
                </View>
            </KeyboardAvoidingView>
        </Modal>
    );
}

const s = StyleSheet.create({
    fill: { flex: 1 },
    top: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 52 },
    topBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    middle: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 12 },
    orbBox: { width: 220, height: 220, alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
    ring: { position: 'absolute', width: 124, height: 124, borderRadius: 62, borderWidth: 3 },
    arc: { position: 'absolute', width: 146, height: 146, borderRadius: 73, borderWidth: 4, borderColor: 'transparent' },
    core: { width: 124, height: 124, borderRadius: 62, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 7 },
    g: { fontFamily: 'Nunito_900Black', fontSize: 68, lineHeight: 80 },
    heard: { fontFamily: 'Nunito_700Bold', fontSize: 15, lineHeight: 21, textAlign: 'center', marginBottom: 10 },
    status: { fontFamily: 'Nunito_900Black', fontSize: 25, lineHeight: 32, textAlign: 'center' },
    reply: { fontFamily: 'Nunito_800ExtraBold', fontSize: 22, lineHeight: 30, textAlign: 'center', marginBottom: 18 },
    hint: { fontFamily: 'Nunito_700Bold', fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 8 },
    invite: { alignSelf: 'stretch', marginTop: 18, padding: 16, borderRadius: 22, borderWidth: 2 },
    inviteTitle: { fontFamily: 'Nunito_900Black', fontSize: 17, lineHeight: 23, textAlign: 'center' },
    keyWrap: { alignSelf: 'stretch', marginBottom: 10 },
    keyLip: { position: 'absolute', left: 0, right: 0, top: 5, bottom: 0, borderRadius: 18 },
    key: { minHeight: 54, marginBottom: 5, paddingHorizontal: 18, borderRadius: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
    keyText: { fontFamily: 'Nunito_800ExtraBold', fontSize: 16 },
    bottom: { flexDirection: 'row', gap: 10, alignItems: 'center', paddingHorizontal: 16, paddingBottom: 34, paddingTop: 8 },
    mic: { width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
    input: { flex: 1, height: 58, borderRadius: 20, borderWidth: 2, paddingHorizontal: 18, fontSize: 16, fontFamily: 'Nunito_700Bold' },
});
