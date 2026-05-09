import React, { useState, useEffect } from 'react';
import {
    View, Text, TouchableOpacity, StyleSheet,
    Alert, Dimensions, FlatList, ActivityIndicator
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
    const [merchants, setMerchants] = useState<any[]>([]);
    const [selectedMerchant, setSelectedMerchant] = useState<any | null>(null);
    const [loadingMerchants, setLoadingMerchants] = useState(true);

    useEffect(() => {
        fetchLaundryMerchants();
    }, []);

    const fetchLaundryMerchants = async () => {
        try {
            const { data, error } = await supabase
                .from('merchants')
                .select('*')
                .eq('category', 'laundry')
                .eq('is_active', true);
            
            if (error) throw error;
            setMerchants(data || []);
            if (data?.length > 0) setSelectedMerchant(data[0]);
        } catch (err) {
            Alert.alert("Error", "Could not load laundry providers.");
        } finally {
            setLoadingMerchants(false);
        }
    };

    const handleNext = () => {
        if (!selectedMerchant) {
            Alert.alert("Selection Required", "Please select a laundry provider first.");
            return;
        }
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        navigation.navigate('LaundryEstimator', { 
            service: selectedService,
            merchant: selectedMerchant 
        });
    };

    const handleAITakePhoto = async () => {
        if (!selectedMerchant) {
            Alert.alert("Selection Required", "Select a provider before photo intake.");
            return;
        }
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
                setTimeout(() => {
                    setIsProcessingAI(false);
                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                    navigation.navigate('LaundryEstimator', { 
                        service: selectedService, 
                        merchant: selectedMerchant,
                        photoUrl: result.assets[0].uri,
                        aiList: [{ name: "AI Bundle", qty: 1 }]
                    });
                }, 2000);
            } catch (err) {
                Alert.alert("Error", "Failed to process image.");
                setIsProcessingAI(false);
            }
        }
    };

    const renderMerchant = ({ item }: { item: any }) => (
        <TouchableOpacity 
            style={[s.mCard, selectedMerchant?.id === item.id && s.mCardActive]}
            onPress={() => { setSelectedMerchant(item); Haptics.selectionAsync(); }}
        >
            <BlurView intensity={20} style={StyleSheet.absoluteFillObject} tint="dark" />
            <Text style={s.mName}>{item.name}</Text>
            <Text style={s.mSub}>{item.address.split(',')[0]}</Text>
            {selectedMerchant?.id === item.id && <Ionicons name="checkmark-circle" size={16} color="#00FFFF" style={s.mCheck} />}
        </TouchableOpacity>
    );

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

            {/* Merchant Selection */}
            <View style={s.section}>
                <Text style={s.sectionTitle}>SELECT PROVIDER</Text>
                {loadingMerchants ? (
                    <ActivityIndicator color="#00FFFF" style={{ height: 100 }} />
                ) : (
                    <FlatList
                        horizontal
                        data={merchants}
                        renderItem={renderMerchant}
                        keyExtractor={item => item.id}
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={{ paddingHorizontal: 20, gap: 12 }}
                    />
                )}
            </View>

            {/* Service selector */}
            <View style={s.section}>
                <Text style={s.sectionTitle}>SERVICE TYPE</Text>
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
                                <Text style={s.serviceIcon}>{service.icon}</Text>
                                <Text style={[s.serviceLabel, active && s.serviceLabelActive]}>{service.label}</Text>
                            </TouchableOpacity>
                        );
                    })}
                </View>
            </View>

            {/* Features */}
            <View style={s.featureRow}>
                {['Pickup Today', '24h Return', 'Pro Handling'].map(feat => (
                    <View key={feat} style={s.featurePill}>
                        <Text style={s.featureText}>{feat}</Text>
                    </View>
                ))}
            </View>

            {/* CTA */}
            <View style={[s.ctaContainer, { paddingBottom: insets.bottom + 20 }]}>
                {isProcessingAI && <LoadingOverlay message="AI ANALYZING..." color="#00FFFF" />}
                
                {!isProcessingAI && (
                    <>
                        <TouchableOpacity style={s.aiButton} onPress={handleAITakePhoto} activeOpacity={0.88}>
                            <Ionicons name="camera" size={20} color="#00FFFF" />
                            <Text style={s.aiButtonText}>AI Smart Scan</Text>
                        </TouchableOpacity>

                        <TouchableOpacity style={s.ctaButton} onPress={handleNext} activeOpacity={0.88}>
                            <LinearGradient
                                colors={['#7C3AED', '#5A2DDE']}
                                style={s.ctaGradient}
                            >
                                <Text style={s.ctaText}>Continue to Estimate →</Text>
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
    section: { marginTop: 24, gap: 12 },
    sectionTitle: { fontSize: 10, fontWeight: '900', color: 'rgba(255,255,255,0.4)', letterSpacing: 2, paddingHorizontal: 24 },
    mCard: {
        width: 160, height: 100, borderRadius: 20, overflow: 'hidden', padding: 16,
        borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
        backgroundColor: 'rgba(255,255,255,0.04)',
    },
    mCardActive: { borderColor: '#00FFFF', backgroundColor: 'rgba(0,255,255,0.05)' },
    mName: { fontSize: 14, fontWeight: '700', color: '#FFF' },
    mSub: { fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 4 },
    mCheck: { position: 'absolute', top: 12, right: 12 },
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
    ctaGradient: { alignItems: 'center', justifyContent: 'center', paddingVertical: 18 },
    ctaText: { fontSize: 17, fontWeight: '800', color: '#FFF' },
    aiButton: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        paddingVertical: 18, borderRadius: 20,
        backgroundColor: 'rgba(0,255,255,0.05)',
        borderWidth: 1, borderColor: 'rgba(0,255,255,0.2)',
        marginBottom: 12, gap: 10,
    },
    aiButtonText: { fontSize: 17, fontWeight: '800', color: '#00FFFF' },
});
