import React, { useState } from 'react';
import {
    View, Text, TouchableOpacity, StyleSheet,
    Alert, Dimensions,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../../../../shared/supabase';
import { LoadingOverlay } from '../design-system';

const SERVICES = [
    { id: 'wash_fold', label: 'Wash & Fold', icon: '🫧', baseRate: 500 },
    { id: 'dry_clean', label: 'Dry Clean', icon: '✨', baseRate: 1200 },
    { id: 'iron', label: 'Iron Only', icon: '♨️', baseRate: 300 },
];

export function LaundryLandingScreen({ navigation }: any) {
    const insets = useSafeAreaInsets();
    const [selectedService, setSelectedService] = useState(SERVICES[0]);
    const [isProcessingAI, setIsProcessingAI] = useState(false);

    const handleNext = () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        navigation.navigate('LaundryEstimator', { service: selectedService });
    };

    const handleAITakePhoto = async () => {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== 'granted') {
            Alert.alert("Permission Needed", "Camera access is required for AI intake.");
            return;
        }

        const result = await ImagePicker.launchCameraAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            allowsEditing: true,
            aspect: [4, 3],
            quality: 0.5,
        });

        if (!result.canceled && result.assets[0]) {
            setIsProcessingAI(true);
            try {
                // Phase 16 Placeholder: Upload to Supabase and call edge function
                // For now, we simulate the AI processing and pass a dummy generated list
                setTimeout(() => {
                    setIsProcessingAI(false);
                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                    navigation.navigate('LaundryEstimator', { 
                        service: selectedService, 
                        photoUrl: result.assets[0].uri,
                        aiList: [{ name: "AI Bundle", qty: 1 }] // Mock list until Edge fn is wired
                    });
                }, 2000);
            } catch (err) {
                Alert.alert("Error", "Failed to process image.");
                setIsProcessingAI(false);
            }
        }
    };

    return (
        <LinearGradient colors={['#0A0A1F', '#12122A']} style={s.container}>
            <View style={[s.header, { paddingTop: insets.top + 8 }]}>
                <TouchableOpacity
                    onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); navigation.goBack(); }}
                    style={s.backBtn}
                >
                    <Ionicons name="arrow-back" size={22} color="#FFF" />
                </TouchableOpacity>
                <Text style={s.headerTitle}>Laundry Service</Text>
                <View style={{ width: 38 }} />
            </View>

            {/* Hero */}
            <View style={s.hero}>
                <Text style={s.heroEmoji}>🧺</Text>
                <Text style={s.heroTitle}>Fresh & Clean,{'\n'}On Demand</Text>
                <Text style={s.heroSub}>Select your service type below</Text>
            </View>

            {/* Service selector */}
            <View style={s.serviceGrid}>
                {SERVICES.map(service => {
                    const active = selectedService.id === service.id;
                    return (
                        <TouchableOpacity
                            key={service.id}
                            style={[s.serviceCard, active && s.serviceCardActive]}
                            onPress={() => { setSelectedService(service); Haptics.selectionAsync(); }}
                            activeOpacity={0.85}
                        >
                            <BlurView intensity={25} style={StyleSheet.absoluteFillObject} tint="dark" />
                            {active && (
                                <LinearGradient
                                    colors={['rgba(123,97,255,0.2)', 'rgba(0,255,255,0.05)']}
                                    style={StyleSheet.absoluteFillObject}
                                />
                            )}
                            <Text style={s.serviceIcon}>{service.icon}</Text>
                            <Text style={[s.serviceLabel, active && s.serviceLabelActive]}>{service.label}</Text>
                            <Text style={s.serviceRate}>
                                From ${(service.baseRate / 100).toFixed(2)}/lb TTD
                            </Text>
                            {active && (
                                <View style={s.activeDot} />
                            )}
                        </TouchableOpacity>
                    );
                })}
            </View>

            {/* Features */}
            <View style={s.featureRow}>
                {['Pickup Today', '24h Return', 'Fragrance-Free'].map(feat => (
                    <View key={feat} style={s.featurePill}>
                        <Text style={s.featureText}>{feat}</Text>
                    </View>
                ))}
            </View>

            {/* CTA */}
            <View style={[s.ctaContainer, { paddingBottom: insets.bottom + 20 }]}>
                {isProcessingAI && <LoadingOverlay message="AI IS ANALYZING BUNDLE..." color="#00FFFF" />}
                
                {!isProcessingAI && (
                    <>
                        <TouchableOpacity style={s.aiButton} onPress={handleAITakePhoto} activeOpacity={0.88}>
                            <View style={s.aiIconWrap}>
                                <Ionicons name="camera" size={20} color="#00FFFF" />
                            </View>
                            <Text style={s.aiButtonText}>AI Photo Intake</Text>
                        </TouchableOpacity>

                        <TouchableOpacity style={s.ctaButton} onPress={handleNext} activeOpacity={0.88}>
                            <LinearGradient
                                colors={['#7C3AED', '#5A2DDE']}
                                start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                                style={s.ctaGradient}
                            >
                                <Text style={s.ctaText}>Estimate Price Manually →</Text>
                            </LinearGradient>
                        </TouchableOpacity>
                    </>
                )}
            </View>
        </LinearGradient>
    );
}

