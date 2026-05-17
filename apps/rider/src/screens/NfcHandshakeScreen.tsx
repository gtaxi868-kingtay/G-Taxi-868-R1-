import React, { useEffect, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, ActivityIndicator, Dimensions, Alert } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import Reanimated, { FadeInUp, ZoomIn } from 'react-native-reanimated';
import NfcManager, { NfcTech } from 'react-native-nfc-manager';
import { Txt } from '@/design-system/primitives';
import { tokens } from '@/design-system/tokens';
import { supabase } from '@gtaxi/native';

const { width } = Dimensions.get('window');

export function NfcHandshakeScreen({ route, navigation }: any) {
    const { tagUid } = route.params || {};
    const [loading, setLoading] = useState(true);
    const [handshake, setHandshake] = useState<any>(null);
    const [selectedServices, setSelectedServices] = useState<string[]>([]);

    useEffect(() => {
        if (tagUid) {
            handleHandshake();
        } else {
            // No tag provided, start NFC scanning
            scanNfcTag();
        }
        
        return () => {
            // Cleanup NFC when screen unmounts
            NfcManager.cancelTechnologyRequest();
        };
    }, [tagUid]);

    const scanNfcTag = async () => {
        try {
            await NfcManager.start();
            await NfcManager.requestTechnology(NfcTech.Ndef);
            const tag = await NfcManager.getTag();
            if (tag && tag.id) {
                handleHandshakeWithTag(tag.id);
            }
        } catch (ex) {
            console.warn('NFC Scan cancelled or failed', ex);
            setLoading(false);
        } finally {
            NfcManager.cancelTechnologyRequest();
        }
    };

    const handleHandshakeWithTag = async (scannedTagUid: string) => {
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) {
                Alert.alert('Sign In Required', 'Please sign in to use NFC ride booking.');
                setLoading(false);
                return;
            }

            const { data, error } = await supabase.functions.invoke('nfc_event_handler', {
                body: {
                    tag_uid: scannedTagUid,
                    profile_id: session.user.id,
                },
            });

            if (error || data?.error) {
                Alert.alert('Error', data?.error || error?.message || 'NFC handshake failed');
            } else {
                setHandshake(data);
            }
        } catch (error) {
            console.error('Handshake failed', error);
            Alert.alert('Connection Failed', 'Could not connect to taxi stand. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    const handleHandshake = async () => {
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) {
                Alert.alert('Sign In Required', 'Please sign in to use NFC ride booking.');
                return;
            }

            const { data, error } = await supabase.functions.invoke('nfc_event_handler', {
                body: {
                    tag_uid: tagUid,
                    profile_id: session.user.id,
                },
            });

            if (error || data?.error) {
                Alert.alert('Error', data?.error || error?.message || 'NFC handshake failed');
                return;
            }
            setHandshake(data);
        } catch (error) {
            console.error('Handshake failed', error);
        } finally {
            setLoading(false);
        }
    };

    const toggleService = (serviceId: string) => {
        setSelectedServices(prev => 
            prev.includes(serviceId) ? prev.filter(id => id !== serviceId) : [...prev, serviceId]
        );
    };

    const confirmRide = () => {
        const pickup = {
            latitude: handshake.pickup_lat || handshake.pickupCoords?.latitude || 0,
            longitude: handshake.pickup_lng || handshake.pickupCoords?.longitude || 0,
            address: handshake.locationName || 'G-Taxi NFC Kiosk',
        };

        navigation.navigate('DestinationSearch', {
            currentLocation: pickup,
            source: 'nfc_kiosk',
            kioskId: handshake.kiosk_id || handshake.kioskId,
            sourceMetadata: {
                kioskId: handshake.kiosk_id || handshake.kioskId,
                locationName: handshake.locationName,
                selectedServices,
                tagUid,
            },
        });
    };

    if (loading) {
        return (
            <View style={s.container}>
                <ActivityIndicator size="large" color={tokens.colors.primary.purple} />
                <Txt style={s.loadingText}>Establishing Unified Handshake...</Txt>
            </View>
        );
    }

    if (!handshake || handshake.type !== 'KIOSK_HANDSHAKE') {
        return (
            <View style={s.container}>
                <Ionicons name="warning" size={64} color={tokens.colors.status.error} />
                <Txt style={s.errorText}>Invalid G-Taxi Node</Txt>
                <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
                    <Txt style={{ color: tokens.colors.text.inverse }}>Back</Txt>
                </TouchableOpacity>
            </View>
        );
    }

    return (
        <View style={s.container}>
            <LinearGradient colors={tokens.colors.primary.gradient} style={StyleSheet.absoluteFillObject} />
            
            <Reanimated.View entering={FadeInUp} style={s.content}>
                <BlurView intensity={40} tint="light" style={s.glassCard}>
                    <Txt style={s.welcomeTitle}>Unified Handshake Success</Txt>
                    <Txt style={s.aiMessage}>{handshake.welcomeMessage}</Txt>
                    
                    <View style={s.divider} />

                    <Txt style={s.sectionLabel}>Add Quick Logistics Stops:</Txt>
                    <View style={s.serviceGrid}>
                        {handshake.availableServices.map((service: any) => (
                            <TouchableOpacity 
                                key={service.id}
                                onPress={() => toggleService(service.id)}
                                style={[s.serviceItem, selectedServices.includes(service.id) && s.serviceItemActive]}
                            >
                                <Ionicons 
                                    name={service.icon} 
                                    size={32} 
                                    color={selectedServices.includes(service.id) ? tokens.colors.primary.purple : tokens.colors.text.tertiary} 
                                />
                                <Txt style={s.serviceName}>{service.name}</Txt>
                                <Txt style={s.serviceCategory}>{service.category.toUpperCase()}</Txt>
                            </TouchableOpacity>
                        ))}
                    </View>

                    <TouchableOpacity onPress={confirmRide} style={s.confirmBtn}>
                        <LinearGradient colors={tokens.colors.primary.gradient} style={s.btnGradient}>
                            <Txt style={s.confirmText}>Confirm & Book Ride</Txt>
                        </LinearGradient>
                    </TouchableOpacity>
                </BlurView>
            </Reanimated.View>
        </View>
    );
}

