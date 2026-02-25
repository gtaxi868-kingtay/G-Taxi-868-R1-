import React, { useEffect, useState } from 'react';
import { View, StyleSheet, SafeAreaView, TouchableOpacity, ActivityIndicator, Linking } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import MapView, { Marker, PROVIDER_DEFAULT } from 'react-native-maps';
import { useAuth } from '../context/AuthContext';
import { useLocationTracking } from '../hooks/useLocationTracking';
import { DEFAULT_LOCATION } from '../../../../shared/env';
import { useRideOfferSubscription } from '../services/realtime';
import { tokens } from '../design-system/tokens';
import { Txt, Surface, Card } from '../design-system/primitives';
import { supabase } from '../../../../shared/supabase';
import { Sidebar } from '../components/Sidebar';
import { Sidebar } from '../components/Sidebar';

const DARK_MAP_STYLE = [
    { elementType: "geometry", stylers: [{ color: tokens.colors.background.base }] },
    { elementType: "labels.text.stroke", stylers: [{ color: "#242f3e" }] },
    { elementType: "labels.text.fill", stylers: [{ color: "#746855" }] },
    { featureType: "administrative.locality", elementType: "labels.text.fill", stylers: [{ color: tokens.colors.text.secondary }] },
    { featureType: "poi", elementType: "labels.text.fill", stylers: [{ color: "#d59563" }] },
    { featureType: "road", elementType: "geometry", stylers: [{ color: "#38414e" }] },
    { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#212a37" }] },
    { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#9ca5b3" }] },
    { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#746855" }] },
    { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: "#1f2835" }] },
    { featureType: "road.highway", elementType: "labels.text.fill", stylers: [{ color: "#f3d19c" }] },
    { featureType: "transit", elementType: "geometry", stylers: [{ color: "#2f3948" }] },
    { featureType: "water", elementType: "geometry", stylers: [{ color: "#17263c" }] },
    { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#515c6d" }] },
    { featureType: "water", elementType: "labels.text.stroke", stylers: [{ color: "#17263c" }] },
];

export function DashboardScreen({ navigation }: any) {
    const { driver, toggleOnline, signOut } = useAuth();
    const { location } = useLocationTracking();
    const { offer, clearOffer } = useRideOfferSubscription(driver?.id);
    const isOnline = driver?.is_online;

    // Phase 9: Global Navigation
    const [sidebarVisible, setSidebarVisible] = useState(false);

    // Phase 9: Global Navigation
    const [sidebarVisible, setSidebarVisible] = useState(false);

    // Use RideOfferSubscription instead of ActiveRideListener for Phase 4 cascade
    useEffect(() => {
        if (offer && isOnline) {
            navigation.navigate('TripRequest', { offer });
            clearOffer();
        }
    }, [offer, isOnline, navigation]);

    const currentLat = location?.coords.latitude || DEFAULT_LOCATION.latitude;
    const currentLng = location?.coords.longitude || DEFAULT_LOCATION.longitude;

    // PHASE 8: $600 TTD Cap Lockout & Today's Stats
    const [balanceCents, setBalanceCents] = useState<number | null>(null);
    const [todayTrips, setTodayTrips] = useState(0);
    const [todayEarnings, setTodayEarnings] = useState(0);

    useEffect(() => {
        if (driver?.id) {
            supabase.rpc('get_wallet_balance', { p_user_id: driver.id }).then(({ data }) => {
                setBalanceCents(Math.round(Number(data) || 0));
            });

            // Eradicate Vibe Code: Fetch Real Daily Stats
            const startOfDay = new Date();
            startOfDay.setHours(0, 0, 0, 0);

            supabase
                .from('rides')
                .select('total_fare_cents')
                .eq('driver_id', driver.id)
                .eq('status', 'completed')
                .gte('created_at', startOfDay.toISOString())
                .then(({ data }) => {
                    if (data) {
                        setTodayTrips(data.length);
                        // Driver keeps 85% of total fare (15% platform commission)
                        const totalCents = data.reduce((acc, r) => acc + (r.total_fare_cents || 0), 0);
                        setTodayEarnings((totalCents * 0.85) / 100);
                    }
                });
        }
    }, [driver?.id]);

    const isLockedOut = balanceCents !== null && balanceCents <= -60000;

    return (
        <View style={styles.container}>
            <StatusBar style="light" />

            {/* Background MapView */}
            <MapView
                style={StyleSheet.absoluteFillObject}
                provider={PROVIDER_DEFAULT}
                customMapStyle={DARK_MAP_STYLE}
                region={{
                    latitude: currentLat,
                    longitude: currentLng,
                    latitudeDelta: 0.02,
                    longitudeDelta: 0.02,
                }}
                showsUserLocation={false}
                showsMyLocationButton={false}
                pitchEnabled={false}
            >
                {/* Custom Driver Marker */}
                {isOnline && location && (
                    <Marker coordinate={{ latitude: currentLat, longitude: currentLng }}>
                        <View style={styles.markerContainer}>
                            <View style={[styles.markerPulse, { backgroundColor: tokens.colors.primary.purple + '40' }]} />
                            <View style={[styles.markerCore, { backgroundColor: tokens.colors.primary.purple, borderColor: tokens.colors.background.ambient }]} />
                        </View>
                    </Marker>
                )}
            </MapView>

            {/* Overlays */}
            <SafeAreaView style={styles.safeContainer} pointerEvents="box-none">

                {/* PHASE 8: LOCKOUT OVERLAY */}
                {isLockedOut && (
                    <View style={[StyleSheet.absoluteFill, styles.lockoutOverlay]} pointerEvents="auto">
                        <Surface intensity={80} style={styles.lockoutContent}>
                            <Txt variant="headingL" weight="bold" color={tokens.colors.status.error} style={{ marginBottom: 12 }}>
                                SYSTEM LOCKOUT
                            </Txt>
                            <Txt variant="bodyReg" color={tokens.colors.text.primary} style={{ marginBottom: 8, lineHeight: 22, textAlign: 'center' }}>
                                Your commission balance is below the -600 TTD line.
                            </Txt>
                            <Txt variant="caption" color={tokens.colors.text.secondary} style={{ marginBottom: 32, textAlign: 'center' }}>
                                You are blocked from receiving new rides until the backend balance is manually settled.
                            </Txt>

                            <TouchableOpacity
                                style={styles.bankTransferBtn}
                                onPress={() => Linking.openURL('https://wa.me/18685550100?text=I am locked out due to the commission cap. I would like to settle via Bank Transfer.')}
                            >
                                <Txt variant="bodyBold" color={tokens.colors.text.primary}>Contact Admin (Bank Transfer)</Txt>
                            </TouchableOpacity>
                        </Surface>
                    </View>
                )}

                {/* Header */}
                <View style={styles.header}>
                    <TouchableOpacity onPress={() => setSidebarVisible(true)} style={styles.menuBtn}>
                        <Surface style={styles.menuSurface} intensity={40}>
                            <Txt variant="headingM" color={tokens.colors.text.primary}>☰</Txt>
                        </Surface>
                    </TouchableOpacity>
                    <View style={{ flex: 1 }} />
                    <TouchableOpacity onPress={signOut} style={styles.signOutBtn}>
                        <Surface style={styles.signOutSurface} intensity={40}>
                            <Txt variant="bodyBold" color={tokens.colors.status.error}>Sign Out</Txt>
                        </Surface>
                    </TouchableOpacity>
                </View>

                {/* Bottom Content */}
                <View style={styles.content} pointerEvents="box-none">

                    {/* Big GO Button overlaid on map */}
                    <TouchableOpacity
                        style={[
                            styles.goButton,
                            isOnline ? styles.goOffline : styles.goOnline
                        ]}
                        onPress={toggleOnline}
                    >
                        <Txt variant="headingL" weight="bold" color={tokens.colors.text.primary} style={{ letterSpacing: 1 }}>
                            {isOnline ? 'STOP' : 'GO'}
                        </Txt>
                    </TouchableOpacity>

                    {/* Scanning Text */}
                    {isOnline && (
                        <Surface style={styles.scanningContainer} intensity={60}>
                            <ActivityIndicator color={tokens.colors.primary.purple} size="small" />
                            <Txt variant="bodyBold" color={tokens.colors.text.primary}>Searching for trips...</Txt>
                        </Surface>
                    )}

                    {/* Today's Stats */}
                    <Surface style={styles.statsContainer} intensity={40}>
                        <View style={styles.statBox}>
                            <Txt variant="caption" weight="bold" color={tokens.colors.text.secondary}>EARNINGS</Txt>
                            <Txt variant="headingM" weight="bold" color={tokens.colors.text.primary}>${todayEarnings.toFixed(2)}</Txt>
                        </View>
                        <View style={styles.statDivider} />
                        <View style={styles.statBox}>
                            <Txt variant="caption" weight="bold" color={tokens.colors.text.secondary}>TRIPS</Txt>
                            <Txt variant="headingM" weight="bold" color={tokens.colors.text.primary}>{todayTrips}</Txt>
                        </View>
                    </Surface>
                </Surface>
        </View>

            </SafeAreaView >

        {/* Sidebar Overlay */ }
        < Sidebar
    visible = { sidebarVisible }
    onClose = {() => setSidebarVisible(false)
}
user = {{
    name: driver?.name || 'Driver',
        rating: 5.0, // Wired later
            photo_url: undefined
}}
navigation = { navigation }
    />
        </View >
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: tokens.colors.background.base,
    },
    safeContainer: {
        flex: 1,
        justifyContent: 'space-between',
    },
    lockoutOverlay: {
        zIndex: 9999,
        backgroundColor: 'rgba(0,0,0,0.85)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 24,
    },
    lockoutContent: {
        padding: 32,
        borderRadius: 24,
        alignItems: 'center',
        width: '100%',
    },
    bankTransferBtn: {
        backgroundColor: tokens.colors.primary.purple,
        paddingHorizontal: 24,
        paddingVertical: 16,
        borderRadius: 30,
        width: '100%',
        alignItems: 'center',
    },
    header: {
        padding: 24,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    menuBtn: {
        shadowColor: tokens.colors.primary.purple,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2,
        shadowRadius: 12,
        elevation: 8,
    },
    menuSurface: {
        width: 48,
        height: 48,
        borderRadius: 24,
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: tokens.colors.border.subtle,
    },
    headerPill: {
        paddingHorizontal: 20,
        paddingVertical: 12,
        borderRadius: 24,
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 120,
    },
    signOutBtn: {
        overflow: 'hidden',
        borderRadius: 20,
    },
    signOutSurface: {
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderRadius: 20,
    },
    content: {
        padding: 24,
        justifyContent: 'flex-end',
        alignItems: 'center',
    },
    goButton: {
        width: 140,
        height: 140,
        borderRadius: 70,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 32,
        borderWidth: 4,
        borderColor: 'rgba(255, 255, 255, 0.15)',
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.4,
        shadowRadius: 10,
        elevation: 10,
    },
    goOnline: {
        backgroundColor: tokens.colors.primary.cyan,
    },
    goOffline: {
        backgroundColor: tokens.colors.status.error,
    },
    statsContainer: {
        flexDirection: 'row',
        width: '100%',
        padding: 20,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    statBox: {
        flex: 1,
        alignItems: 'center',
        gap: 4,
    },
    statDivider: {
        width: 1,
        height: '100%',
        backgroundColor: 'rgba(255,255,255,0.1)',
        marginHorizontal: 16,
    },
    scanningContainer: {
        flexDirection: 'row',
        paddingHorizontal: 20,
        paddingVertical: 12,
        borderRadius: 24,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 24,
        gap: 12,
    },
    markerContainer: {
        width: 40,
        height: 40,
        justifyContent: 'center',
        alignItems: 'center',
    },
    markerCore: {
        width: 18,
        height: 18,
        borderRadius: 9,
        borderWidth: 3,
    },
    markerPulse: {
        position: 'absolute',
        width: 40,
        height: 40,
        borderRadius: 20,
    }
});
