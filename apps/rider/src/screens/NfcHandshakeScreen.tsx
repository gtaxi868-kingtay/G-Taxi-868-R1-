import React, { useEffect, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, ActivityIndicator, useWindowDimensions, Alert } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import Reanimated, { FadeInUp } from 'react-native-reanimated';
const Nfc = {
    requestTechnologyAsync: async (): Promise<{ id: string } | null> => {
        return null;
    },
};
import { Txt } from '@/design-system/primitives';
import { supabase } from '@gtaxi/core';
import { ghostBorder, glassSurface } from '@gtaxi/design-system/utils/style-rules';
import { SURFACE, VOICES } from '@gtaxi/design-system';

const CYAN = '#06B6D4';

export function NfcHandshakeScreen({ route, navigation }: any) {
    const { width } = useWindowDimensions();
    const { tagUid } = route.params || {};
    const [loading, setLoading] = useState(true);
    const [handshake, setHandshake] = useState<any>(null);
    const [selectedServices, setSelectedServices] = useState<string[]>([]);

    useEffect(() => {
        if (tagUid) {
            handleHandshake();
        } else {
            scanNfcTag();
        }
        
        return () => {
        };
    }, [tagUid]);

    const scanNfcTag = async () => {
        try {
            const tag = await Nfc.requestTechnologyAsync();
            if (tag && tag.id) {
                handleHandshakeWithTag(tag.id);
            }
        } catch (ex) {
            setLoading(false);
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
            latitude: handshake.pickup_lat ?? handshake.pickupCoords?.lat ?? handshake.pickupCoords?.latitude ?? 0,
            longitude: handshake.pickup_lng ?? handshake.pickupCoords?.lng ?? handshake.pickupCoords?.longitude ?? 0,
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
                <ActivityIndicator size="large" color={VOICES.rider.accent} />
                <Txt style={s.loadingText}>Establishing Unified Handshake...</Txt>
            </View>
        );
    }

    if (!handshake || handshake.type !== 'KIOSK_HANDSHAKE') {
        return (
            <View style={s.container}>
                <Ionicons name="warning" size={64} color="#FF6E84" />
                <Txt style={s.errorText}>Invalid G-Taxi Node</Txt>
                <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
                    <Txt style={{ color: '#FFFFFF' }}>Back</Txt>
                </TouchableOpacity>
            </View>
        );
    }

    return (
        <View style={s.container}>
            <LinearGradient colors={[VOICES.rider.accent, CYAN]} style={StyleSheet.absoluteFillObject} />
            
            <Reanimated.View entering={FadeInUp} style={s.content}>
                <View style={s.glassCard}>
                    <View style={[StyleSheet.absoluteFillObject, glassSurface(40, 0.2)]} />
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
                                    color={selectedServices.includes(service.id) ? VOICES.rider.accent : 'rgba(174, 169, 181, 0.45)'} 
                                />
                                <Txt style={s.serviceName}>{service.name}</Txt>
                                <Txt style={s.serviceCategory}>{service.category.toUpperCase()}</Txt>
                            </TouchableOpacity>
                        ))}
                    </View>

                    <TouchableOpacity onPress={confirmRide} style={s.confirmBtn}>
                        <LinearGradient colors={[VOICES.rider.accent, CYAN]} style={s.btnGradient}>
                            <Txt style={s.confirmText}>Confirm & Book Ride</Txt>
                        </LinearGradient>
                    </TouchableOpacity>
                </View>
            </Reanimated.View>
        </View>
    );
}

const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: SURFACE.base, justifyContent: 'center', alignItems: 'center' },
    loadingText: { marginTop: 20, color: '#AEA9B5' },
    content: { width: '90%', alignItems: 'center' },
    glassCard: { width: '100%', borderRadius: 32, padding: 24, overflow: 'hidden', ...ghostBorder(0.2), backgroundColor: 'rgba(255,255,255,0.04)' },
    welcomeTitle: { fontSize: 24, fontWeight: '800', textAlign: 'center', marginBottom: 12 },
    aiMessage: { fontSize: 18, color: '#AEA9B5', textAlign: 'center', lineHeight: 28 },
    divider: { height: 1, backgroundColor: 'rgba(119, 116, 127, 0.15)', marginVertical: 24 },
    sectionLabel: { fontSize: 14, fontWeight: '600', color: 'rgba(174, 169, 181, 0.45)', marginBottom: 16 },
    serviceGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
    serviceItem: { width: '48%', backgroundColor: 'rgba(255,255,255,0.4)', borderRadius: 16, padding: 16, alignItems: 'center', marginBottom: 12, ...ghostBorder(0) },
    serviceItemActive: { borderColor: VOICES.rider.accent, backgroundColor: 'rgba(79, 134, 247, 0.1)' },
    serviceName: { fontSize: 14, fontWeight: '700', marginTop: 8 },
    serviceCategory: { fontSize: 10, color: 'rgba(174, 169, 181, 0.45)', marginTop: 4 },
    confirmBtn: { width: '100%', height: 64, borderRadius: 32, marginTop: 24, overflow: 'hidden' },
    btnGradient: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    confirmText: { color: '#FFFFFF', fontSize: 18, fontWeight: '800' },
    errorText: { marginTop: 20, fontSize: 20, color: '#FF6E84' },
    backBtn: { marginTop: 24, padding: 16 },
});
