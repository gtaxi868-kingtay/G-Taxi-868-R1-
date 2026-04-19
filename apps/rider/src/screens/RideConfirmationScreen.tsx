import React, { useState, useEffect, useRef } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
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

// Blueberry Luxe Color System
const COLORS = {
    bgPrimary: '#0D0B1E',
    bgSecondary: '#160B32',
    gradientStart: '#1A0533',
    gradientEnd: '#0D1B4B',
    purple: '#7B5CF0',
    purpleDark: '#5B3FD0',
    purpleLight: '#9B7CF0',
    cyan: '#00E5FF',
    cyanDark: '#0099BB',
    cyanSoft: 'rgba(0,229,255,0.1)',
    white: '#FFFFFF',
    textSecondary: 'rgba(255,255,255,0.6)',
    textMuted: 'rgba(255,255,255,0.4)',
    glassBg: 'rgba(255,255,255,0.06)',
    glassBorder: 'rgba(123,92,240,0.3)',
    success: '#00FF94',
    warning: '#F59E0B',
    error: '#EF4444',
};

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
                    <Ionicons name="arrow-back" size={24} color={COLORS.white} />
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
                                        {pickupLoc?.address || 'Current Location'}
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
                                    onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setSelectedType(v.type); setMultiplier(v.multiplier); }}
                                >
                                    <Ionicons name={v.icon as any} size={24} color={selectedType === v.type ? COLORS.white : COLORS.purple} />
                                    <Text style={[s.vehicleType, { color: selectedType === v.type ? COLORS.white : COLORS.white }]}>{v.type}</Text>
                                    <Text style={[s.vehicleMultiplier, { color: selectedType === v.type ? 'rgba(255,255,255,0.7)' : COLORS.textMuted }]}>{v.multiplier}x</Text>
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
                                                        style={{ backgroundColor: COLORS.cyanSoft, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, marginBottom: 4 }}
                                                    >
                                                        <Text style={s.bookServiceText}>BOOK SERVICE</Text>
                                                    </TouchableOpacity>
                                                ) : (
                                                    <Text style={[s.stopPrice, { color: isSelected ? COLORS.cyan : COLORS.textMuted }]}>
                                                        +${((stop.estimated_wait_minutes * WAIT_RATE_PER_MIN) + STOP_CONVENIENCE_FEE_TTD).toFixed(2)}
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
                            <Ionicons name="shield-checkmark" size={20} color={COLORS.cyan} />
                            <Text style={s.identityText}>G-TAXI IDENTITY SHIELD ACTIVE</Text>
                        </View>

                        <TouchableOpacity
                            style={[s.confirmBtn, confirming && { opacity: 0.7 }]}
                            onPress={handleConfirm}
                            disabled={confirming}
                        >
                            <LinearGradient 
                                colors={[COLORS.purple, COLORS.cyan]} 
                                style={s.btnGradient}
                                start={{ x: 0, y: 0 }}
                                end={{ x: 1, y: 1 }}
                            >
                                {confirming ? <ActivityIndicator color={COLORS.white} /> : (
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
    root: { flex: 1, backgroundColor: COLORS.bgPrimary },
    backBtn: { position: 'absolute', left: 20, width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.white, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 8, elevation: 3 },
    
    bottomContainer: { flex: 1, marginTop: -30 },
    panel: { flex: 1, borderTopLeftRadius: 32, borderTopRightRadius: 32, padding: 24, paddingBottom: 0, overflow: 'hidden' },
    handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: 24 },

    routeBox: { backgroundColor: COLORS.glassBg, borderRadius: 20, padding: 20, marginBottom: 20, borderWidth: 1, borderColor: COLORS.glassBorder },
    routeRow: { flexDirection: 'row', alignItems: 'center' },
    routeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.purple },
    routeSquare: { width: 8, height: 8, borderRadius: 2, backgroundColor: COLORS.warning },
    routeLine: { width: 1.5, height: 15, backgroundColor: COLORS.glassBorder, marginLeft: 3.25, marginVertical: 4 },
    addrLabel: { fontSize: 11, fontWeight: '700', color: COLORS.textMuted, letterSpacing: 1, marginBottom: 4 },
    addrText: { fontSize: 15, fontWeight: '600', color: COLORS.white },

    statsRow: { marginBottom: 24, alignItems: 'center' },
    logisticsText: { fontSize: 13, fontWeight: '600', color: COLORS.textSecondary, letterSpacing: 0.5 },
    
    vehicleScroll: { marginBottom: 32 },
    vehicleCard: { width: 110, height: 120, backgroundColor: COLORS.glassBg, borderRadius: 20, padding: 16, marginRight: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.glassBorder },
    vehicleCardActive: { backgroundColor: COLORS.purple, borderColor: COLORS.cyan },
    vehicleType: { marginTop: 8, fontSize: 14, fontWeight: '700' },
    vehicleMultiplier: { fontSize: 12, fontWeight: '600' },

    stopsSection: { marginBottom: 32 },
    sectionTitle: { fontSize: 12, fontWeight: '800', color: COLORS.purple, letterSpacing: 1, marginBottom: 12 },
    stopItem: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.02)', marginBottom: 10, borderWidth: 1, borderColor: 'transparent' },
    stopItemActive: { borderColor: COLORS.purple, backgroundColor: 'rgba(123,92,240,0.05)' },
    stopEmojiWrap: { width: 44, height: 44, borderRadius: 12, backgroundColor: COLORS.white, alignItems: 'center', justifyContent: 'center' },
    stopName: { fontSize: 15, fontWeight: '700', color: COLORS.white },
    stopSubtext: { fontSize: 13, fontWeight: '500', color: COLORS.textMuted },
    stopPrice: { fontSize: 15, fontWeight: '700' },
    bookServiceText: { fontSize: 12, fontWeight: '800', color: COLORS.cyan, letterSpacing: 0.5 },

    fareDisplay: { alignItems: 'center', marginBottom: 24 },
    fareLabel: { fontSize: 12, fontWeight: '600', color: COLORS.textMuted, letterSpacing: 1, marginBottom: 4 },
    fareValue: { fontSize: 36, fontWeight: '900', color: COLORS.purple },
    
    identityShield: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.cyanSoft, paddingVertical: 8, paddingHorizontal: 16, borderRadius: 100, marginBottom: 32, alignSelf: 'center' },
    identityText: { marginLeft: 8, fontSize: 12, fontWeight: '800', color: COLORS.cyan, letterSpacing: 1 },

    confirmBtn: { height: 60, borderRadius: 30, overflow: 'hidden', shadowColor: COLORS.cyan, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 6 },
    btnGradient: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    confirmBtnText: { fontSize: 16, fontWeight: '900', color: COLORS.white, letterSpacing: 0.5 },
    markerPickup: { width: 14, height: 14, borderRadius: 7, backgroundColor: COLORS.cyan, borderWidth: 2, borderColor: COLORS.white },
    markerDropoff: { width: 14, height: 14, borderRadius: 7, backgroundColor: COLORS.purple, borderWidth: 2, borderColor: COLORS.white },
});
