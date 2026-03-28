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
import { Txt, Card, Surface } from '../design-system/primitives';

interface StopSuggestion {
    place_name: string;
    place_address: string;
    lat: number;
    lng: number;
    stop_type: string;
    emoji: string;
    estimated_wait_minutes: number;
    is_preferred: boolean;
}

import { tokens } from '../design-system/tokens';

const { width, height } = Dimensions.get('window');

// --- Rider Design Tokens (Deprecated local, using tokens) ---
const R = {
    bg: tokens.colors.background.base,
    surface: tokens.colors.background.surface,
    border: tokens.colors.glass.stroke,
    purple: tokens.colors.primary.purple,
    purpleLight: tokens.colors.primary.cyan,
    gold: '#FFD700',
    white: tokens.colors.text.primary,
    muted: tokens.colors.text.secondary,
};

const VEHICLES = [
    { type: 'Standard', multiplier: 1.0, icon: 'car-outline', desc: 'Affordable, everyday rides' },
    { type: 'XL', multiplier: 1.5, icon: 'bus-outline', desc: '6 seats, extra room' },
    { type: 'Premium', multiplier: 2.2, icon: 'star-outline', desc: 'Luxury high-end vehicles' },
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
    const [stopsLoading, setStopsLoading] = useState(false);

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

            // Fetch stop suggestions
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
                    edgePadding: { top: 50, right: 50, bottom: 50, left: 50 },
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
                return [...prev, stop];
            }
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
                payment_method: 'cash', // Default for now
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

    // Calculate stop fees for real-time fare update
    const STOP_CONVENIENCE_FEE_TTD = 5.00;
    const WAIT_RATE_PER_MIN = 0.855; // $0.95 * 0.90

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
            <StatusBar style="light" />

            {/* Layout: Map at top 40% height */}
            <View style={{ height: height * 0.4 }}>
                <MapView
                    ref={mapRef}
                    style={StyleSheet.absoluteFillObject}
                    provider={PROVIDER_DEFAULT}
                    userInterfaceStyle="dark"
                >
                    {ENV.MAPBOX_PUBLIC_TOKEN && (
                        <UrlTile
                            urlTemplate={`https://api.mapbox.com/styles/v1/mapbox/dark-v11/tiles/256/{z}/{x}/{y}@2x?access_token=${ENV.MAPBOX_PUBLIC_TOKEN}`}
                            shouldReplaceMapContent={true}
                        />
                    )}
                    <Marker coordinate={pickupLoc}><View style={s.dot} /></Marker>
                    <Marker coordinate={destination}><View style={s.square} /></Marker>
                </MapView>

                <TouchableOpacity
                    style={[s.backBtn, { top: insets.top + 10 }]}
                    onPress={() => navigation.goBack()}
                >
                    <Ionicons name="chevron-back" size={24} color="#FFF" />
                </TouchableOpacity>
            </View>

            {/* Bottom 60% is a large BlurView white-tint glass panel */}
            <BlurView tint="dark" intensity={90} style={s.panel}>
                <View style={s.handle} />

                <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}>

                    {/* Route display: Pickup (circle) and Destination (square) rows */}
                    <View style={s.routeBox}>
                        <View style={s.routeRow}>
                            <View style={[s.dotSmall, { backgroundColor: R.purple }]} />
                            <Txt variant="bodyBold" color="#FFF" numberOfLines={1} style={{ flex: 1, marginLeft: 12 }}>
                                {pickupLoc.address}
                            </Txt>
                        </View>
                        <View style={s.line} />
                        <View style={s.routeRow}>
                            <View style={[s.squareSmall, { backgroundColor: R.gold }]} />
                            <Txt variant="bodyBold" color="#FFF" numberOfLines={1} style={{ flex: 1, marginLeft: 12 }}>
                                {destination.address}
                            </Txt>
                        </View>
                    </View>

                    {/* BUG_FIX: Fix fare units — distance_meters / 1000 and duration_seconds / 60 */}
                    {fare && (
                        <View style={s.statsRow}>
                            <Txt variant="small" color={R.muted}>
                                {(fare.distance_meters / 1000).toFixed(1)} km · {Math.round(fare.duration_seconds / 60)} mins
                            </Txt>
                        </View>
                    )}

                    {/* Vehicle selection: Horizontal ScrollView of cards */}
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.vehicleScroll} contentContainerStyle={{ paddingRight: 20 }}>
                        {VEHICLES.map(v => (
                            <TouchableOpacity
                                key={v.type}
                                style={[s.vehicleCard, selectedType === v.type && s.vehicleCardActive]}
                                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setSelectedType(v.type); setMultiplier(v.multiplier); }}
                            >
                                <Ionicons name={v.icon as any} size={28} color={selectedType === v.type ? "#FFF" : R.muted} />
                                <Txt variant="bodyBold" color={selectedType === v.type ? "#FFF" : R.white} style={{ marginTop: 8 }}>{v.type}</Txt>
                                <Txt variant="small" color={selectedType === v.type ? "rgba(255,255,255,0.7)" : R.muted} style={{ marginTop: 2 }}>{v.multiplier}x</Txt>
                            </TouchableOpacity>
                        ))}
                    </ScrollView>

                    {/* STOPS SECTION - Fix 3 */}
                    {stopSuggestions.length > 0 && (
                        <View style={s.stopsSection}>
                            <View style={s.stopsSectionHeader}>
                                <Txt variant="caption" weight="bold" color={R.purpleLight}
                                    style={{ letterSpacing: 0.8 }}>
                                    STOPS ALONG YOUR ROUTE
                                </Txt>
                                <Txt variant="small" color={R.muted}>
                                    {selectedStops.length > 0
                                        ? `${selectedStops.length} selected`
                                        : "Add stops to your trip"}
                                </Txt>
                            </View>

                            {stopSuggestions.map((stop, index) => {
                                const isSelected = selectedStops.some(
                                    s => s.place_name === stop.place_name
                                );
                                const addedCost = (
                                    stop.estimated_wait_minutes * WAIT_RATE_PER_MIN +
                                    STOP_CONVENIENCE_FEE_TTD
                                ).toFixed(2);

                                return (
                                    <TouchableOpacity
                                        key={index}
                                        onPress={() => toggleStop(stop)}
                                        activeOpacity={0.75}
                                        style={{ marginBottom: 10 }}
                                    >
                                        <Card
                                            intensity={isSelected ? 60 : 25}
                                            style={[
                                                { flexDirection: 'row', alignItems: 'center', borderRadius: 24 },
                                                isSelected && { borderColor: R.purple, borderWidth: 1 }
                                            ]}
                                        >
                                            <View style={s.stopIconWrap}>
                                                <Txt variant="bodyReg" style={{ fontSize: 22 }}>
                                                    {stop.emoji}
                                                </Txt>
                                            </View>
                                            <View style={{ flex: 1, marginLeft: 12 }}>
                                                <Txt variant="bodyBold" color={R.white}>
                                                    {stop.place_name}
                                                </Txt>
                                                <Txt variant="small" color={R.muted} style={{ marginTop: 2 }}>
                                                    {stop.stop_type} · ~{stop.estimated_wait_minutes} min wait
                                                </Txt>
                                            </View>
                                            <Txt variant="bodyBold"
                                                color={isSelected ? R.gold : R.muted}>
                                                +${addedCost}
                                            </Txt>
                                        </Card>
                                    </TouchableOpacity>
                                );
                            })}
                        </View>
                    )}

                    <View style={s.fareSection}>
                        <Txt variant="headingL" weight="heavy" color={R.gold}>${finalFare}</Txt>
                        <Txt variant="small" color={R.muted}>Estimated total</Txt>
                    </View>

                    {/* Confirm button: Large gradient button at bottom */}
                    <TouchableOpacity
                        style={[s.confirmBtn, confirming && { opacity: 0.7 }]}
                        onPress={handleConfirm}
                        disabled={confirming}
                    >
                        <LinearGradient colors={[R.purple, '#4C1D95']} style={s.btnGradient}>
                            {confirming ? <ActivityIndicator color="#FFF" /> : (
                                <Txt variant="headingM" weight="bold" color="#FFF">
                                    Confirm {selectedType}{selectedStops.length > 0 ? ` + ${selectedStops.length} Stop${selectedStops.length > 1 ? "s" : ""}` : ""}
                                </Txt>
                            )}
                        </LinearGradient>
                    </TouchableOpacity>

                </ScrollView>
            </BlurView>
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: R.bg },
    backBtn: { position: 'absolute', left: 24, padding: 10, backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: 20, zIndex: 100 },
    
    panel: { borderTopLeftRadius: 40, borderTopRightRadius: 40, flex: 1, overflow: 'hidden', padding: 24, backgroundColor: 'rgba(10, 10, 31, 0.95)' },
    handle: { width: 40, height: 4, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 2, alignSelf: 'center', marginBottom: 20 },

    routeBox: { backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 28, padding: 20, marginBottom: 24 },
    routeRow: { flexDirection: 'row', alignItems: 'center' },
    line: { width: 2, height: 20, backgroundColor: 'rgba(255,255,255,0.1)', marginLeft: 6, marginVertical: 4 },
    dotSmall: { width: 12, height: 12, borderRadius: 6 },
    squareSmall: { width: 12, height: 12, borderRadius: 2 },
    
    dot: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#FFF', borderWidth: 4, borderColor: '#7B61FF' },
    square: { width: 20, height: 20, borderRadius: 4, backgroundColor: '#FFF', borderWidth: 4, borderColor: '#00FFFF' },

    statsRow: { marginBottom: 24, paddingHorizontal: 4 },
    
    vehicleScroll: { marginBottom: 32 },
    vehicleCard: { width: 110, height: 130, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 28, padding: 16, marginRight: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
    vehicleCardActive: { backgroundColor: R.purple, borderColor: R.purpleLight },

    stopsSection: { marginBottom: 32 },
    stopsSectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
    stopIconWrap: { width: 54, height: 54, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center', marginRight: 16 },

    fareSection: { alignItems: 'center', marginBottom: 24, justifyContent: 'center', flexShrink: 0 },
    confirmBtn: { height: 64, borderRadius: 24, overflow: 'hidden' },
    btnGradient: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