const s = StyleSheet.create({
    container: { flex: 1 },
    header: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 20, paddingBottom: 12,
    },
    backBtn: {
        width: 38, height: 38, borderRadius: 19,
        backgroundColor: 'rgba(255,255,255,0.1)',
        alignItems: 'center', justifyContent: 'center',
    },
    headerTitle: { fontSize: 20, fontWeight: '700', color: '#FFF' },
    hero: { alignItems: 'center', paddingVertical: 32, paddingHorizontal: 20 },
    heroEmoji: { fontSize: 72, marginBottom: 16 },
    heroTitle: { fontSize: 28, fontWeight: '900', color: '#FFF', textAlign: 'center', lineHeight: 36 },
    heroSub: { fontSize: 14, color: 'rgba(255,255,255,0.4)', marginTop: 10 },
    serviceGrid: { flexDirection: 'row', gap: 12, paddingHorizontal: 20 },
    serviceCard: {
        flex: 1, borderRadius: 22, overflow: 'hidden',
        borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
        padding: 18, alignItems: 'center', gap: 8,
        backgroundColor: 'rgba(255,255,255,0.04)',
    },
    serviceCardActive: { borderColor: '#7C3AED' },
    serviceIcon: { fontSize: 36 },
    serviceLabel: { fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.6)', textAlign: 'center' },
    serviceLabelActive: { color: '#FFF' },
    serviceRate: { fontSize: 11, color: 'rgba(255,255,255,0.35)', textAlign: 'center' },
    activeDot: {
        width: 8, height: 8, borderRadius: 4,
        backgroundColor: '#00FFFF', marginTop: 4,
    },
    featureRow: {
        flexDirection: 'row', justifyContent: 'center', gap: 10, paddingVertical: 24, paddingHorizontal: 20,
    },
    featurePill: {
        paddingHorizontal: 14, paddingVertical: 6, borderRadius: 50,
        backgroundColor: 'rgba(0,255,255,0.1)',
        borderWidth: 1, borderColor: 'rgba(0,255,255,0.25)',
    },
    featureText: { fontSize: 12, color: '#00FFFF', fontWeight: '600' },
    ctaContainer: { paddingHorizontal: 20, paddingTop: 8, marginTop: 'auto' },
    ctaButton: { borderRadius: 20, overflow: 'hidden' },
    ctaGradient: {
        alignItems: 'center', justifyContent: 'center', paddingVertical: 18,
    },
    ctaText: { fontSize: 17, fontWeight: '800', color: '#FFF' },
    aiButton: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        paddingVertical: 18, borderRadius: 20,
        backgroundColor: 'rgba(0,255,255,0.05)',
        borderWidth: 1, borderColor: 'rgba(0,255,255,0.2)',
        marginBottom: 12, gap: 10,
    },
    aiIconWrap: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(0,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
    aiButtonText: { fontSize: 17, fontWeight: '800', color: '#00FFFF', letterSpacing: 0.5 },
    aiLoadingBlock: { alignItems: 'center', paddingVertical: 20 },
    loadingDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#00FFFF', marginBottom: 10 },
    aiLoadingText: { fontSize: 13, fontWeight: '800', color: '#00FFFF', letterSpacing: 1.5 },
});
