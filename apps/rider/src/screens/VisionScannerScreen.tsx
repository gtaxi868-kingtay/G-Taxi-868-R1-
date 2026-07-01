import React, { useState, useEffect, useRef } from 'react';
import {
    View, Text, TouchableOpacity, StyleSheet,
    Alert, useWindowDimensions,
} from 'react-native';
import { CameraView, CameraType, useCameraPermissions } from 'expo-camera';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { supabase } from '@gtaxi/core';
import { AIGateway } from '@gtaxi/shared';
import { ghostBorder, elevationGlow } from '@gtaxi/design-system/utils/style-rules';
import { SURFACE, VOICES, ANIMATION } from '@gtaxi/design-system';

const CYAN = '#06B6D4';
const RETICLE = 240;

export function VisionScannerScreen({ navigation }: any) {
    const { width, height } = useWindowDimensions();
    const insets = useSafeAreaInsets();
    const [permission, requestPermission] = useCameraPermissions();
    const [scanning, setScanning] = useState(false);
    const [result, setResult] = useState<{ name: string; price_cents: number; id: string } | null>(null);
    const scanAnim = useSharedValue(0);

    useEffect(() => {
        scanAnim.value = withRepeat(
            withSequence(
                withTiming(RETICLE - 4, { duration: 1800 }),
                withTiming(0, { duration: 1800 })
            ),
            -1,
            true
        );
    }, []);

    const scanLineStyle = useAnimatedStyle(() => ({
        transform: [{ translateY: scanAnim.value }],
    }));

    const cameraRef = useRef<any>(null);

    const handleScan = async () => {
        if (scanning || !cameraRef.current) return;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        setScanning(true);
        setResult(null);

        try {
            const photo = await cameraRef.current.takePictureAsync({
                base64: true,
                quality: 0.5,
                skipProcessing: true
            });

            const { data, error } = await AIGateway.identifyProduct(photo.base64, (img: string) =>
                supabase.functions.invoke('identify_product', {
                    body: { image: img, trigger: 'camera_scan' },
                })
            );

            if (error) throw error;

            if (data?.product) {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                setResult(data.product);
            } else {
                Alert.alert('Not Recognized', 'Could not identify this item. Try again.');
            }
        } catch (err: any) {
            console.error('[VisionScanner] Scan failed:', err.message);
            Alert.alert('Scanner Error', 'The Vision AI is currently busy. Please try again in a moment.');
        } finally {
            setScanning(false);
        }
    };

    if (!permission) return <View style={s.container} />;

    if (!permission.granted) {
        return (
            <LinearGradient colors={['#0A0A1F', '#12122A']} style={s.container}>
                <View style={s.permCenter}>
                    <Ionicons name="camera-outline" size={48} color="rgba(255,255,255,0.6)" />
                    <Text style={s.permTitle}>Camera Permission Needed</Text>
                    <Text style={s.permSub}>G-TAXI Vision Scanner needs camera access to identify products.</Text>
                    <TouchableOpacity style={s.permBtn} onPress={requestPermission}>
                        <Text style={s.permBtnText}>Grant Permission</Text>
                    </TouchableOpacity>
                </View>
            </LinearGradient>
        );
    }

    return (
        <View style={s.container}>
            <CameraView style={StyleSheet.absoluteFillObject} facing="back" />

            <View style={StyleSheet.absoluteFillObject}>
                <View style={[s.overlay, { height: (height - RETICLE) / 2 - 40 }]} />
                <View style={{ flexDirection: 'row', height: RETICLE }}>
                    <View style={[s.overlay, { flex: 1 }]} />
                    <View style={s.reticle}>
                        {['TL', 'TR', 'BL', 'BR'].map(corner => (
                            <View key={corner} style={[s.corner, {
                                top: corner.startsWith('T') ? 0 : undefined,
                                bottom: corner.startsWith('B') ? 0 : undefined,
                                left: corner.endsWith('L') ? 0 : undefined,
                                right: corner.endsWith('R') ? 0 : undefined,
                                borderTopWidth: corner.startsWith('T') ? 3 : 0,
                                borderBottomWidth: corner.startsWith('B') ? 3 : 0,
                                borderLeftWidth: corner.endsWith('L') ? 3 : 0,
                                borderRightWidth: corner.endsWith('R') ? 3 : 0,
                            }]} />
                        ))}
                        {scanning && (
                            <Animated.View
                                style={[s.scanLine, scanLineStyle]}
                            />
                        )}
                    </View>
                    <View style={[s.overlay, { flex: 1 }]} />
                </View>
                <View style={[s.overlay, { flex: 1 }]} />
            </View>

            <View style={[s.header, { paddingTop: insets.top + 8 }]}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
                    <Ionicons name="close" size={22} color="#EAF3F6" />
                </TouchableOpacity>
                <Text style={s.headerTitle}>AI Vision Scanner</Text>
                <View style={{ width: 38 }} />
            </View>

            <Text style={s.hint}>Point camera at a product and tap Scan</Text>

            <View style={[s.scanBtnContainer, { bottom: insets.bottom + 60 }]}>
                <TouchableOpacity
                    style={[s.scanBtn, scanning && s.scanBtnActive]}
                    onPress={handleScan}
                    disabled={scanning}
                    activeOpacity={0.85}
                >
                    <LinearGradient
                        colors={scanning ? [CYAN, '#0099CC'] : [VOICES.rider.accent, VOICES.rider.accentDark]}
                        style={s.scanBtnGrad}
                    >
                        <Ionicons name={scanning ? 'scan-outline' : 'camera-outline'} size={28} color="#EAF3F6" />
                        <Text style={s.scanBtnText}>{scanning ? 'Scanning...' : 'Scan Item'}</Text>
                    </LinearGradient>
                </TouchableOpacity>
            </View>

            {result && (
                <View style={[s.resultCard, { bottom: insets.bottom + 150 }]}>
                    <View style={StyleSheet.absoluteFillObject}>
                        <View style={[StyleSheet.absoluteFillObject, s.resultBg]} />
                    </View>
                    <Text style={s.resultName}>{result.name}</Text>
                    <Text style={s.resultPrice}>${(result.price_cents / 100).toFixed(2)} TTD</Text>
                    <TouchableOpacity
                        style={s.resultBtn}
                        onPress={() => {
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                            navigation.navigate('GroceryStorefront');
                        }}
                    >
                        <Text style={s.resultBtnText}>Shop This Item →</Text>
                    </TouchableOpacity>
                </View>
            )}
        </View>
    );
}

