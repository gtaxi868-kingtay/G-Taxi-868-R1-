import React, { useState, useEffect, useRef } from 'react';
import {
    View, StyleSheet, TouchableOpacity, ActivityIndicator,
    Alert, ScrollView, Dimensions, Platform
} from 'react-native';
import MapView, { Marker, PROVIDER_DEFAULT, UrlTile } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { ENV } from '../../../../shared/env';
import { estimateFare, createRide, getWalletBalance } from '../services/api';
import { supabase } from '../../../../shared/supabase';
import { Txt } from '../design-system/primitives';
import { GlassCard, BRAND, VOICES, RADIUS, GRADIENTS, SEMANTIC } from '../design-system';
import { formatTTDDollars } from '../utils/currency';

const { width, height } = Dimensions.get('window');

interface StopSuggestion {
    place_name: string;
    place_address: string;
    lat: number;
    lng: number;
    stop_type: string;
    emoji: string;
    estimated_wait_minutes: number;
    is_preferred: boolean;
    is_network_partner?: boolean; // Phase 8A
    merchant_id?: string;        // Phase 8A
}

const VEHICLES = [
    { type: 'Standard', multiplier: 1.0, icon: 'car-outline', desc: 'Daily logistics' },
    { type: 'XL', multiplier: 1.5, icon: 'bus-outline', desc: 'Group & Bulk' },
    { type: 'Premium', multiplier: 2.2, icon: 'star-outline', desc: 'Executive Pro' },
] as const;

type VehicleType = (typeof VEHICLES)[number]['type'];

