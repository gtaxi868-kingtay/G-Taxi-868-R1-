import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
    Alert, ScrollView, useWindowDimensions, Platform, Linking
} from 'react-native';
import MapView, { Marker, PROVIDER_DEFAULT, UrlTile } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { initializeSupabaseClient, ENV } from '@gtaxi/core';
import { estimateFare, createRide, getWalletBalance } from '../services/api';
import { SURFACE, VOICES, ANIMATION, GlassCard } from '@gtaxi/design-system';
import { ghostBorder, elevationGlow, glassSurface } from '@gtaxi/design-system/utils/style-rules';
import { formatTTDDollars } from '../utils/currency';

const { supabase, getSupabase } = initializeSupabaseClient('native');

const CYAN = '#00E5FF';
const CYAN_SOFT = 'rgba(0,229,255,0.1)';
const WARNING = '#F59E0B';
const ERROR = '#EF4444';
const SUCCESS = '#00FF94';

interface StopSuggestion {
    place_name: string;
    place_address: string;
    lat: number;
    lng: number;
    stop_type: string;
    emoji: string;
    estimated_wait_minutes: number;
    is_preferred: boolean;
    is_network_partner?: boolean;
    merchant_id?: string;
}

const VEHICLES = [
    { type: 'Standard', multiplier: 1.0, icon: 'car-outline', desc: 'Daily logistics' },
    { type: 'XL', multiplier: 1.5, icon: 'bus-outline', desc: 'Group & Bulk' },
    { type: 'Premium', multiplier: 2.2, icon: 'star-outline', desc: 'Executive Pro' },
] as const;

type VehicleType = (typeof VEHICLES)[number]['type'];