const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: SURFACE.base },
    overlay: { backgroundColor: 'rgba(0,0,0,0.6)' },
    reticle: {
        width: RETICLE, height: RETICLE,
        alignItems: 'center', justifyContent: 'center',
    },
    corner: {
        position: 'absolute', width: 28, height: 28,
        borderColor: CYAN,
    },
    scanLine: {
        position: 'absolute', left: 4, right: 4, height: 2,
        backgroundColor: CYAN,
        ...elevationGlow(),
        shadowColor: CYAN, shadowOpacity: 0.8, shadowRadius: 6,
    },
    header: {
        position: 'absolute', top: 0, left: 0, right: 0,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 20, paddingBottom: 12,
    },
    backBtn: {
        width: 38, height: 38, borderRadius: 19,
        backgroundColor: 'rgba(0,0,0,0.5)',
        alignItems: 'center', justifyContent: 'center',
    },
    headerTitle: { fontSize: 18, fontWeight: '700', color: '#EAF3F6' },
    hint: {
        position: 'absolute',
        top: '50%', left: 0, right: 0,
        marginTop: RETICLE / 2 + 20,
        textAlign: 'center',
        fontSize: 13, color: 'rgba(255,255,255,0.6)',
    },
    scanBtnContainer: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
    scanBtn: { borderRadius: 32, overflow: 'hidden' },
    scanBtnActive: { opacity: 0.85 },
    scanBtnGrad: {
        flexDirection: 'row', alignItems: 'center', gap: 10,
        paddingHorizontal: 40, paddingVertical: 18,
    },
    scanBtnText: { fontSize: 18, fontWeight: '800', color: '#EAF3F6' },
    resultCard: {
        position: 'absolute', left: 20, right: 20,
        borderRadius: 24, padding: 20, overflow: 'hidden',
        ...ghostBorder(0.4),
        alignItems: 'center', gap: 6,
    },
    resultBg: { backgroundColor: 'rgba(0,0,0,0.85)' },
    resultName: { fontSize: 18, fontWeight: '700', color: '#EAF3F6', textAlign: 'center' },
    resultPrice: { fontSize: 24, fontWeight: '900', color: VOICES.rider.accent },
    resultBtn: {
        marginTop: 10, paddingVertical: 10, paddingHorizontal: 28,
        borderRadius: 50, backgroundColor: VOICES.rider.accent,
    },
    resultBtnText: { fontSize: 14, fontWeight: '700', color: '#EAF3F6' },
    permCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
    permEmoji: { fontSize: 56, marginBottom: 20 },
    permTitle: { fontSize: 20, fontWeight: '700', color: '#EAF3F6', marginBottom: 10 },
    permSub: { fontSize: 14, color: 'rgba(255,255,255,0.5)', textAlign: 'center', lineHeight: 21, marginBottom: 30 },
    permBtn: {
        backgroundColor: VOICES.rider.accent, borderRadius: 20,
        paddingVertical: 14, paddingHorizontal: 32,
    },
    permBtnText: { fontSize: 16, fontWeight: '700', color: '#EAF3F6' },
});
