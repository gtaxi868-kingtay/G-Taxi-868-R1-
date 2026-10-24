import React, { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, useWindowDimensions } from 'react-native';
import { CameraView, CameraType, useCameraPermissions } from 'expo-camera';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { supabase } from '@gtaxi/core';
import { AIGateway } from '@g868/shared';
import { toast } from '../components/Toast';
import { Button, Card, EmptyState, GUTTER, IconButton, Screen, SPACE, Txt, useTheme } from '../ui/kit';
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
                toast('We could not recognise that item. Try a closer, clearer photo.', 'error');
            }
        } catch (err: any) {
            console.error('[VisionScanner] Scan failed:', err.message);
            toast('Photo recognition is not working right now. Please try again later.', 'error');
        } finally {
            setScanning(false);
        }
    };

    const m = useTheme();
    if (!permission) return <View style={{ flex: 1, backgroundColor: '#000' }} />;

    if (!permission.granted) {
        return (
            <Screen title="Photo scanner" onBack={() => navigation.goBack()}>
                <EmptyState icon="camera-outline" title="Allow the camera" body="The scanner needs your camera to recognise items you want to buy."
                    action={<Button title="Allow camera" onPress={requestPermission} />} />
            </Screen>
        );
    }

    const top = (height - RETICLE) / 2 - 40;
    return (
        <View style={{ flex: 1, backgroundColor: '#000' }}>
            {/* ref was missing, so Scan never took a picture */}
            <CameraView ref={cameraRef} style={StyleSheet.absoluteFillObject} facing="back" />

            <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
                <View style={{ height: top, backgroundColor: 'rgba(0,0,0,0.5)' }} />
                <View style={{ flexDirection: 'row', height: RETICLE }}>
                    <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }} />
                    <View style={{ width: RETICLE, height: RETICLE, borderRadius: 24, borderWidth: 2, borderColor: 'rgba(255,255,255,0.85)', overflow: 'hidden' }}>
                        {scanning && <Animated.View style={[{ height: 2, backgroundColor: '#3FD9E8' }, scanLineStyle]} />}
                    </View>
                    <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }} />
                </View>
                <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', paddingTop: SPACE.lg }}>
                    <Txt variant="bodyStrong" style={{ color: '#FFFFFF' }}>Point at an item, then tap Scan</Txt>
                </View>
            </View>

            <View style={{ position: 'absolute', top: insets.top + SPACE.sm, left: GUTTER - 4 }}>
                <IconButton icon="close" label="Close" tone="filled" onPress={() => navigation.goBack()} />
            </View>

            <View style={{ position: 'absolute', left: GUTTER, right: GUTTER, bottom: Math.max(insets.bottom, SPACE.lg) + SPACE.lg }}>
                {result && (
                    <Card style={{ marginBottom: SPACE.md }}>
                        <Txt variant="headline">{result.name}</Txt>
                        <Txt variant="caption" tone="dim" style={{ marginTop: 2 }}>About ${(result.price_cents / 100).toFixed(2)} TTD (estimate)</Txt>
                        <Button title="Find it in a shop" size="md" variant="secondary" style={{ marginTop: SPACE.md }}
                            onPress={() => { Haptics.selectionAsync(); navigation.navigate('GroceryStorefront'); }} />
                    </Card>
                )}
                <Button title={scanning ? 'Scanning…' : 'Scan'} icon="scan" loading={scanning} onPress={handleScan} />
            </View>
        </View>
    );
}