export function RideConfirmationScreen({ navigation, route }: any) {
    const { height } = useWindowDimensions();
    const { destination, pickup, source, sourceMetadata, kioskId, taxiStandId } = route.params;
    const insets = useSafeAreaInsets();
    const mapRef = useRef<MapView>(null);
    const cameraRef = useRef<CameraView>(null);

    const [loading, setLoading] = useState(true);
    const [fare, setFare] = useState<any>(null);
    const [selectedType, setSelectedType] = useState<VehicleType>('Standard');
    const [confirming, setConfirming] = useState(false);
    const [paymentMethod, setPaymentMethod] = useState<'cash' | 'wallet'>('cash');
    const [walletBalance, setWalletBalance] = useState<number>(0);

    const [requestStatus, setRequestStatus] = useState<'idle' | 'connecting' | 'still_trying' | 'failed'>('idle');
    const [retryCount, setRetryCount] = useState(0);
    const requestTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    const [stopSuggestions, setStopSuggestions] = useState<StopSuggestion[]>([]);
    const [selectedStops, setSelectedStops] = useState<StopSuggestion[]>([]);
    const [bookForFamily, setBookForFamily] = useState(false);
    const [selfieMode, setSelfieMode] = useState(false);
    const [selfieUri, setSelfieUri] = useState<string | null>(null);
    const [selfieVerified, setSelfieVerified] = useState(false);
    const [selfieUploading, setSelfieUploading] = useState(false);
    const [selfieError, setSelfieError] = useState<string | null>(null);
    const [cameraPermission, requestCameraPermission] = useCameraPermissions();

    const pickupLoc = pickup || { latitude: 10.66, longitude: -61.51, address: 'Current Location' };

    const fitMapTimeout = useRef<NodeJS.Timeout | null>(null);
    const stopsTimerRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        fetchData();
        return () => {
            if (fitMapTimeout.current) clearTimeout(fitMapTimeout.current);
            if (stopsTimerRef.current) clearTimeout(stopsTimerRef.current);
        };
    }, []);

    const fetchFare = async (stops: StopSuggestion[]) => {
        const res = await estimateFare({
            pickup_lat: pickupLoc.latitude,
            pickup_lng: pickupLoc.longitude,
            dropoff_lat: destination.latitude,
            dropoff_lng: destination.longitude,
            stops: stops.map(s => ({
                stop_type: s.stop_type,
                estimated_wait_minutes: s.estimated_wait_minutes,
            })),
        });
        if (res.success) setFare(res.data);
    };

    const fetchData = async () => {
        if (!destination?.latitude || !destination?.longitude) {
            Alert.alert("Destination Required", "Choose where you are going before confirming the ride.");
            navigation.replace('DestinationSearch', {
                currentLocation: pickupLoc,
                source,
                sourceMetadata,
                kioskId,
                taxiStandId,
            });
            return;
        }

        setLoading(true);
        try {
            const [fareRes, balanceRes] = await Promise.all([
                estimateFare({
                    pickup_lat: pickupLoc.latitude,
                    pickup_lng: pickupLoc.longitude,
                    dropoff_lat: destination.latitude,
                    dropoff_lng: destination.longitude,
                }),
                getWalletBalance()
            ]);

            if (fareRes.success) setFare(fareRes.data);
            if (balanceRes.success) setWalletBalance(balanceRes.data || 0);

            const { data: stopsRes } = await supabase.functions.invoke("suggest_stops", {
                body: {
                    pickup_lat: pickupLoc.latitude,
                    pickup_lng: pickupLoc.longitude,
                    dropoff_lat: destination.latitude,
                    dropoff_lng: destination.longitude,
                }
            });
            if (stopsRes?.success && stopsRes.data?.suggestions) {
                setStopSuggestions(stopsRes.data.suggestions);
            }

            fitMapTimeout.current = setTimeout(() => {
                mapRef.current?.fitToCoordinates([pickupLoc, destination], {
                    edgePadding: { top: 80, right: 80, bottom: 80, left: 80 },
                    animated: true,
                });
            }, 500);
        } catch (err) {
            Alert.alert("Error", "Could not load ride details");
        } finally {
            setLoading(false);
        }
    };

    const toggleStop = (stop: StopSuggestion) => {
        setSelectedStops(prev => {
            const isSelected = prev.some(s => s.place_name === stop.place_name);
            if (isSelected) {
                return prev.filter(s => s.place_name !== stop.place_name);
            } else {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                return [...prev, stop];
            }
        });
    };

    const handleBookService = (stop: StopSuggestion) => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        navigation.navigate('ServiceBooking', {
            merchantId: stop.merchant_id,
            merchantName: stop.place_name,
            pickup: pickupLoc,
            destination: { latitude: stop.lat, longitude: stop.lng, address: stop.place_address }
        });
    };

    const handleSelfieCapture = async () => {
        if (!cameraRef.current) return;
        try {
            const photo = await cameraRef.current.takePictureAsync({ quality: 0.7 });
            if (!photo || !photo.uri) {
                setSelfieError('Failed to capture photo');
                return;
            }
            setSelfieUploading(true);
            setSelfieError(null);

            const userId = (await supabase.auth.getUser()).data.user?.id || 'unknown';
            const fileName = `selfies/${userId}/${Date.now()}.jpg`;

            const response = await fetch(photo.uri);
            const blob = await response.blob();

            const { data: uploadData, error: uploadError } = await supabase.storage
                .from('verification-photos')
                .upload(fileName, blob, { contentType: 'image/jpeg' });

            if (uploadError) {
                setSelfieError('Upload failed: ' + uploadError.message);
                setSelfieUploading(false);
                return;
            }

            const { data: urlData } = supabase.storage
                .from('verification-photos')
                .getPublicUrl(fileName);

            setSelfieUri(urlData?.publicUrl || null);
            setSelfieVerified(true);
            setSelfieUploading(false);
            setSelfieMode(false);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } catch (err: any) {
            setSelfieError('Camera error: ' + (err.message || 'Unknown error'));
            setSelfieUploading(false);
        }
    };

    const handleConfirm = async () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

        if (!selfieVerified || !selfieUri) {
            setSelfieError('Identity verification required before confirming ride.');
            Alert.alert('Verification Required', 'Please complete identity verification before confirming your ride.');
            return;
        }

        setConfirming(true);
        setRequestStatus('connecting');

        if (requestTimeoutRef.current) clearTimeout(requestTimeoutRef.current);
        if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);

        requestTimeoutRef.current = setTimeout(() => {
            setRequestStatus('still_trying');
        }, 5000);

        retryTimeoutRef.current = setTimeout(() => {
            if (retryCount === 0) {
                console.log('RIDE REQUEST: Auto-retrying after 10s');
                setRetryCount(1);
                executeRideRequest();
            }
        }, 10000);

        await executeRideRequest();
    };

    const executeRideRequest = async () => {
        try {
            const res = await createRide({
                pickup_lat: pickupLoc.latitude,
                pickup_lng: pickupLoc.longitude,
                pickup_address: source === 'nfc_kiosk' ? (sourceMetadata?.locationName || 'NFC Kiosk') :
                                source === 'qr_stand' ? (sourceMetadata?.stand || sourceMetadata?.standName || 'Taxi Stand') :
                                pickupLoc.address,
                dropoff_lat: destination.latitude,
                dropoff_lng: destination.longitude,
                dropoff_address: destination.address,
                vehicle_type: selectedType,
                payment_method: paymentMethod,
                source: source || 'app',
                source_metadata: sourceMetadata,
                kiosk_id: kioskId,
                taxi_stand_id: taxiStandId,
                identity_verified: true,
                verification_url: selfieUri,
                stops: selectedStops.map((s, i) => ({
                    stop_order: i + 1,
                    place_name: s.place_name,
                    place_address: s.place_address,
                    lat: s.lat,
                    lng: s.lng,
                    stop_type: s.stop_type,
                    estimated_wait_minutes: s.estimated_wait_minutes,
                })),
            });

            if (res.success && res.data) {
                if (requestTimeoutRef.current) clearTimeout(requestTimeoutRef.current);
                if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
                setRequestStatus('idle');
                setRetryCount(0);
                navigation.replace('SearchingDriver', {
                    rideId: res.data.ride_id,
                    destination,
                    fare: { ...fare, total_fare_cents: displayFareCents },
                    pickup: pickupLoc
                });
            } else {
                throw new Error(res.error || 'Failed to create ride');
            }
        } catch (err: any) {
            console.error('Ride request failed:', err);
            if (retryCount >= 1) {
                setRequestStatus('failed');
                setConfirming(false);
            } else {
                setRequestStatus('still_trying');
            }
        }
    };

    const handleRetry = () => {
        setRetryCount(0);
        setRequestStatus('idle');
        handleConfirm();
    };

    const openWhatsAppFallback = () => {
        const message = encodeURIComponent(`I need a ride from ${pickupLoc.address} to ${destination.address}`);
        Linking.openURL(`https://wa.me/18687031000?text=${message}`);
    };

    useEffect(() => {
        return () => {
            if (requestTimeoutRef.current) clearTimeout(requestTimeoutRef.current);
            if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
        };
    }, []);

    useEffect(() => {
        if (selectedStops.length > 0) {
            if (stopsTimerRef.current) clearTimeout(stopsTimerRef.current);
            stopsTimerRef.current = setTimeout(() => {
                fetchFare(selectedStops);
            }, 400);
        }
        return () => {
            if (stopsTimerRef.current) clearTimeout(stopsTimerRef.current);
        };
    }, [selectedStops]);

    const multiplier = useMemo(
        () => VEHICLES.find(v => v.type === selectedType)?.multiplier ?? 1.0,
        [selectedType]
    );
    const baseFareCents = fare ? fare.total_fare_cents : 0;
    const displayFareCents = Math.round(baseFareCents * multiplier);
    const finalFare = fare ? (displayFareCents / 100).toFixed(2) : '--';

    return (
        <View style={s.root} pointerEvents="box-none">
            <StatusBar style="dark" />

            <View style={{ height: height * 0.35 }}>
                <MapView
                    ref={mapRef}
                    style={StyleSheet.absoluteFillObject}
                    provider={PROVIDER_DEFAULT}
                    userInterfaceStyle="light"
                >
                    {ENV.MAPBOX_PUBLIC_TOKEN && (
                        <UrlTile
                            urlTemplate={`https://api.mapbox.com/styles/v1/mapbox/light-v11/tiles/256/{z}/{x}/{y}@2x?access_token=${ENV.MAPBOX_PUBLIC_TOKEN}`}
                            shouldReplaceMapContent={true}
                        />
                    )}
                    <Marker coordinate={pickupLoc}><View style={s.markerPickup} /></Marker>
                    <Marker coordinate={destination}><View style={s.markerDropoff} /></Marker>

                    {stopSuggestions.map((stop, index) => (
                        <Marker
                            key={`stop-${index}`}
                            coordinate={{ latitude: stop.lat, longitude: stop.lng }}
                            onPress={() => toggleStop(stop)}
                        >
                            <View style={{
                                backgroundColor: selectedStops.some(s => s.place_name === stop.place_name) 
                                    ? 'rgba(0, 229, 255, 0.9)' 
                                    : 'rgba(123, 92, 240, 0.8)',
                                borderRadius: 20,
                                padding: 6,
                                borderWidth: 1.5,
                                borderColor: '#FFF',
                                alignItems: 'center',
                                justifyContent: 'center'
                            }}>
                                <Text style={{ fontSize: 14 }}>{stop.emoji}</Text>
                            </View>
                        </Marker>
                    ))}
                </MapView>

                <TouchableOpacity
                    style={[s.backBtn, { top: insets.top + 10 }]}
                    onPress={() => navigation.goBack()}
                >
                    <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
                </TouchableOpacity>
            </View>

            <View style={s.bottomContainer}>
                <GlassCard variant="rider" style={s.panel}>
                    <View style={s.handle} />
                    
                    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}>
                        <View style={s.routeBox}>
                            <View style={s.routeRow}>
                                <View style={s.routeDot} />
                                <View style={{ flex: 1, marginLeft: 16 }}>
                                    <Text style={s.addrLabel}>PICKUP</Text>
                                    <Text style={s.addrText} numberOfLines={1}>
                                        {source === 'nfc_kiosk' ? (sourceMetadata?.locationName || 'NFC Kiosk') :
                                         source === 'qr_stand' ? (sourceMetadata?.stand || sourceMetadata?.standName || 'Taxi Stand') :
                                         pickupLoc?.address || 'Current Location'}
                                    </Text>
                                </View>
                            </View>
                            <View style={s.routeLine} />
                            <View style={s.routeRow}>
                                <View style={s.routeSquare} />
                                <View style={{ flex: 1, marginLeft: 16 }}>
                                    <Text style={s.addrLabel}>DESTINATION</Text>
                                    <Text style={s.addrText} numberOfLines={1}>
                                        {destination?.address || 'Destination'}
                                    </Text>
                                </View>
                            </View>
                        </View>

                        {fare && (
                            <View style={s.statsRow}>
                                <Text style={s.logisticsText}>
                                    LOGISTICS: {(fare?.distance_meters / 1000).toFixed(1)}KM · {Math.round(fare?.duration_seconds / 60)}MIN EST.
                                </Text>
                            </View>
                        )}

                        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.vehicleScroll} contentContainerStyle={{ paddingRight: 20 }}>
                            {VEHICLES.map(v => (
                                <TouchableOpacity
                                    key={v.type}
                                    style={[s.vehicleCard, selectedType === v.type && s.vehicleCardActive]}
                                    onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setSelectedType(v.type); }}
                                >
                                    <Ionicons name={v.icon as any} size={24} color={selectedType === v.type ? '#FFFFFF' : VOICES.rider.accent} />
                                    <Text style={[s.vehicleType, { color: selectedType === v.type ? '#FFFFFF' : '#FFFFFF' }]}>{v.type}</Text>
                                    <Text style={[s.vehicleMultiplier, { color: selectedType === v.type ? 'rgba(255,255,255,0.7)' : VOICES.rider.textMuted }]}>{v.multiplier}x</Text>
                                </TouchableOpacity>
                            ))}
                        </ScrollView>

                        {stopSuggestions.length > 0 && (
                            <View style={s.stopsSection}>
                                <Text style={s.sectionTitle}>SUGGESTED LOGISTICS STOPS</Text>
                                {stopSuggestions.map((stop, index) => {
                                    const isSelected = selectedStops.some(s => s.place_name === stop.place_name);
                                    return (
                                        <TouchableOpacity
                                            key={index}
                                            onPress={() => toggleStop(stop)}
                                            style={[s.stopItem, isSelected && s.stopItemActive]}
                                        >
                                            <View style={s.stopEmojiWrap}>
                                                <Text style={{ fontSize: 20 }}>{stop.emoji}</Text>
                                            </View>
                                            <View style={{ flex: 1, marginLeft: 12 }}>
                                                <Text style={s.stopName}>{stop.place_name}</Text>
                                                <Text style={s.stopSubtext}>
                                                    {stop.is_network_partner ? 'G-TAXI PARTNER · ' : ''}+{stop.estimated_wait_minutes}m wait
                                                </Text>
                                            </View>
                                            <View style={{ alignItems: 'flex-end' }}>
                                                {stop.is_network_partner ? (
                                                    <TouchableOpacity 
                                                        onPress={() => handleBookService(stop)}
                                                        style={{ backgroundColor: CYAN_SOFT, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, marginBottom: 4 }}
                                                    >
                                                        <Text style={s.bookServiceText}>BOOK SERVICE</Text>
                                                    </TouchableOpacity>
                                                ) : (
                                                    <Text style={[s.stopPrice, { color: isSelected ? CYAN : VOICES.rider.textMuted }]}>
                                                        +${(((stop.stop_type === 'grocery' ? (fare?.pricing_constants?.stop_base_grocery_cents ?? 3500) : stop.stop_type === 'pharmacy' ? (fare?.pricing_constants?.stop_base_pharmacy_cents ?? 2500) : (fare?.pricing_constants?.stop_base_other_cents ?? 1500)) + Math.round((stop.estimated_wait_minutes || 0) * (fare?.pricing_constants?.wait_fee_per_minute_cents ?? 95))) / 100).toFixed(2)}
                                                    </Text>
                                                )}
                                            </View>
                                        </TouchableOpacity>
                                    );
                                })}
                            </View>
                        )}

                        <View style={s.fareDisplay}>
                            <Text style={s.fareLabel}>TOTAL ESTIMATE</Text>
                            <Text style={s.fareValue}>{formatTTDDollars(parseFloat(finalFare))}</Text>
                        </View>

                        <View style={s.identityShield}>
                            <Ionicons name="shield-checkmark" size={20} color={CYAN} />
                            <Text style={s.identityText}>G-TAXI IDENTITY SHIELD ACTIVE</Text>
                        </View>

                        {selfieError && (
                            <View style={s.selfieErrorContainer}>
                                <Ionicons name="alert-circle" size={16} color={ERROR} />
                                <Text style={s.selfieErrorText}>{selfieError}</Text>
                            </View>
                        )}

                        <TouchableOpacity
                            style={[s.selfieBtn, selfieVerified && s.selfieBtnVerified]}
                            onPress={async () => {
                                if (selfieVerified) return;
                                if (!cameraPermission?.granted) {
                                    const perm = await requestCameraPermission();
                                    if (!perm.granted) {
                                        Alert.alert('Camera Required', 'Camera access is required for identity verification.');
                                        return;
                                    }
                                }
                                setSelfieMode(true);
                            }}
                        >
                            {selfieUploading ? (
                                <ActivityIndicator color={CYAN} size="small" />
                            ) : (
                                <Ionicons
                                    name={selfieVerified ? 'checkmark-circle' : 'camera-outline'}
                                    size={20}
                                    color={selfieVerified ? SUCCESS : CYAN}
                                />
                            )}
                            <Text style={[s.selfieBtnText, selfieVerified && { color: SUCCESS }]}>
                                {selfieUploading ? 'UPLOADING...' : selfieVerified ? 'PASSENGER VERIFIED' : 'VERIFY IDENTITY'}
                            </Text>
                        </TouchableOpacity>

                        {requestStatus === 'still_trying' && (
                            <View style={s.statusBanner}>
                                <Text style={s.statusTextAmber}>Still connecting... please wait</Text>
                            </View>
                        )}

                        {requestStatus === 'failed' && (
                            <View style={s.failureContainer}>
                                <Text style={s.failureTitle}>We're having trouble connecting right now.</Text>
                                <View style={s.failureButtons}>
                                    <TouchableOpacity style={s.retryBtn} onPress={handleRetry}>
                                        <Text style={s.retryBtnText}>Try Again</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity style={s.whatsappBtn} onPress={openWhatsAppFallback}>
                                        <Text style={s.whatsappBtnText}>Contact via WhatsApp</Text>
                                    </TouchableOpacity>
                                </View>
                            </View>
                        )}

                        {selfieMode && (
                            <View style={StyleSheet.absoluteFill}>
                                <CameraView
                                    ref={cameraRef}
                                    facing="front"
                                    style={StyleSheet.absoluteFill}
                                    onMountError={() => { Alert.alert('Camera Error', 'Could not open camera.'); setSelfieMode(false); }}
                                >
                                    <View style={{ flex: 1, justifyContent: 'flex-end', padding: 24, paddingBottom: 60 }}>
                                        <View style={{ backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 20, padding: 24, alignItems: 'center' }}>
                                            <Text style={{ color: '#FFF', fontSize: 16, fontWeight: '800', marginBottom: 8 }}>
                                                Identity Verification
                                            </Text>
                                            <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13, marginBottom: 20, textAlign: 'center' }}>
                                                Take a selfie to verify your identity before confirming the ride.
                                            </Text>
                                            <View style={{ flexDirection: 'row', gap: 12 }}>
                                                <TouchableOpacity
                                                    onPress={() => setSelfieMode(false)}
                                                    style={{ flex: 1, height: 48, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' }}
                                                >
                                                    <Text style={{ color: '#FFF', fontWeight: '700', fontSize: 13 }}>Cancel</Text>
                                                </TouchableOpacity>
                                                <TouchableOpacity
                                                    onPress={handleSelfieCapture}
                                                    disabled={selfieUploading}
                                                    style={{ flex: 2, height: 48, borderRadius: 24, backgroundColor: CYAN, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 }}
                                                >
                                                    {selfieUploading ? (
                                                        <ActivityIndicator color={SURFACE.base} size="small" />
                                                    ) : (
                                                        <>
                                                            <Ionicons name="camera" size={18} color={SURFACE.base} />
                                                            <Text style={{ color: SURFACE.base, fontWeight: '900', fontSize: 13 }}>CAPTURE & VERIFY</Text>
                                                        </>
                                                    )}
                                                </TouchableOpacity>
                                            </View>
                                        </View>
                                    </View>
                                </CameraView>
                            </View>
                        )}

                        <TouchableOpacity
                            style={[s.confirmBtn, (confirming || !selfieVerified || !selfieUri) && { opacity: 0.5 }]}
                            onPress={handleConfirm}
                            disabled={confirming || !selfieVerified || !selfieUri}
                        >
                            <LinearGradient
                                colors={[VOICES.rider.accent, CYAN]}
                                style={s.btnGradient}
                                start={{ x: 0, y: 0 }}
                                end={{ x: 1, y: 1 }}
                            >
                                {confirming ? <ActivityIndicator color={'#FFFFFF'} /> : (
                                    <Text style={s.confirmBtnText}>CONFIRM {selectedType.toUpperCase()}</Text>
                                )}
                            </LinearGradient>
                        </TouchableOpacity>
                    </ScrollView>
                </GlassCard>
            </View>
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: SURFACE.base },
    backBtn: { position: 'absolute', left: 20, width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', ...elevationGlow(3) },
    
    bottomContainer: { flex: 1, marginTop: -30 },
    panel: { flex: 1, borderTopLeftRadius: 32, borderTopRightRadius: 32, padding: 24, paddingBottom: 0, overflow: 'hidden' },
    handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: 24 },

    routeBox: { backgroundColor: SURFACE.containerLow, borderRadius: 20, padding: 20, marginBottom: 20, ...ghostBorder(0.2) },
    routeRow: { flexDirection: 'row', alignItems: 'center' },
    routeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: VOICES.rider.accent },
    routeSquare: { width: 8, height: 8, borderRadius: 2, backgroundColor: WARNING },
    routeLine: { width: 1.5, height: 15, backgroundColor: SURFACE.containerHigh, marginLeft: 3.25, marginVertical: 4 },
    addrLabel: { fontSize: 11, fontWeight: '700', color: VOICES.rider.textMuted, letterSpacing: 1, marginBottom: 4 },
    addrText: { fontSize: 15, fontWeight: '600', color: '#FFFFFF' },

    statsRow: { marginBottom: 24, alignItems: 'center' },
    logisticsText: { fontSize: 13, fontWeight: '600', color: VOICES.rider.textMuted, letterSpacing: 0.5 },
    
    vehicleScroll: { marginBottom: 32 },
    vehicleCard: { width: 110, height: 120, backgroundColor: SURFACE.containerLow, borderRadius: 20, padding: 16, marginRight: 12, alignItems: 'center', justifyContent: 'center', ...ghostBorder(0.2) },
    vehicleCardActive: { backgroundColor: VOICES.rider.accent, borderColor: CYAN },
    vehicleType: { marginTop: 8, fontSize: 14, fontWeight: '700' },
    vehicleMultiplier: { fontSize: 12, fontWeight: '600' },

    stopsSection: { marginBottom: 32 },
    sectionTitle: { fontSize: 12, fontWeight: '800', color: VOICES.rider.accent, letterSpacing: 1, marginBottom: 12 },
    stopItem: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.02)', marginBottom: 10, ...ghostBorder(0) },
    stopItemActive: { borderColor: VOICES.rider.accent, backgroundColor: 'rgba(210,187,255,0.05)' },
    stopEmojiWrap: { width: 44, height: 44, borderRadius: 12, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
    stopName: { fontSize: 15, fontWeight: '700', color: '#FFFFFF' },
    stopSubtext: { fontSize: 13, fontWeight: '500', color: VOICES.rider.textMuted },
    stopPrice: { fontSize: 15, fontWeight: '700' },
    bookServiceText: { fontSize: 12, fontWeight: '800', color: CYAN, letterSpacing: 0.5 },

    fareDisplay: { alignItems: 'center', marginBottom: 24 },
    fareLabel: { fontSize: 12, fontWeight: '600', color: VOICES.rider.textMuted, letterSpacing: 1, marginBottom: 4 },
    fareValue: { fontSize: 36, fontWeight: '900', color: VOICES.rider.accent },
    
    identityShield: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: CYAN_SOFT, paddingVertical: 8, paddingHorizontal: 16, borderRadius: 100, marginBottom: 12, alignSelf: 'center' },
    identityText: { marginLeft: 8, fontSize: 12, fontWeight: '800', color: CYAN, letterSpacing: 1 },
    selfieBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: SURFACE.containerLow, paddingVertical: 14, paddingHorizontal: 20, borderRadius: 16, marginBottom: 24, ...ghostBorder(0.2), gap: 8 },
    selfieBtnVerified: { backgroundColor: 'rgba(0,255,148,0.08)', ...ghostBorder(0.3) },
    selfieBtnText: { fontSize: 12, fontWeight: '800', color: CYAN, letterSpacing: 0.5 },
    selfieErrorContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(239,68,68,0.1)', paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, marginBottom: 12, gap: 8 },
    selfieErrorText: { fontSize: 12, fontWeight: '700', color: ERROR, flex: 1 },

    confirmBtn: { height: 60, borderRadius: 30, overflow: 'hidden', ...elevationGlow(6) },
    btnGradient: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    confirmBtnText: { fontSize: 16, fontWeight: '900', color: '#FFFFFF', letterSpacing: 0.5 },
    markerPickup: { width: 14, height: 14, borderRadius: 7, backgroundColor: CYAN, borderWidth: 2, borderColor: '#FFFFFF' },
    markerDropoff: { width: 14, height: 14, borderRadius: 7, backgroundColor: VOICES.rider.accent, borderWidth: 2, borderColor: '#FFFFFF' },

    statusBanner: {
        backgroundColor: 'rgba(245, 158, 11, 0.15)',
        paddingVertical: 12,
        paddingHorizontal: 20,
        borderRadius: 12,
        marginBottom: 16,
        ...ghostBorder(0.2),
        alignItems: 'center'
    },
    statusTextAmber: {
        color: WARNING,
        fontSize: 14,
        fontWeight: '700'
    },
    failureContainer: {
        backgroundColor: 'rgba(239, 68, 68, 0.1)',
        padding: 20,
        borderRadius: 16,
        marginBottom: 16,
        ...ghostBorder(0.2),
        alignItems: 'center'
    },
    failureTitle: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '700',
        marginBottom: 16,
        textAlign: 'center'
    },
    failureButtons: {
        flexDirection: 'row',
        gap: 12
    },
    retryBtn: {
        backgroundColor: VOICES.rider.accent,
        paddingVertical: 12,
        paddingHorizontal: 24,
        borderRadius: 12
    },
    retryBtnText: {
        color: '#FFFFFF',
        fontSize: 14,
        fontWeight: '800'
    },
    whatsappBtn: {
        backgroundColor: '#25D366',
        paddingVertical: 12,
        paddingHorizontal: 24,
        borderRadius: 12
    },
    whatsappBtnText: {
        color: '#FFFFFF',
        fontSize: 14,
        fontWeight: '800'
    }
});
