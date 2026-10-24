import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View, AccessibilityInfo } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// A soft message that slides down from the top and leaves on its own,
// instead of a blocking Alert.alert box (the rider app has ~177 of those).
// Use for confirmations and gentle errors; keep Alert only for real
// decisions ("Cancel this ride?").
//
//   import { toast } from '../components/Toast';
//   toast('Welcome to G 868');
//   toast('Could not save. Try again.', 'error');

type Kind = 'info' | 'success' | 'error';
type Message = { id: number; text: string; kind: Kind };

let push: ((m: Message) => void) | null = null;
let nextId = 1;

export function toast(text: string, kind: Kind = 'info'): void {
    const m = { id: nextId++, text, kind };
    if (push) push(m);
    AccessibilityInfo.announceForAccessibility?.(text);
}

const VISIBLE_MS = 2800;
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

// Mount once near the root of the app (App.tsx).
export function ToastHost() {
    const insets = useSafeAreaInsets();
    const [current, setCurrent] = useState<Message | null>(null);
    const y = useRef(new Animated.Value(-16)).current;
    const opacity = useRef(new Animated.Value(0)).current;
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        push = (m) => {
            if (timer.current) clearTimeout(timer.current);
            setCurrent(m);
            y.setValue(-16);
            opacity.setValue(0);
            Animated.parallel([
                Animated.timing(y, { toValue: 0, duration: 260, easing: EASE_OUT, useNativeDriver: true }),
                Animated.timing(opacity, { toValue: 1, duration: 200, easing: EASE_OUT, useNativeDriver: true }),
            ]).start();
            timer.current = setTimeout(() => {
                Animated.parallel([
                    Animated.timing(y, { toValue: -12, duration: 200, easing: EASE_OUT, useNativeDriver: true }),
                    Animated.timing(opacity, { toValue: 0, duration: 180, easing: EASE_OUT, useNativeDriver: true }),
                ]).start(() => setCurrent((c) => (c?.id === m.id ? null : c)));
            }, VISIBLE_MS);
        };
        return () => {
            push = null;
            if (timer.current) clearTimeout(timer.current);
        };
    }, [y, opacity]);

    if (!current) return null;
    return (
        <View pointerEvents="none" style={[styles.wrap, { top: insets.top + 10 }]}>
            <Animated.View
                accessibilityRole="alert"
                style={[styles.card, current.kind === 'error' && styles.cardError, { opacity, transform: [{ translateY: y }] }]}
            >
                <View style={[styles.dot, current.kind === 'success' && styles.dotSuccess, current.kind === 'error' && styles.dotError]} />
                <Text style={styles.text} numberOfLines={3}>{current.text}</Text>
            </Animated.View>
        </View>
    );
}

const styles = StyleSheet.create({
    wrap: { position: 'absolute', left: 16, right: 16, alignItems: 'center', zIndex: 1000 },
    card: {
        flexDirection: 'row', alignItems: 'center', gap: 10, maxWidth: 480, width: '100%',
        paddingVertical: 14, paddingHorizontal: 16, borderRadius: 16,
        backgroundColor: 'rgba(28,28,36,0.96)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.10)',
        shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 8,
    },
    cardError: { borderColor: 'rgba(255,138,138,0.35)' },
    dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#8B7CFF' },
    dotSuccess: { backgroundColor: '#3DDC97' },
    dotError: { backgroundColor: '#FF8A8A' },
    text: { flex: 1, color: '#F4F4F6', fontSize: 15, lineHeight: 20, fontWeight: '600' },
});