export function RideConfirmationScreen({ navigation, route }: any) {
    const { destination, pickup } = route.params;
    const insets = useSafeAreaInsets();
    const mapRef = useRef<MapView>(null);

    const [loading, setLoading] = useState(true);
    const [fare, setFare] = useState<any>(null);
    const [selectedType, setSelectedType] = useState<VehicleType>('Standard');
    const [multiplier, setMultiplier] = useState(1.0);
    const [confirming, setConfirming] = useState(false);
    const [walletBalance, setWalletBalance] = useState<number>(0);

    const [stopSuggestions, setStopSuggestions] = useState<StopSuggestion[]>([]);
    const [selectedStops, setSelectedStops] = useState<StopSuggestion[]>([]);
    const [bookForFamily, setBookForFamily] = useState(false);

    const pickupLoc = pickup || { latitude: 10.66, longitude: -61.51, address: 'Current Location' };

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
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

            setTimeout(() => {
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

    const handleConfirm = async () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        setConfirming(true);
        try {
            const res = await createRide({
                pickup_lat: pickupLoc.latitude,
                pickup_lng: pickupLoc.longitude,
                pickup_address: pickupLoc.address,
                dropoff_lat: destination.latitude,
                dropoff_lng: destination.longitude,
                dropoff_address: destination.address,
                vehicle_type: selectedType,
                payment_method: 'cash',
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
                navigation.replace('SearchingDriver', {
                    rideId: res.data.ride_id,
                    destination,
                    fare: { ...fare, total_fare_cents: displayFareCents },
                    pickup: pickupLoc
                });
            }
        } catch (err) {
            Alert.alert("Error", "Failed to book ride");
        } finally {
            setConfirming(false);
        }
    };

    const STOP_CONVENIENCE_FEE_TTD = 5.00;
    const WAIT_RATE_PER_MIN = 0.855;

    const stopsAddedCents = selectedStops.reduce((total, stop) => {
        const waitFee = stop.estimated_wait_minutes * WAIT_RATE_PER_MIN * 100;
        const convFee = STOP_CONVENIENCE_FEE_TTD * 100;
        return total + waitFee + convFee;
    }, 0);

    const baseFareCents = fare ? fare.total_fare_cents * multiplier : 0;
    const displayFareCents = baseFareCents + stopsAddedCents;
    const finalFare = fare ? (displayFareCents / 100).toFixed(2) : '--';

    return (
        <View style={s.root}>
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
                </MapView>

                <TouchableOpacity
                    style={[s.backBtn, { top: insets.top + 10 }]}
                    onPress={() => navigation.goBack()}
                >
                    <Ionicons name="arrow-back" size={24} color={VOICES.rider.text} />
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
                                    <Txt variant="caption" weight="regular" color={VOICES.rider.textMuted}>PICKUP</Txt>
                                    <Txt variant="bodyBold" weight="heavy" color={VOICES.rider.text} numberOfLines={1}>
                                        {pickupLoc?.address || 'Current Location'}
                                    </Txt>
                                </View>
                            </View>
                            <View style={s.routeLine} />
                            <View style={s.routeRow}>
                                <View style={s.routeSquare} />
                                <View style={{ flex: 1, marginLeft: 16 }}>
                                    <Txt variant="caption" weight="regular" color={VOICES.rider.textMuted}>DESTINATION</Txt>
                                    <Txt variant="bodyBold" weight="heavy" color={VOICES.rider.text} numberOfLines={1}>
                                        {destination?.address || 'Destination'}
                                    </Txt>
                                </View>
                            </View>
                        </View>

                        {fare && (
                            <View style={s.statsRow}>
                                <Txt variant="caption" weight="regular" color={VOICES.rider.textMuted}>
                                    LOGISTICS: {(fare?.distance_meters / 1000).toFixed(1)}KM · {Math.round(fare?.duration_seconds / 60)}MIN EST.
                                </Txt>
                            </View>
                        )}

                        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.vehicleScroll} contentContainerStyle={{ paddingRight: 20 }}>
                            {VEHICLES.map(v => (
                                <TouchableOpacity
                                    key={v.type}
                                    style={[s.vehicleCard, selectedType === v.type && s.vehicleCardActive]}
                                    onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setSelectedType(v.type); setMultiplier(v.multiplier); }}
                                >
                                    <Ionicons name={v.icon as any} size={24} color={selectedType === v.type ? "#FFF" : BRAND.purple} />
                                    <Txt variant="bodyReg" weight="heavy" color={selectedType === v.type ? "#FFF" : VOICES.rider.text} style={{ marginTop: 8 }}>{v.type}</Txt>
                                    <Txt variant="caption" weight="regular" color={selectedType === v.type ? "rgba(255,255,255,0.7)" : VOICES.rider.textMuted}>{v.multiplier}x</Txt>
                                </TouchableOpacity>
                            ))}
                        </ScrollView>

                        {stopSuggestions.length > 0 && (
                            <View style={s.stopsSection}>
                                <Txt variant="caption" weight="heavy" color={BRAND.purple} style={{ letterSpacing: 1, marginBottom: 12 }}>
                                    SUGGESTED LOGISTICS STOPS
                                </Txt>
                                {stopSuggestions.map((stop, index) => {
                                    const isSelected = selectedStops.some(s => s.place_name === stop.place_name);
                                    return (
                                        <TouchableOpacity
                                            key={index}
                                            onPress={() => toggleStop(stop)}
                                            style={[s.stopItem, isSelected && s.stopItemActive]}
                                        >
                                            <View style={s.stopEmojiWrap}>
                                                <Txt style={{ fontSize: 20 }}>{stop.emoji}</Txt>
                                            </View>
                                            <View style={{ flex: 1, marginLeft: 12 }}>
                                                <Txt variant="bodyReg" weight="heavy" color={VOICES.rider.text}>{stop.place_name}</Txt>
                                                <Txt variant="caption" weight="regular" color={VOICES.rider.textMuted}>
                                                    {stop.is_network_partner ? 'G-TAXI PARTNER · ' : ''}+{stop.estimated_wait_minutes}m wait
                                                </Txt>
                                            </View>
                                            <View style={{ alignItems: 'flex-end' }}>
                                                {stop.is_network_partner ? (
                                                    <TouchableOpacity 
                                                        onPress={() => handleBookService(stop)}
                                                        style={{ backgroundColor: BRAND.purple + '20', paddingHorizontal: 12, paddingVertical: 6, borderRadius: RADIUS.md, marginBottom: 4 }}
                                                    >
                                                        <Txt variant="caption" weight="heavy" color={BRAND.purple}>BOOK SERVICE</Txt>
                                                    </TouchableOpacity>
                                                ) : (
                                                    <Txt variant="bodyReg" weight="heavy" color={isSelected ? BRAND.purple : VOICES.rider.textMuted}>
                                                        +${((stop.estimated_wait_minutes * WAIT_RATE_PER_MIN) + STOP_CONVENIENCE_FEE_TTD).toFixed(2)}
                                                    </Txt>
                                                )}
                                            </View>
                                        </TouchableOpacity>
                                    );
                                })}
                            </View>
                        )}

                        <View style={s.fareDisplay}>
                            <Txt variant="caption" weight="regular" color={VOICES.rider.textMuted}>TOTAL ESTIMATE</Txt>
                            <Txt variant="headingL" weight="heavy" color={BRAND.purple}>
                                {formatTTDDollars(parseFloat(finalFare))}
                            </Txt>
                        </View>

                        <View style={s.identityShield}>
                            <Ionicons name="shield-checkmark" size={20} color={BRAND.cyan} />
                            <Txt variant="caption" weight="heavy" color={BRAND.cyan} style={{ marginLeft: 8, letterSpacing: 1 }}>
                                G-TAXI IDENTITY SHIELD ACTIVE
                            </Txt>
                        </View>

                        <TouchableOpacity
                            style={[s.confirmBtn, confirming && { opacity: 0.7 }]}
                            onPress={handleConfirm}
                            disabled={confirming}
                        >
                            <LinearGradient 
                                colors={[BRAND.purple, BRAND.purpleDark]} 
                                style={s.btnGradient}
                                start={GRADIENTS.primaryStart}
                                end={GRADIENTS.primaryEnd}
                            >
                                {confirming ? <ActivityIndicator color="#FFF" /> : (
                                    <Txt variant="bodyReg" weight="heavy" color="#FFF">
                                        CONFIRM {selectedType.toUpperCase()}
                                    </Txt>
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
    root: { flex: 1, backgroundColor: VOICES.rider.bg },
    backBtn: { position: 'absolute', left: 20, width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFF', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 8, elevation: 3 },
    
    markerPickup: { width: 14, height: 14, borderRadius: 7, backgroundColor: '#FFF', borderWidth: 3, borderColor: BRAND.purple },
    markerDropoff: { width: 14, height: 14, borderRadius: 3, backgroundColor: '#FFF', borderWidth: 3, borderColor: SEMANTIC.warning },

    bottomContainer: { flex: 1, marginTop: -30 },
    panel: { flex: 1, borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl, padding: 24, paddingBottom: 0 },
    handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(30,30,63,0.1)', alignSelf: 'center', marginBottom: 24 },

    routeBox: { backgroundColor: 'rgba(124, 58, 237, 0.03)', borderRadius: RADIUS.lg, padding: 20, marginBottom: 20, borderWidth: 1, borderColor: 'rgba(124, 58, 237, 0.05)' },
    routeRow: { flexDirection: 'row', alignItems: 'center' },
    routeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: BRAND.purple },
    routeSquare: { width: 8, height: 8, borderRadius: 2, backgroundColor: SEMANTIC.warning },
    routeLine: { width: 1.5, height: 15, backgroundColor: 'rgba(124, 58, 237, 0.1)', marginLeft: 3.25, marginVertical: 4 },

    statsRow: { marginBottom: 24, alignItems: 'center' },
    
    vehicleScroll: { marginBottom: 32 },
    vehicleCard: { width: 110, height: 120, backgroundColor: 'rgba(124, 58, 237, 0.05)', borderRadius: RADIUS.lg, padding: 16, marginRight: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(124, 58, 237, 0.1)' },
    vehicleCardActive: { backgroundColor: BRAND.purple, borderColor: BRAND.purpleLight },

    stopsSection: { marginBottom: 32 },
    stopItem: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: RADIUS.md, backgroundColor: 'rgba(0,0,0,0.02)', marginBottom: 10, borderWidth: 1, borderColor: 'transparent' },
    stopItemActive: { borderColor: BRAND.purple, backgroundColor: 'rgba(124, 58, 237, 0.05)' },
    stopEmojiWrap: { width: 44, height: 44, borderRadius: 12, backgroundColor: '#FFF', alignItems: 'center', justifyContent: 'center' },

    fareDisplay: { alignItems: 'center', marginBottom: 24 },
    
    identityShield: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,255,255,0.05)', paddingVertical: 8, paddingHorizontal: 16, borderRadius: RADIUS.pill, marginBottom: 32, alignSelf: 'center' },

    confirmBtn: { height: 60, borderRadius: RADIUS.pill, overflow: 'hidden' },
    btnGradient: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
