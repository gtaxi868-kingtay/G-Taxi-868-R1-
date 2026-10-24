import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
    View, StyleSheet, Pressable, ActivityIndicator, Modal,
    Alert, ScrollView, useWindowDimensions, Linking
} from 'react-native';
import MapView, { Marker, PROVIDER_DEFAULT, UrlTile } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { initializeSupabaseClient, ENV, supportWhatsAppLink } from '@gtaxi/core';
import { estimateFare, createRide, getWalletBalance } from '../services/api';
import { PaymentSelector, PaymentMethod } from '../components/PaymentSelector';
import { Button, Card, GUTTER, IconButton, RADIUS, Row, Section, SPACE, Txt, useTheme } from '../ui/kit';
import { formatTTDDollars } from '../utils/currency';

const { supabase, getSupabase } = initializeSupabaseClient('native');


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

interface VehicleOption {
    key: string;
    label: string;
    multiplier: number;
    icon: string;
    desc: string;
    minFareCents: number | null;
}

// Fallback only — the live list (including admin-unlocked heavy classes like
// truck/hiab/wrecker) comes from the vehicle_classes table, which RLS limits
// to active classes. Multipliers here must match _shared/pricing.ts.
const FALLBACK_VEHICLES: VehicleOption[] = [
    { key: 'standard', label: 'Standard', multiplier: 1.0, icon: 'car-outline', desc: 'Everyday rides', minFareCents: null },
    { key: 'xl', label: 'XL', multiplier: 1.5, icon: 'bus-outline', desc: 'Room for the whole crew', minFareCents: null },
    { key: 'premium', label: 'Premium', multiplier: 2.0, icon: 'star-outline', desc: 'Top-rated cars and drivers', minFareCents: null },
];

// What riders see under each ride type. vehicle_classes.description holds
// admin notes (rate research for heavy classes), so it is only shown when it
// is short enough to be a rider-facing line.
const RIDER_DESC: Record<string, string> = {
    standard: 'Everyday rides',
    xl: 'Room for the whole crew',
    premium: 'Top-rated cars and drivers',
    truck: 'Flatbed and cargo moves',
    hiab: 'Crane lifts and drops',
    wrecker: 'Towing and recovery',
};
function riderDesc(key: string, dbDesc?: string | null): string {
    if (RIDER_DESC[key]) return RIDER_DESC[key];
    return dbDesc && dbDesc.length <= 40 ? dbDesc : '';
}