const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: tokens.colors.background.base, justifyContent: 'center', alignItems: 'center' },
    loadingText: { marginTop: 20, color: tokens.colors.text.secondary },
    content: { width: '90%', alignItems: 'center' },
    glassCard: { width: '100%', borderRadius: 32, padding: 24, overflow: 'hidden', borderWidth: 1, borderColor: tokens.colors.glass.stroke },
    welcomeTitle: { fontSize: 24, fontWeight: '800', textAlign: 'center', marginBottom: 12 },
    aiMessage: { fontSize: 18, color: tokens.colors.text.secondary, textAlign: 'center', lineHeight: 28 },
    divider: { height: 1, backgroundColor: tokens.colors.border.subtle, marginVertical: 24 },
    sectionLabel: { fontSize: 14, fontWeight: '600', color: tokens.colors.text.tertiary, marginBottom: 16 },
    serviceGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
    serviceItem: { width: '48%', backgroundColor: 'rgba(255,255,255,0.4)', borderRadius: 16, padding: 16, alignItems: 'center', marginBottom: 12, borderWidth: 1, borderColor: 'transparent' },
    serviceItemActive: { borderColor: tokens.colors.primary.purple, backgroundColor: 'rgba(79, 134, 247, 0.1)' },
    serviceName: { fontSize: 14, fontWeight: '700', marginTop: 8 },
    serviceCategory: { fontSize: 10, color: tokens.colors.text.tertiary, marginTop: 4 },
    confirmBtn: { width: '100%', height: 64, borderRadius: 32, marginTop: 24, overflow: 'hidden' },
    btnGradient: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    confirmText: { color: tokens.colors.text.inverse, fontSize: 18, fontWeight: '800' },
    errorText: { marginTop: 20, fontSize: 20, color: tokens.colors.status.error },
    backBtn: { marginTop: 24, padding: 16 },
});