export function RideConfirmationScreen({ navigation, route }: any) {
    const { height } = useWindowDimensions();
    const { destination, pickup, source, sourceMetadata, kioskId, taxiStandId } = route.params;
    const insets = useSafeAreaInsets();
    const mapRef = useRef<MapView>(null);
    const cameraRef = useRef<CameraView>(null);

    const [loading, setLoading] = useState(true);
    const [fare, setFare] = useState<any>(null);
    const [fareError, setFareError] = useState(false);
    const [vehicles, setVehicles] = useState<VehicleOption[]>(FALLBACK_VEHICLES);
    const [selectedType, setSelectedType] = useState<string>('standard');
    const [confirming, setConfirming] = useState(false);
    const [footerH, setFooterH] = useState(150);
    const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
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
    const [deviceVerified, setDeviceVerified] = useState(false);
    const [cameraPermission, requestCameraPermission] = useCameraPermissions();

    const pickupLoc = pickup || { latitude: 10.66, longitude: -61.51, address: 'Current Location' };

    const fitMapTimeout = useRef<NodeJS.Timeout | null>(null);
    const stopsTimerRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        fetchData();
        // Live vehicle classes — RLS returns active rows only, so heavy
        // classes appear here the moment admin flips them on. Query builders
        // are thenables without .catch(); on failure the fallback list stays.
        supabase
            .from('vehicle_classes')
            .select('key, label, description, icon, multiplier_x100, min_fare_cents, sort_order')
            .order('sort_order')
            .then(
                ({ data }: { data: any[] | null }) => {
                    if (data && data.length > 0) {
                        setVehicles(data.map(d => ({
                            key: d.key,
                            label: d.label,
                            multiplier: d.multiplier_x100 / 100,
                            icon: d.icon || 'car-outline',
                            desc: riderDesc(d.key, d.description),
                            minFareCents: d.min_fare_cents ?? null,
                        })));
                    }
                },
                () => {}
            );
        // Once this account has taken a safety photo on this phone, low-risk
        // daytime rides skip the photo step. This only decides when the app
        // ASKS for a photo; create_ride checks the stored photos itself and
        // refuses the ride when one is needed. The flag is per account: it
        // used to be per phone, so a second account on the same phone was
        // never asked, was refused by the server, and saw "trouble connecting".
        supabase.auth.getUser()
            .then(({ data }: { data: { user: { id: string } | null } }) =>
                data.user ? AsyncStorage.getItem(`gtaxi_device_verified_${data.user.id}`) : null)
            .then((v: string | null) => { if (v === 'true') setDeviceVerified(true); })
            .catch(() => {});
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
        if (res.success) { setFare(res.data); setFareError(false); } else { setFareError(true); }
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

            if (fareRes.success) { setFare(fareRes.data); setFareError(false); } else { setFareError(true); }
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

            const userId = (await supabase.auth.getUser()).data.user?.id;
            if (!userId) {
                setSelfieError('Please sign in again before verifying.');
                setSelfieUploading(false);
                return;
            }
            // Path MUST start with the user id. The storage policy keys on the
            // first folder segment, and anonymise_user finds a deleted
            // account's files by that same prefix. The old 'selfies/<uid>/...'
            // shape would fail the policy AND be missed at deletion time.
            const fileName = `${userId}/${Date.now()}.jpg`;

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

            // verification-photos is a PRIVATE bucket — an identity selfie is
            // not something to hand out on a permanent public url.
            // getPublicUrl would return a link that simply 403s, so the
            // preview would silently break. One-hour signed link instead.
            const { data: urlData } = await supabase.storage
                .from('verification-photos')
                .createSignedUrl(fileName, 3600);

            setSelfieUri(urlData?.signedUrl || null);
            setSelfieVerified(true);
            setSelfieUploading(false);
            setSelfieMode(false);
            // This account has a photo on file from this phone; skip the prompt
            // on future low-risk rides (the server still checks).
            AsyncStorage.setItem(`gtaxi_device_verified_${userId}`, 'true').catch(() => {});
            setDeviceVerified(true);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } catch (err: any) {
            setSelfieError('Camera error: ' + (err.message || 'Unknown error'));
            setSelfieUploading(false);
        }
    };

    const handleConfirm = async () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);


        if (requiresVerification && (!selfieVerified || !selfieUri)) {
            setSelfieError(verificationReason);
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
                identity_verified: selfieVerified,
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
            // The server wants a safety photo for this ride. That is not a
            // connection problem: stop retrying and ask for the photo.
            if (/identity verification required/i.test(String(err?.message || ''))) {
                if (requestTimeoutRef.current) clearTimeout(requestTimeoutRef.current);
                if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
                setRequestStatus('idle');
                setConfirming(false);
                setDeviceVerified(false);
                setSelfieVerified(false);
                setSelfieError('Take a quick safety photo first, then confirm again.');
                return;
            }
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

    const openWhatsAppFallback = async () => {
        const link = await supportWhatsAppLink(`I need a ride from ${pickupLoc.address} to ${destination.address}`);
        Linking.openURL(link);
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

    const selectedVehicle = useMemo(
        () => vehicles.find(v => v.key === selectedType),
        [selectedType, vehicles]
    );
    const multiplier = selectedVehicle?.multiplier ?? 1.0;
    const baseFareCents = fare ? fare.total_fare_cents : 0;
    const displayFareCents = Math.max(
        Math.round(baseFareCents * multiplier),
        selectedVehicle?.minFareCents ?? 0
    );
    const finalFare = fare ? (displayFareCents / 100).toFixed(2) : '--';

    // Risk-triggered identity verification — frictionless for normal rides,
    // a quick selfie only when signals warrant it.
    const HIGH_VALUE_CASH_CENTS = 15000; // $150 TTD
    const bookingHour = new Date().getHours();
    const isLateNight = bookingHour >= 22 || bookingHour < 5;
    const isHighValueCash = paymentMethod === 'cash' && displayFareCents >= HIGH_VALUE_CASH_CENTS;
    const isNewDevice = !deviceVerified;
    const requiresVerification = isNewDevice || isLateNight || isHighValueCash;
    const verificationReason = isNewDevice
        ? 'First ride on this phone: take a quick safety photo'
        : isLateNight
            ? 'Late-night ride: take a quick safety photo'
            : 'Large cash fare: take a quick safety photo';

    const m = useTheme();
    const night = m.key === 'night';
    const tileStyle = night ? 'navigation-night-v1' : 'light-v11';
    const pickupLabel = source === 'nfc_kiosk' ? (sourceMetadata?.locationName || 'NFC Kiosk')
        : source === 'qr_stand' ? (sourceMetadata?.stand || sourceMetadata?.standName || 'Taxi Stand')
        : pickupLoc?.address || 'Current location';
    const needsPhoto = requiresVerification && (!selfieVerified || !selfieUri);
    const stopPriceCents = (stop: StopSuggestion) =>
        (stop.stop_type === 'grocery' ? (fare?.pricing_constants?.stop_base_grocery_cents ?? 3500)
            : stop.stop_type === 'pharmacy' ? (fare?.pricing_constants?.stop_base_pharmacy_cents ?? 2500)
            : (fare?.pricing_constants?.stop_base_other_cents ?? 1500))
        + Math.round((stop.estimated_wait_minutes || 0) * (fare?.pricing_constants?.wait_fee_per_minute_cents ?? 95));
    const mapH = Math.round(height * 0.32);

    const openCamera = async () => {
        if (selfieVerified) return;
        if (!cameraPermission?.granted) {
            const perm = await requestCameraPermission();
            if (!perm.granted) { setSelfieError('Allow camera access to take the safety photo.'); return; }
        }
        setSelfieMode(true);
    };

    return (
        <View style={{ flex: 1, backgroundColor: m.page }}>
            <StatusBar style={m.statusBar} />

            {/* Route map */}
            <View style={{ height: mapH + 28 }}>
                <MapView ref={mapRef} style={StyleSheet.absoluteFillObject} provider={PROVIDER_DEFAULT} userInterfaceStyle={night ? 'dark' : 'light'}
                    initialRegion={{
                        latitude: (pickupLoc.latitude + (destination?.latitude ?? pickupLoc.latitude)) / 2,
                        longitude: (pickupLoc.longitude + (destination?.longitude ?? pickupLoc.longitude)) / 2,
                        latitudeDelta: Math.max(0.02, Math.abs(pickupLoc.latitude - (destination?.latitude ?? pickupLoc.latitude)) * 1.8),
                        longitudeDelta: Math.max(0.02, Math.abs(pickupLoc.longitude - (destination?.longitude ?? pickupLoc.longitude)) * 1.8),
                    }}
                    mapPadding={{ top: insets.top + 50, right: 24, bottom: 48, left: 24 }}>
                    {ENV.MAPBOX_PUBLIC_TOKEN && (
                        <UrlTile key={tileStyle} urlTemplate={`https://api.mapbox.com/styles/v1/mapbox/${tileStyle}/tiles/256/{z}/{x}/{y}@2x?access_token=${ENV.MAPBOX_PUBLIC_TOKEN}`} shouldReplaceMapContent={true} />
                    )}
                    <Marker coordinate={pickupLoc}>
                        <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: '#8B7CFF', borderWidth: 3, borderColor: '#FFFFFF' }} />
                    </Marker>
                    <Marker coordinate={destination}>
                        <View style={{ width: 16, height: 16, borderRadius: 4, backgroundColor: m.key === 'day' ? '#21152E' : '#E9CFA6', borderWidth: 3, borderColor: '#FFFFFF' }} />
                    </Marker>
                    {stopSuggestions.map((stop, index) => {
                        const on = selectedStops.some(x => x.place_name === stop.place_name);
                        return (
                            <Marker key={`stop-${index}`} coordinate={{ latitude: stop.lat, longitude: stop.lng }} onPress={() => toggleStop(stop)}>
                                <View style={{ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#FFFFFF', backgroundColor: on ? '#3FD9E8' : '#8B7CFF' }}>
                                    <Txt variant="caption">{stop.emoji}</Txt>
                                </View>
                            </Marker>
                        );
                    })}
                </MapView>
                <View style={{ position: 'absolute', top: insets.top + SPACE.sm, left: GUTTER - 4 }}>
                    <IconButton icon="chevron-back" label="Back" tone="filled" onPress={() => navigation.goBack()} />
                </View>
            </View>

            {/* Details sheet */}
            <View style={{ flex: 1, marginTop: -28, backgroundColor: m.sheet[1], borderTopLeftRadius: RADIUS.sheet, borderTopRightRadius: RADIUS.sheet, borderWidth: 1, borderBottomWidth: 0, borderColor: m.sheetBorder, overflow: 'hidden' }}>
                <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: GUTTER, paddingBottom: footerH + SPACE.lg }}>
                    {/* Route */}
                    <Card>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: '#8B7CFF' }} />
                            <View style={{ flex: 1, marginLeft: SPACE.md }}>
                                <Txt variant="caption" tone="faint">Pickup</Txt>
                                <Txt variant="bodyStrong" numberOfLines={1}>{pickupLabel}</Txt>
                            </View>
                        </View>
                        <View style={{ width: 2, height: 14, backgroundColor: m.chipBorder, marginLeft: 4, marginVertical: 4 }} />
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: m.key === 'day' ? '#21152E' : '#E9CFA6' }} />
                            <View style={{ flex: 1, marginLeft: SPACE.md }}>
                                <Txt variant="caption" tone="faint">Drop-off</Txt>
                                <Txt variant="bodyStrong" numberOfLines={1}>{destination?.address || 'Destination'}</Txt>
                            </View>
                        </View>
                        {fare && (
                            <Txt variant="caption" tone="dim" style={{ marginTop: SPACE.md }}>
                                {(fare.distance_meters / 1000).toFixed(1)} km · about {Math.round(fare.duration_seconds / 60)} min
                            </Txt>
                        )}
                    </Card>

                    {/* Vehicle */}
                    <Section title="Choose a ride">
                        {vehicles.map((v, i) => {
                            const on = selectedType === v.key;
                            const price = fare ? Math.max(Math.round(baseFareCents * v.multiplier), v.minFareCents ?? 0) : null;
                            return (
                                <Pressable
                                    key={v.key} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={v.label}
                                    onPress={() => { Haptics.selectionAsync(); setSelectedType(v.key); }}
                                    style={({ pressed }) => ({
                                        flexDirection: 'row', alignItems: 'center', padding: SPACE.md, marginBottom: i === vehicles.length - 1 ? 0 : SPACE.sm,
                                        borderRadius: RADIUS.field, borderWidth: 2, borderBottomWidth: 4, borderColor: on ? '#8B7CFF' : (m.key === 'day' ? '#E7E1F0' : 'rgba(255,255,255,0.10)'),
                                        backgroundColor: on ? (m.key === 'day' ? 'rgba(122,92,255,0.08)' : 'rgba(185,174,255,0.12)') : m.chip,
                                        opacity: pressed ? 0.85 : 1,
                                    })}
                                >
                                    <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: m.field, alignItems: 'center', justifyContent: 'center' }}>
                                        <Ionicons name={(v.icon as any) || 'car-outline'} size={22} color={on ? m.accent : m.ink} />
                                    </View>
                                    <View style={{ flex: 1, marginLeft: SPACE.md }}>
                                        <Txt variant="bodyStrong">{v.label}</Txt>
                                        {v.desc ? <Txt variant="caption" tone="dim" numberOfLines={1}>{v.desc}</Txt> : null}
                                    </View>
                                    <Txt variant="headline">{price !== null ? formatTTDDollars(price / 100) : '—'}</Txt>
                                </Pressable>
                            );
                        })}
                    </Section>

                    {/* Stops */}
                    {stopSuggestions.length > 0 && (
                        <Section title="Add a stop on the way">
                            {stopSuggestions.map((stop, index) => {
                                const on = selectedStops.some(x => x.place_name === stop.place_name);
                                return (
                                    <Row
                                        key={index}
                                        title={`${stop.emoji} ${stop.place_name}`}
                                        subtitle={`${stop.is_network_partner ? 'G partner · ' : ''}about ${stop.estimated_wait_minutes} min wait`}
                                        onPress={() => toggleStop(stop)}
                                        last={index === stopSuggestions.length - 1}
                                        right={stop.is_network_partner ? (
                                            <Button title="Book" size="sm" variant="secondary" onPress={() => handleBookService(stop)} />
                                        ) : (
                                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                                <Txt variant="label" tone={on ? 'accent' : 'dim'} style={{ marginRight: SPACE.sm }}>+{formatTTDDollars(stopPriceCents(stop) / 100)}</Txt>
                                                <Ionicons name={on ? 'checkmark-circle' : 'add-circle-outline'} size={22} color={on ? m.accent : m.faint} />
                                            </View>
                                        )}
                                    />
                                );
                            })}
                        </Section>
                    )}

                    {/* Payment */}
                    <View style={{ marginTop: SPACE.xl }}>
                        <PaymentSelector selected={paymentMethod} onSelect={setPaymentMethod} walletBalance={walletBalance / 100} requiredAmount={displayFareCents / 100} />
                    </View>

                    {/* Safety photo */}
                    {requiresVerification ? (
                        <Card style={{ marginTop: SPACE.xl }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                <Ionicons name={selfieVerified ? 'checkmark-circle' : 'shield-checkmark-outline'} size={20} color={selfieVerified ? '#2FB57C' : m.accent} />
                                <Txt variant="bodyStrong" style={{ flex: 1, marginLeft: SPACE.sm }}>{selfieVerified ? 'Safety photo saved' : verificationReason}</Txt>
                            </View>
                            {!selfieVerified && (
                                <Txt variant="caption" tone="dim" style={{ marginTop: SPACE.xs }}>
                                    A private photo of who booked, kept in case anything goes wrong. It is not an ID check.
                                </Txt>
                            )}
                            {selfieError ? <Txt variant="caption" tone="danger" style={{ marginTop: SPACE.sm }}>{selfieError}</Txt> : null}
                            {!selfieVerified && (
                                <Button title={selfieUploading ? 'Saving photo…' : 'Take safety photo'} icon="camera-outline" variant="secondary" size="md"
                                    loading={selfieUploading} style={{ marginTop: SPACE.md }} onPress={openCamera} />
                            )}
                        </Card>
                    ) : (
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: SPACE.lg }}>
                            <Ionicons name="shield-checkmark" size={16} color="#2FB57C" />
                            <Txt variant="caption" tone="dim" style={{ marginLeft: SPACE.sm }}>Safety photo on file</Txt>
                        </View>
                    )}

                    {requestStatus === 'still_trying' && (
                        <Card style={{ marginTop: SPACE.lg }}><Txt variant="bodyStrong">Still connecting… please wait</Txt></Card>
                    )}
                    {requestStatus === 'failed' && (
                        <Card style={{ marginTop: SPACE.lg, borderColor: '#E5484D' }}>
                            <Txt variant="bodyStrong">We could not reach a driver right now.</Txt>
                            <View style={{ flexDirection: 'row', gap: SPACE.md, marginTop: SPACE.md }}>
                                <Button title="Try again" size="md" style={{ flex: 1 }} onPress={handleRetry} />
                                <Button title="WhatsApp us" size="md" variant="secondary" icon="logo-whatsapp" style={{ flex: 1 }} onPress={openWhatsAppFallback} />
                            </View>
                        </Card>
                    )}
                </ScrollView>
            </View>

            {/* Price + confirm, pinned */}
            <View
                onLayout={(e) => setFooterH(e.nativeEvent.layout.height)}
                style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: GUTTER, paddingTop: SPACE.md, paddingBottom: Math.max(insets.bottom, SPACE.lg),
                    backgroundColor: m.sheet[1], borderTopWidth: 1, borderTopColor: m.chipBorder }}
            >
                <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: SPACE.md }}>
                    <Txt variant="body" tone="dim">Estimated fare</Txt>
                    {fare ? <Txt variant="title">{formatTTDDollars(displayFareCents / 100)}</Txt>
                        : fareError ? <Txt variant="bodyStrong" tone="accent" onPress={() => fetchFare(selectedStops)}>Price failed. Tap to retry</Txt>
                        : <ActivityIndicator color={m.accent} />}
                </View>
                <Button
                    title={needsPhoto ? 'Take the safety photo first' : `Confirm ${selectedVehicle?.label ?? 'ride'}`}
                    onPress={needsPhoto ? openCamera : handleConfirm}
                    loading={confirming}
                    disabled={!fare && !fareError}
                />
            </View>

            {/* Safety photo camera */}
            <Modal visible={selfieMode} animationType="slide" onRequestClose={() => setSelfieMode(false)}>
                <View style={{ flex: 1, backgroundColor: '#000' }}>
                    <CameraView ref={cameraRef} facing="front" style={StyleSheet.absoluteFill}
                        onMountError={() => { setSelfieError('Could not open the camera.'); setSelfieMode(false); }} />
                    <View style={{ position: 'absolute', left: GUTTER, right: GUTTER, bottom: Math.max(insets.bottom, SPACE.lg) + SPACE.lg, padding: SPACE.xl, borderRadius: RADIUS.card, backgroundColor: 'rgba(15,11,24,0.82)' }}>
                        <Txt variant="headline" style={{ color: '#FFFFFF', textAlign: 'center' }}>Safety photo</Txt>
                        <Txt variant="caption" style={{ color: 'rgba(255,255,255,0.7)', textAlign: 'center', marginTop: SPACE.xs }}>
                            Kept private, only used if something goes wrong on this ride.
                        </Txt>
                        <View style={{ flexDirection: 'row', gap: SPACE.md, marginTop: SPACE.lg }}>
                            <Button title="Cancel" variant="secondary" size="md" style={{ flex: 1 }} onPress={() => setSelfieMode(false)} />
                            <Button title="Take photo" icon="camera" size="md" style={{ flex: 1 }} loading={selfieUploading} onPress={handleSelfieCapture} />
                        </View>
                    </View>
                </View>
            </Modal>
        </View>
    );
}
