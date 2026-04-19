import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
    View, StyleSheet, TouchableOpacity, Text,
    ActivityIndicator, Linking, Alert, Animated,
    Dimensions, ScrollView, Image, RefreshControl
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import Constants from 'expo-constants';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MapView, { Marker, PROVIDER_DEFAULT, UrlTile } from 'react-native-maps';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import Reanimated, {
    useSharedValue, withSpring, withTiming, withRepeat, withDelay,
    withSequence, useAnimatedStyle,
    Easing, interpolate,
} from 'react-native-reanimated';
import { useAuth } from '../context/AuthContext';
import { useLocationTracking } from '../hooks/useLocationTracking';
import { DEFAULT_LOCATION, ENV } from '../../../../shared/env';
import { useRideOfferSubscription } from '../services/realtime';
import { supabase } from '../../../../shared/supabase';
import { Sidebar } from '../components/Sidebar';
import { Ionicons } from '@expo/vector-icons';

const { width, height } = Dimensions.get('window');
const PANEL_HEIGHT = height * 0.54;
const MAP_HEIGHT = height - PANEL_HEIGHT + 32;
const CAR_SIZE = 120;

const LOCKOUT_THRESHOLD_CENTS = -60000;
const SPRING_CFG = { damping: 20, stiffness: 150 };

// Blueberry Luxe — Gold Edition (Driver)
const COLORS = {
    bgPrimary: '#0D0B1E',
    bgSecondary: '#1A1508',
    gradientStart: '#1A1200',
    gradientEnd: '#0D0B1E',
    gold: '#FFD700',
    goldDark: '#B8860B',
    goldLight: '#FFEC8B',
    amber: '#FFB000',
    amberSoft: 'rgba(255,176,0,0.1)',
    purple: '#7B5CF0',
    purpleDark: '#5B3FD0',
    purpleLight: '#9B7CF0',
    white: '#FFFFFF',
    textSecondary: 'rgba(255,255,255,0.6)',
    textMuted: 'rgba(255,255,255,0.4)',
    glassBg: 'rgba(255,215,0,0.06)',
    glassBorder: 'rgba(255,176,0,0.3)',
    success: '#00FF94',
    warning: '#F59E0B',
    error: '#EF4444',
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function getGreeting() {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning,';
    if (h < 17) return 'Good afternoon,';
    return 'Good evening,';
}
function firstName(name?: string) {
    return name?.split(' ')[0] || 'Driver';
}

// ── ReanimatedText helper for count-up ────────────────────────────────────────
const AnimText = Reanimated.createAnimatedComponent(Text);

// ── Component ─────────────────────────────────────────────────────────────────
export function DashboardScreen({ navigation }: any) {
    const insets = useSafeAreaInsets();
    const { driver, toggleOnline, signOut, refreshPushToken } = useAuth();
    const { location, signalStatus } = useLocationTracking();
    const { offer, clearOffer } = useRideOfferSubscription(driver?.id);
    const isOnline = driver?.is_online;

    const [sidebarVisible, setSidebarVisible] = useState(false);
    const [balanceCents, setBalanceCents] = useState<number | null>(null);
    const [isToggling, setIsToggling] = useState(false);
    const [pushMissing, setPushMissing] = useState(false);
    const [isFixingPush, setIsFixingPush] = useState(false);
    const [todayTrips, setTodayTrips] = useState(0);
    const [todayEarnings, setTodayEarnings] = useState(0);
    const [carLabel, setCarLabel] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [systemStatus, setSystemStatus] = useState<any>({ stripe_ready: true, fcm_ready: true, config: {} });
    const [demandHint, setDemandHint] = useState<string | null>(null);

    // ── Reanimated shared values ──────────────────────────────────────────────
    const panelY = useSharedValue(PANEL_HEIGHT);
    const carY = useSharedValue(40);
    const carRotate = useSharedValue(0);
    const carSpinFast = useSharedValue(0);
    const earningsVal = useSharedValue(0);
    const glowRadius = useSharedValue(0);

    // Stat card stagger
    const card0 = useSharedValue(0);
    const card1 = useSharedValue(0);
    const card2 = useSharedValue(0);
    const cardScales = [card0, card1, card2];

    // Navigate tap quick-nav bounce
    const navBounce = [
        useSharedValue(1), useSharedValue(1),
        useSharedValue(1), useSharedValue(1),
    ];

    // Old Animated API for marker pulse
    const pulseScale = useRef(new Animated.Value(1)).current;
    const pulseOpacity = useRef(new Animated.Value(0)).current;

    // ── Mount animations ──────────────────────────────────────────────────────
    useEffect(() => {
        panelY.value = withSpring(0, SPRING_CFG);
        carY.value = withDelay(300, withSpring(-20, { damping: 14, stiffness: 120 }));
        carRotate.value = withRepeat(
            withTiming(360, { duration: 8000, easing: Easing.linear }),
            -1, false
        );
        [card0, card1, card2].forEach((c, i) => {
            c.value = withDelay(i * 70, withSpring(1, { damping: 12, stiffness: 200 }));
        });
    }, []);

    // ── Earnings count-up on data load ────────────────────────────────────────
    useEffect(() => {
        earningsVal.value = withTiming(todayEarnings, { duration: 900 });
    }, [todayEarnings]);

    // Fix 3: System Diagnostics & Recovery
    useEffect(() => {
        const fetchStatus = async () => {
            try {
                const { data, error } = await supabase.functions.invoke('get_system_status');
                if (!error && data?.success) {
                    setSystemStatus(data.data);
                }
            } catch (err) {
                console.warn('System status check failed:', err);
            }
        };
        fetchStatus();

        // [Phase 3] ACTIVE TRIP RECOVERY
        const checkActiveTrip = async () => {
            if (!driver?.id) return;
            try {
                const { data } = await supabase
                    .from('rides')
                    .select('id')
                    .eq('driver_id', driver.id)
                    .in('status', ['assigned', 'arrived', 'in_progress'])
                    .maybeSingle();

                if (data?.id) {
                    console.log('[Phase 3] Active trip detected for driver. Hardening navigation...');
                    navigation.replace('ActiveTrip', { rideId: data.id });
                }
            } catch (e) {
                console.warn('[Phase 3] Driver recovery check failed:', e);
            }
        };
        checkActiveTrip();
    }, [driver?.id]);

    // ── Online glow ───────────────────────────────────────────────────────────
    useEffect(() => {
        glowRadius.value = withSpring(isOnline ? 80 : 0, { damping: 14, stiffness: 100 });
    }, [isOnline]);

    // ── Marker pulse ──────────────────────────────────────────────────────────
    useEffect(() => {
        if (!isOnline) { pulseOpacity.setValue(0); return; }
        const loop = Animated.loop(Animated.sequence([
            Animated.parallel([
                Animated.timing(pulseScale, { toValue: 1.6, duration: 1200, useNativeDriver: true }),
                Animated.timing(pulseOpacity, { toValue: 0, duration: 1200, useNativeDriver: true }),
            ]),
            Animated.parallel([
                Animated.timing(pulseScale, { toValue: 1, duration: 0, useNativeDriver: true }),
                Animated.timing(pulseOpacity, { toValue: 0.5, duration: 0, useNativeDriver: true }),
            ]),
        ]));
        pulseOpacity.setValue(0.5);
        loop.start();
        return () => loop.stop();
    }, [isOnline]);

    // FIX #4: AI Demand Prediction
    const [demandZones, setDemandZones] = useState<any[] | null>(null);
    
    useEffect(() => {
        if (!isOnline || !location?.coords) { 
            setDemandHint(null); 
            setDemandZones(null);
            return; 
        }

        const dLat = location.coords.latitude;
        const dLng = location.coords.longitude;

        const fetchDemandPrediction = async () => {
            try {
                const { data: predictions, error } = await supabase.rpc('get_demand_prediction', {
                    p_lat: dLat,
                    p_lng: dLng,
                    p_radius_meters: 5000
                });
                
                if (error) throw error;
                
                if (predictions && predictions.length > 0) {
                    setDemandZones(predictions);
                    const topZone = predictions[0];
                    if (topZone.demand_score > 2.0) {
                        setDemandHint(`🔥 HIGH DEMAND ZONE: ${topZone.predicted_demand} expected rides. Stay here!`);
                    } else if (topZone.demand_score > 1.5) {
                        setDemandHint(`📈 Good opportunity: ${topZone.predicted_demand} rides expected`);
                    } else if (topZone.demand_score < 0.5) {
                        setDemandHint(`📉 Low demand. Consider moving to a busier area.`);
                    } else {
                        setDemandHint(`📊 Normal demand. ${topZone.active_drivers} drivers nearby.`);
                    }
                } else {
                    setDemandZones(null);
                    setDemandHint(null);
                }
            } catch (err) { 
                console.warn('Demand prediction failed:', err);
            }
        };

        fetchDemandPrediction();
        const interval = setInterval(fetchDemandPrediction, 60000);
        return () => clearInterval(interval);
    }, [isOnline, location?.coords?.latitude, location?.coords?.longitude]);

    // Fetch today's stats
    useEffect(() => {
        if (!driver?.id) return;
        const fetchStats = async () => {
            try {
                const { data } = await supabase
                    .from('driver_daily_stats')
                    .select('total_trips, total_earnings_cents')
                    .eq('driver_id', driver.id)
                    .eq('date', new Date().toISOString().split('T')[0])
                    .maybeSingle();
                if (data) {
                    setTodayTrips(data.total_trips || 0);
                    setTodayEarnings((data.total_earnings_cents || 0) / 100);
                }
            } catch (e) { console.warn('Stats fetch failed:', e); }
        };
        fetchStats();
    }, [driver?.id]);

    // Fetch driver balance
    useEffect(() => {
        if (!driver?.id) return;
        const fetchBalance = async () => {
            try {
                const { data } = await supabase
                    .from('driver_balances')
                    .select('balance_cents')
                    .eq('driver_id', driver.id)
                    .maybeSingle();
                if (data) setBalanceCents(data.balance_cents || 0);
            } catch (e) { console.warn('Balance fetch failed:', e); }
        };
        fetchBalance();
    }, [driver?.id]);

    // Push notification check
    useEffect(() => {
        const checkPush = async () => {
            try {
                const { data } = await supabase.functions.invoke('check_push_status', {
                    body: { user_id: driver?.id, app: 'driver' }
                });
                if (data?.status === 'missing') setPushMissing(true);
                else setPushMissing(false);
            } catch (e) { console.warn('Push check failed:', e); }
        };
        if (driver?.id) checkPush();
    }, [driver?.id]);

    // ─── Derived values ──────────────────────────────────────────────────────
    const currentLat = location?.coords?.latitude ?? DEFAULT_LOCATION.latitude;
    const currentLng = location?.coords?.longitude ?? DEFAULT_LOCATION.longitude;
    const isPending = (driver as any)?.approval_status === 'pending';
    const isLockedOut = (balanceCents ?? 0) < LOCKOUT_THRESHOLD_CENTS;

    // ─── Animated styles ───────────────────────────────────────────────────────
    const panelStyle = useAnimatedStyle(() => ({
        transform: [{ translateY: panelY.value }],
    }));
    const carStyle = useAnimatedStyle(() => ({
        transform: [
            { translateY: carY.value },
            { rotate: `${carRotate.value + carSpinFast.value}deg` },
        ],
    }));
    const fareText = useAnimatedStyle(() => ({
        color: earningsVal.value > 0 ? COLORS.gold : '#FFF',
    }));
        const glowStyle = useAnimatedStyle(() => ({
        opacity: interpolate(glowRadius.value, [0, 80], [0, 1]),
    }));

    const makeCardStyle = (sv: any) =>
        useAnimatedStyle(() => ({
            opacity: sv.value,
            transform: [{ scale: interpolate(sv.value, [0, 1], [0.9, 1]) }],
        }));
    const card0Style = makeCardStyle(card0);
    const card1Style = makeCardStyle(card1);
    const card2Style = makeCardStyle(card2);

    const navStyles = navBounce.map((nb) =>
        useAnimatedStyle(() => ({
            transform: [{ scale: nb.value }],
        }))
    );

    // ─── Handlers ──────────────────────────────────────────────────────────────
    const handleToggle = async () => {
        setIsToggling(true);
        try {
            await toggleOnline();
        } finally {
            setIsToggling(false);
        }
    };
    const handleCarTap = () => {
        carSpinFast.value = withSequence(
            withTiming(360, { duration: 600, easing: Easing.out(Easing.quad) }),
            withTiming(0, { duration: 0 })
        );
        setCarLabel(true);
        setTimeout(() => setCarLabel(false), 2000);
    };
    const handleFixPush = async () => {
        setIsFixingPush(true);
        try {
            await refreshPushToken?.();
            setPushMissing(false);
        } catch (e) {
            Alert.alert('Push Setup Failed', 'Please enable notifications in Settings.');
        } finally {
            setIsFixingPush(false);
        }
    };
    const onRefresh = useCallback(async () => {
        setRefreshing(true);
        try {
            const { data } = await supabase.functions.invoke('get_system_status');
            if (data?.success) setSystemStatus(data.data);
        } catch (e) { console.warn('Refresh failed:', e); }
        setRefreshing(false);
    }, []);

    // ─── Offer redirect ────────────────────────────────────────────────────────
    useEffect(() => {
        if (offer?.ride_id) {
            navigation.navigate('TripRequest', { rideId: offer.ride_id, offer });
        }
    }, [offer]);

    // ─── Render states ─────────────────────────────────────────────────────────
    // PENDING SCREEN
    if (isPending) return (
        <View style={[s.root, s.center]}>
            <StatusBar style="light" />
            <LinearGradient colors={[COLORS.gradientStart, COLORS.bgPrimary]} style={StyleSheet.absoluteFillObject} />
            <View style={s.iconCircle}>
                <Ionicons name="hourglass-outline" size={32} color={COLORS.purpleLight} />
            </View>
            <Text style={[s.centerTitle, { fontSize: 24, fontWeight: '800', color: '#FFF' }]}>
                APPLICATION UNDER REVIEW
            </Text>
            <Text style={[s.centerBody, { fontSize: 14, fontWeight: '600', color: COLORS.textMuted }]}>
                YOUR PILOT PROFILE HAS BEEN SUBMITTED. YOU'LL BE NOTIFIED ONCE AN ADMINISTRATOR MISSION-CLEARS YOUR ACCOUNT.
            </Text>
            <TouchableOpacity style={s.outlineBtn} onPress={signOut}>
                <Ionicons name="log-out-outline" size={16} color={COLORS.error} />
                <Text style={{ fontSize: 14, fontWeight: '700', color: COLORS.error }}> TERMINATE SESSION</Text>
            </TouchableOpacity>
        </View>
    );

    // LOCKOUT SCREEN
    if (isLockedOut) return (
        <View style={s.root}>
            <StatusBar style="light" />
            <LinearGradient colors={[COLORS.gradientStart, COLORS.bgPrimary]} style={StyleSheet.absoluteFillObject} />
            <View style={[s.center, { flex: 1 }]}>
                <View style={[s.iconCircle, { backgroundColor: 'rgba(239, 68, 68, 0.15)', width: 100, height: 100, borderRadius: 50 }]}>
                    <Ionicons name="alert-circle" size={48} color={COLORS.error} />
                </View>
                <Text style={[s.centerTitle, { marginTop: 24, fontSize: 32, fontWeight: '900', color: COLORS.error }]}>
                    ACCOUNT SUSPENDED
                </Text>
                <Text style={{ marginBottom: 12, fontSize: 20, fontWeight: '800', color: '#FFF' }}>
                    ${(Math.abs(balanceCents || 0) / 100).toFixed(2)} TTD COMMISSION DEBT
                </Text>
                <Text style={[s.centerBody, { fontSize: 14, fontWeight: '600', color: COLORS.textMuted }]}>
                    YOUR ACCOUNT HAS BEEN AUTOMATICALLY SUSPENDED DUE TO EXCESSIVE COMMISSION DEBT. SETTLE YOUR BALANCE TO RESUME LOGISTICS OPERATIONS.
                </Text>
                <TouchableOpacity
                    style={[s.solidBtn, { backgroundColor: COLORS.error, width: '100%' }]}
                    onPress={() => Linking.openURL('https://wa.me/18685550100?text=I need to settle my G-Taxi commission balance.')}
                >
                    <Ionicons name="logo-whatsapp" size={20} color="#FFF" />
                    <Text style={{ fontSize: 14, fontWeight: '700', color: '#FFF' }}> SETTLE BALANCE NOW</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.outlineBtn, { marginTop: 20, borderColor: 'rgba(255,255,255,0.1)' }]} onPress={signOut}>
                    <Text style={{ fontSize: 14, fontWeight: '600', color: COLORS.textMuted }}>TERMINATE SESSION</Text>
                </TouchableOpacity>
            </View>
        </View>
    );

    // MAINTENANCE SCREEN
    if (systemStatus.config?.maintenance_mode === 'true') return (
        <View style={[s.root, s.center]}>
            <StatusBar style="light" />
            <LinearGradient colors={[COLORS.gradientStart, COLORS.bgPrimary]} style={StyleSheet.absoluteFillObject} />
            <BlurView tint="dark" intensity={100} style={StyleSheet.absoluteFillObject}>
                <View style={[s.center, { marginTop: height * 0.2 }]}>
                    <Ionicons name="construct-outline" size={64} color={COLORS.purple} />
                    <Text style={[s.centerTitle, { marginTop: 24, fontSize: 24, fontWeight: '800', color: '#FFF' }]}>
                        SYSTEM MAINTENANCE
                    </Text>
                    <Text style={[s.centerBody, { fontSize: 14, fontWeight: '600', color: COLORS.textMuted }]}>
                        G-TAXI IS CURRENTLY UNDERGOING MISSION-CRITICAL SYSTEMS MAINTENANCE. PLEASE CHECK BACK SHORTLY.
                    </Text>
                </View>
            </BlurView>
        </View>
    );

    // UPDATE REQUIRED SCREEN
    const isUpdateRequired = (() => {
        if (!systemStatus.config?.min_version_driver || !Constants.expoConfig?.version) return false;
        const current = Constants.expoConfig.version.split('.').map(Number);
        const min = systemStatus.config.min_version_driver.split('.').map(Number);
        for (let i = 0; i < 3; i++) {
            if ((current[i] || 0) < (min[i] || 0)) return true;
            if ((current[i] || 0) > (min[i] || 0)) return false;
        }
        return false;
    })();

    if (isUpdateRequired) return (
        <View style={[s.root, s.center]}>
            <StatusBar style="light" />
            <LinearGradient colors={[COLORS.gradientStart, COLORS.bgPrimary]} style={StyleSheet.absoluteFillObject} />
            <BlurView tint="dark" intensity={100} style={StyleSheet.absoluteFillObject}>
                <View style={[s.center, { marginTop: height * 0.2 }]}>
                    <Ionicons name="cloud-download-outline" size={64} color={COLORS.purple} />
                    <Text style={[s.centerTitle, { marginTop: 24, fontSize: 24, fontWeight: '800', color: '#FFF' }]}>
                        SECURE UPDATE REQUIRED
                    </Text>
                    <Text style={[s.centerBody, { fontSize: 14, fontWeight: '600', color: COLORS.textMuted }]}>
                        A MANDATORY SECURITY PATCH IS REQUIRED TO ACCESS THE G-TAXI DRIVER NETWORK.
                    </Text>
                    <TouchableOpacity style={[s.solidBtn, { backgroundColor: COLORS.purple }]} onPress={() => Alert.alert("Update", "Please update via the App Store or Google Play.")}>
                        <Text style={{ fontSize: 14, fontWeight: '700', color: '#FFF' }}>DOWNLOAD NOW</Text>
                    </TouchableOpacity>
                </View>
            </BlurView>
        </View>
    );

    // MAIN DASHBOARD
    const QUICK_NAV = [
        { icon: 'wallet-outline', label: 'Wallet', screen: 'Wallet' },
        { icon: 'bar-chart-outline', label: 'Earnings', screen: 'Earnings' },
        { icon: 'calendar-outline', label: 'Schedule', screen: 'ScheduledRides' },
        { icon: 'person-outline', label: 'Profile', screen: 'Profile' },
    ];

    return (
        <View style={s.root}>
            <StatusBar style="light" />
            <LinearGradient colors={[COLORS.gradientStart, COLORS.bgPrimary]} style={StyleSheet.absoluteFillObject} />

            {/* ── MAP BACKGROUND ───────────────────────────────────────────────── */}
            <View style={[s.mapContainer, { height: MAP_HEIGHT }]}>
                <MapView
                    style={StyleSheet.absoluteFillObject}
                    provider={PROVIDER_DEFAULT}
                    initialRegion={{ latitude: currentLat, longitude: currentLng, latitudeDelta: 0.05, longitudeDelta: 0.05 }}
                >
                    <UrlTile urlTemplate={`https://api.mapbox.com/styles/v1/mapbox/dark-v11/tiles/256/{z}/{x}/{y}@2x?access_token=${ENV.MAPBOX_PUBLIC_TOKEN}`} shouldReplaceMapContent maximumZ={19} />
                    {location && (
                        <Marker coordinate={{ latitude: currentLat, longitude: currentLng }}>
                            <View style={s.markerWrap}>
                                <Animated.View style={[
                                    s.markerRing,
                                    {
                                        transform: [{ scale: pulseScale }], opacity: pulseOpacity,
                                        borderColor: isOnline ? COLORS.success : COLORS.purple
                                    }
                                ]} />
                                <View style={[s.markerCore, { backgroundColor: isOnline ? COLORS.success : COLORS.purple }]} />
                            </View>
                        </Marker>
                    )}
                </MapView>

                {/* Menu button & Logo — top */}
                <View style={[s.mapOverlay, { top: insets.top + 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: width - 40 }]} pointerEvents="box-none">
                    <TouchableOpacity
                        style={s.mapBtn}
                        onPress={() => {
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                            setSidebarVisible(true);
                        }}
                        activeOpacity={0.8}
                    >
                        <Ionicons name="menu-outline" size={22} color={'#FFFFFF'} />
                    </TouchableOpacity>
                    <Text style={{ fontSize: 22, fontWeight: '900', color: COLORS.gold, letterSpacing: 2 }}>G-TAXI</Text>
                </View>

                {/* Searching chip — top center */}
                {isOnline && (
                    <View style={s.searchChipContainer}>
                        <View style={s.searchChip}>
                            <ActivityIndicator color={COLORS.success} size="small" />
                            <Text style={{ marginLeft: 8, fontSize: 12, fontWeight: '700', color: COLORS.success, letterSpacing: 0.5 }}>
                                SEARCHING FOR TRIPS
                            </Text>
                        </View>
                        <View style={[s.signalChip, { 
                            borderColor: signalStatus === 'lock' ? 'rgba(16,185,129,0.3)' : 
                                         signalStatus === 'dead_reckoning' ? 'rgba(245,158,11,0.4)' : 'rgba(239,68,68,0.3)' 
                        }]}>
                            <Ionicons 
                                name={signalStatus === 'lock' ? "radio-outline" : signalStatus === 'dead_reckoning' ? "pulse-outline" : "alert-circle-outline"} 
                                size={12} 
                                color={signalStatus === 'lock' ? COLORS.success : signalStatus === 'dead_reckoning' ? COLORS.warning : COLORS.error} 
                            />
                            <Text style={{ marginLeft: 4, fontSize: 11, fontWeight: '700', color: signalStatus === 'lock' ? COLORS.success : signalStatus === 'dead_reckoning' ? COLORS.warning : COLORS.error }}>
                                {signalStatus === 'lock' ? 'GPS LOCK' : signalStatus === 'dead_reckoning' ? 'SIGNAL SURVIVAL' : 'NO SIGNAL'}
                            </Text>
                        </View>
                    </View>
                )}
            </View>

            {/* ── CAR PNG — floats ABOVE panel edge ──────────────────────────── */}
            <Reanimated.View style={[s.carWrap, carStyle]}>
                {isOnline && (
                    <LinearGradient
                        colors={[COLORS.gold, COLORS.amber]}
                        style={{ position: 'absolute', width: 200, height: 200, borderRadius: 100, opacity: 0.15, top: -40 }}
                        start={{ x: 0.5, y: 0 }}
                        end={{ x: 0.5, y: 1 }}
                    />
                )}
                <TouchableOpacity onPress={handleCarTap} activeOpacity={0.9}>
                    <Image
                        source={require('../../assets/images/car_gtaxi_standard_v7.png')}
                        style={s.carImg}
                        resizeMode="contain"
                    />
                </TouchableOpacity>
                {carLabel && (
                    <Text style={[s.carLabel, { fontSize: 11, fontWeight: '700', color: COLORS.purpleLight }]}>
                        G-Taxi Standard
                    </Text>
                )}
            </Reanimated.View>

            {/* ── BOTTOM PANEL ─────────────────────────────────────────────────── */}
            <Reanimated.View style={[s.panelOuter, panelStyle]}>
                <BlurView tint="dark" intensity={60} style={{ flex: 1 }}>
                    <View style={s.panelInner}>
                        <View style={s.handle} />

                        <ScrollView
                            showsVerticalScrollIndicator={false}
                            contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
                            bounces={true}
                            refreshControl={
                                <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.gold} colors={[COLORS.gold]} />
                            }
                        >
                            {/* Greeting row */}
                            <View style={s.greetingRow}>
                                <View>
                                    <Text style={{ fontSize: 11, fontWeight: '700', color: COLORS.textMuted, letterSpacing: 1.5 }}>
                                        {getGreeting().toUpperCase()}
                                    </Text>
                                    <Text style={[s.driverName, { fontSize: 24, fontWeight: '800', color: '#FFF' }]}>
                                        {firstName(driver?.name)}
                                    </Text>
                                </View>

                                <TouchableOpacity
                                    style={[s.statusPill, isOnline ? s.statusPillOn : s.statusPillOff]}
                                    onPress={() => {
                                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                                        handleToggle();
                                    }}
                                    disabled={isToggling}
                                    activeOpacity={0.85}
                                >
                                    {isToggling ? (
                                        <ActivityIndicator color={COLORS.gold} size="small" />
                                    ) : (
                                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                            <View style={[s.statusDot, { backgroundColor: isOnline ? COLORS.gold : 'rgba(174, 169, 181, 0.2)' }]} />
                                            <Text style={{ fontSize: 14, fontWeight: '700', color: isOnline ? COLORS.gold : '#AEA9B5' }}>
                                                {isOnline ? 'ONLINE' : 'OFFLINE'}
                                            </Text>
                                        </View>
                                    )}
                                </TouchableOpacity>
                            </View>

                            {/* Push notification banner */}
                            {pushMissing && (
                                <TouchableOpacity
                                    style={s.pushBanner}
                                    onPress={handleFixPush}
                                    disabled={isFixingPush}
                                    activeOpacity={0.8}
                                >
                                    <Ionicons name="notifications-off-outline" size={16} color={COLORS.warning} />
                                    <Text style={{ flex: 1, marginLeft: 8, fontSize: 11, fontWeight: '700', color: COLORS.warning }}>
                                        {isFixingPush ? 'ENABLING...' : 'PUSH OFFLINE — TAP TO ENABLE ALERTS'}
                                    </Text>
                                    <Ionicons name="chevron-forward" size={14} color={COLORS.warning} />
                                </TouchableOpacity>
                            )}

                            {/* Debt Warning Banner */}
                            {balanceCents !== null && balanceCents <= -40000 && !isLockedOut && (
                                <View style={s.debtBanner}>
                                    <BlurView intensity={20} tint="dark" style={s.debtBlur}>
                                        <Ionicons name="warning" size={20} color={COLORS.warning} />
                                        <View style={{ flex: 1, marginLeft: 12 }}>
                                            <Text style={{ fontSize: 14, fontWeight: '700', color: COLORS.warning }}>DEBT WARNING</Text>
                                            <Text style={{ fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.6)' }}>
                                                Your debt is ${(Math.abs(balanceCents)/100).toFixed(2)}. Lockout at $600.00.
                                            </Text>
                                        </View>
                                    </BlurView>
                                </View>
                            )}

                            {/* FCM Server Connectivity Warning */}
                            {!systemStatus.fcm_ready && (
                                <View style={[s.pushBanner, { backgroundColor: 'rgba(239, 68, 68, 0.1)', borderColor: 'rgba(239, 68, 68, 0.3)' }]}>
                                    <Ionicons name="alert-circle-outline" size={16} color={COLORS.error} />
                                    <Text style={{ flex: 1, marginLeft: 8, fontSize: 11, fontWeight: '700', color: COLORS.error }}>
                                        Push Offline: Server keys missing. Stay in the app to receive requests.
                                    </Text>
                                </View>
                            )}

                            {/* Stat cards */}
                            <View style={s.statsRow}>
                                {/* Earnings card */}
                                <Reanimated.View style={[{ flex: 1 }, card0Style]}>
                                    <TouchableOpacity
                                        activeOpacity={0.8}
                                        onPress={() => {
                                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                            navigation.navigate('Earnings');
                                        }}
                                    >
                                        <View style={[s.statCard, { borderColor: 'rgba(245,158,11,0.25)', backgroundColor: 'rgba(245,158,11,0.05)' }]}>
                                            <Ionicons name="cash-outline" size={16} color={COLORS.warning} style={{ marginBottom: 4 }} />
                                            <Text style={[s.statLabel, { fontSize: 10, fontWeight: '700', color: COLORS.warning }]}>EARNINGS</Text>
                                            <Text style={{ fontSize: 20, fontWeight: '800', color: '#FFF' }}>
                                                ${todayEarnings.toFixed(2)}
                                            </Text>
                                            <Text style={{ fontSize: 10, fontWeight: '600', color: COLORS.textMuted }}>TODAY · TTD</Text>
                                        </View>
                                    </TouchableOpacity>
                                </Reanimated.View>

                                {/* Trips card */}
                                <Reanimated.View style={[{ flex: 1 }, card1Style]}>
                                    <TouchableOpacity
                                        activeOpacity={0.8}
                                        onPress={() => {
                                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                            navigation.navigate('ScheduledRides');
                                        }}
                                    >
                                        <View style={[s.statCard, { borderColor: 'rgba(255,215,0,0.2)', backgroundColor: 'rgba(255,215,0,0.03)' }]}>
                                            <Ionicons name="car-outline" size={16} color={COLORS.gold} style={{ marginBottom: 4 }} />
                                            <Text style={[s.statLabel, { fontSize: 10, fontWeight: '700', color: COLORS.gold }]}>TRIPS</Text>
                                            <Text style={{ fontSize: 20, fontWeight: '800', color: '#FFF' }}>
                                                {todayTrips}
                                            </Text>
                                            <Text style={{ fontSize: 10, fontWeight: '600', color: COLORS.textMuted }}>COMPLETED</Text>
                                        </View>
                                    </TouchableOpacity>
                                </Reanimated.View>

                                {/* Balance card */}
                                <Reanimated.View style={[{ flex: 1 }, card2Style]}>
                                    <TouchableOpacity
                                        activeOpacity={0.8}
                                        onPress={() => {
                                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                            navigation.navigate('Wallet');
                                        }}
                                    >
                                        <View style={[s.statCard, {
                                            borderColor: balanceCents !== null && balanceCents < 0 ? 'rgba(239,68,68,0.3)' : 'rgba(16,185,129,0.3)',
                                            backgroundColor: balanceCents !== null && balanceCents < 0 ? 'rgba(239,68,68,0.1)' : 'rgba(16,185,129,0.05)'
                                        }]}>
                                            <Ionicons
                                                name="wallet-outline" size={16}
                                                color={balanceCents !== null && balanceCents < 0 ? COLORS.error : COLORS.success}
                                                style={{ marginBottom: 4 }}
                                            />
                                            <Text style={[s.statLabel, { fontSize: 10, fontWeight: '700', color: balanceCents !== null && balanceCents < 0 ? COLORS.error : COLORS.success }]}>
                                                BALANCE
                                            </Text>
                                            <Text style={{ fontSize: 20, fontWeight: '800', color: '#FFF' }}>
                                                {balanceCents !== null ? `$${(Math.abs(balanceCents) / 100).toFixed(0)}` : '--'}
                                            </Text>
                                            <Text style={{ fontSize: 10, fontWeight: '600', color: COLORS.textMuted }}>TTD</Text>
                                        </View>
                                    </TouchableOpacity>
                                </Reanimated.View>
                            </View>

                            {/* Demand hint */}
                            {isOnline && demandHint && (
                                <View style={s.demandHintRow}>
                                    <Ionicons name="flash" size={14} color={demandHint.startsWith('HIGH') ? COLORS.gold : COLORS.textMuted} />
                                    <Text style={{ marginLeft: 8, flex: 1, fontSize: 11, fontWeight: '700', color: demandHint.startsWith('HIGH') ? COLORS.gold : COLORS.textMuted, letterSpacing: 0.5 }}>
                                        {demandHint.toUpperCase()}
                                    </Text>
                                </View>
                            )}

                            {/* Quick nav */}
                            <Text style={[s.sectionLabel, { fontSize: 10, fontWeight: '700', color: COLORS.textMuted }]}>
                                QUICK ACCESS
                            </Text>
                            <View style={s.quickRow}>
                                {QUICK_NAV.map((item, i) => (
                                    <Reanimated.View key={item.screen} style={[{ flex: 1 }, navStyles[i]]}>
                                        <TouchableOpacity
                                            style={s.quickCard}
                                            onPress={() => {
                                                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                                navBounce[i].value = withSequence(
                                                    withSpring(1.2, { damping: 8, stiffness: 300 }),
                                                    withSpring(1.0, { damping: 10, stiffness: 200 })
                                                );
                                                navigation.navigate(item.screen);
                                            }}
                                            activeOpacity={0.7}
                                        >
                                            <View style={s.quickIcon}>
                                                <Ionicons name={item.icon as any} size={20} color={COLORS.gold} />
                                            </View>
                                            <Text style={{ marginTop: 6, fontSize: 10, fontWeight: '700', color: COLORS.textMuted }}>
                                                {item.label.toUpperCase()}
                                            </Text>
                                        </TouchableOpacity>
                                    </Reanimated.View>
                                ))}
                            </View>
                        </ScrollView>
                    </View>
                </BlurView>
            </Reanimated.View>

            {/* Sidebar */}
            <Sidebar
                visible={sidebarVisible}
                onClose={() => setSidebarVisible(false)}
                user={{ name: driver?.name || 'Driver', rating: 5.0, photo_url: undefined }}
                navigation={navigation}
            />

            {/* Maintenance Overlay */}
            {systemStatus?.config?.maintenance_mode === 'true' && (
                <View style={[StyleSheet.absoluteFillObject, s.lockOverlay]}>
                    <BlurView tint="dark" intensity={100} style={s.lockBlur}>
                        <Ionicons name="construct" size={64} color={COLORS.purple} />
                        <Text style={{ marginTop: 24, fontSize: 24, fontWeight: '800', color: '#FFF', textAlign: 'center' }}>FLEET OFFLINE</Text>
                        <Text style={{ marginTop: 12, fontSize: 14, fontWeight: '600', color: COLORS.textMuted, textAlign: 'center', paddingHorizontal: 40 }}>
                            G-TAXI IS CURRENTLY PERFORMING MISSION-CRITICAL SYSTEMS MAINTENANCE. NAVIGATION AND DISPATCH ARE TEMPORARILY SUSPENDED.
                        </Text>
                    </BlurView>
                </View>
            )}

            {/* Update Required Overlay */}
            {systemStatus?.config?.min_version_driver && Constants.expoConfig?.version && (
                (() => {
                    const current = Constants.expoConfig.version.split('.').map(Number);
                    const min = systemStatus.config.min_version_driver.split('.').map(Number);
                    let needsUpdate = false;
                    for (let i = 0; i < 3; i++) {
                        if ((current[i] || 0) < (min[i] || 0)) { needsUpdate = true; break; }
                        if ((current[i] || 0) > (min[i] || 0)) break;
                    }
                    
                    if (needsUpdate) {
                        return (
                            <View style={[StyleSheet.absoluteFillObject, s.lockOverlay]}>
                                <BlurView tint="dark" intensity={100} style={s.lockBlur}>
                                    <Ionicons name="cloud-download" size={64} color={COLORS.purple} />
                                    <Text style={{ marginTop: 24, fontSize: 24, fontWeight: '800', color: '#FFF', textAlign: 'center' }}>SECURE UPDATE REQUIRED</Text>
                                    <Text style={{ marginTop: 12, fontSize: 14, fontWeight: '600', color: COLORS.textMuted, textAlign: 'center', paddingHorizontal: 40 }}>
                                        A MANDATORY SECURITY PATCH (V{systemStatus.config.min_version_driver}) IS REQUIRED TO ACCESS THE G-TAXI DRIVER NETWORK.
                                    </Text>
                                    <TouchableOpacity 
                                        style={[s.solidBtn, { backgroundColor: COLORS.purple, marginTop: 32 }]} 
                                        onPress={() => Alert.alert("Secure Update", "Please download the latest build from the pilot portal.")}
                                    >
                                        <Text style={{ fontSize: 14, fontWeight: '700', color: '#FFF' }}>Download Now</Text>
                                    </TouchableOpacity>
                                </BlurView>
                            </View>
                        );
                    }
                    return null;
                })()
            )}
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: '#0A0718' },
    center: { justifyContent: 'center', alignItems: 'center', padding: 32 },

    // Pending / lockout
    iconCircle: { width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(124, 58, 237, 0.08)', justifyContent: 'center', alignItems: 'center', marginBottom: 24 },
    centerTitle: { textAlign: 'center', marginBottom: 12 },
    centerBody: { textAlign: 'center', lineHeight: 24, paddingHorizontal: 24, marginBottom: 32 },
    outlineBtn: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 28, borderRadius: 50, borderWidth: 1, borderColor: 'rgba(239,68,68,0.35)' },
    solidBtn: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, paddingHorizontal: 32, borderRadius: 50, gap: 8 },

    // Map
    mapContainer: { width: '100%', overflow: 'hidden' },
    mapFog: { position: 'absolute', bottom: 0, left: 0, right: 0, height: '40%' },
    mapOverlay: { position: 'absolute', left: 20 },
    mapBtn: {
        width: 44, height: 44, borderRadius: 22,
        backgroundColor: 'rgba(7,5,15,0.85)',
        borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)',
        justifyContent: 'center', alignItems: 'center',
    },
    debtBanner: { marginHorizontal: 20, marginTop: 16, borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(245,158,11,0.3)' },
    debtBlur: { flexDirection: 'row', alignItems: 'center', padding: 16 },
    searchChipContainer: {
        position: 'absolute',
        top: 100,
        width: '100%',
        alignItems: 'center',
        gap: 8,
    },
    searchChip: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(7,5,15,0.9)',
        borderWidth: 1,
        borderColor: 'rgba(0,255,194,0.3)',
        paddingHorizontal: 16,
        paddingVertical: 9,
        borderRadius: 50,
    },
    signalChip: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(5,5,10,0.85)',
        paddingHorizontal: 12,
        paddingVertical: 4,
        borderRadius: 12,
        borderWidth: 1,
    },
    markerWrap: { width: 32, height: 32, justifyContent: 'center', alignItems: 'center' },
    markerRing: { position: 'absolute', width: 32, height: 32, borderRadius: 16, borderWidth: 2 },
    markerCore: { width: 12, height: 12, borderRadius: 6, borderWidth: 2.5, borderColor: '#0A0718' },

    // Car PNG
    carWrap: {
        position: 'absolute',
        bottom: PANEL_HEIGHT - 20,
        left: 0,
        right: 0,
        alignItems: 'center',
        zIndex: 10,
    },
    carImg: { width: CAR_SIZE, height: CAR_SIZE },
    carLabel: {
        marginTop: 4,
        letterSpacing: 0.5,
        textAlign: 'center',
        backgroundColor: 'rgba(7,5,15,0.7)',
        paddingHorizontal: 10, paddingVertical: 4,
        borderRadius: 8,
    },

    // Panel
    panelOuter: {
        position: 'absolute', bottom: 0, left: 0, right: 0,
        height: PANEL_HEIGHT,
        borderTopLeftRadius: 36, borderTopRightRadius: 36,
        overflow: 'hidden',
        shadowColor: '#000', shadowOffset: { width: 0, height: -8 },
        shadowOpacity: 0.3, shadowRadius: 16, elevation: 20,
    },
    blurFill: { flex: 1 },
    panelInner: { flex: 1, paddingHorizontal: 20, paddingTop: 12 },
    handle: { width: 44, height: 5, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 3, alignSelf: 'center', marginBottom: 20 },

    // Push notification banner
    pushBanner: {
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: 'rgba(245,158,11,0.08)', borderWidth: 1, borderColor: 'rgba(245,158,11,0.2)',
        borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 14,
    },

    // Greeting
    greetingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
    driverName: { marginTop: 2, letterSpacing: -0.5 },
    statusPill: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 18, paddingVertical: 11, borderRadius: 50 },
    statusPillOn: { backgroundColor: 'rgba(255,215,0,0.08)', borderWidth: 1, borderColor: 'rgba(255,215,0,0.25)' },
    statusPillOff: { backgroundColor: 'rgba(255,255,255,0.02)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
    statusDot: { width: 7, height: 7, borderRadius: 3.5 },

    // Stats
    statsRow: { flexDirection: 'row', gap: 10, marginBottom: 24 },
    statCard: {
        borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.02)',
        paddingVertical: 18, paddingHorizontal: 14,
        gap: 4, 
        shadowColor: '#000', shadowOffset: { width: 4, height: 4 },
        shadowOpacity: 0.35, shadowRadius: 10, elevation: 6,
        borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)',
    },
    statLabel: { letterSpacing: 0.5, marginBottom: 2 },

    // Quick nav
    sectionLabel: { letterSpacing: 1, marginBottom: 12 },
    quickRow: { flexDirection: 'row', gap: 10 },
    quickCard: {
        flex: 1, backgroundColor: 'rgba(255,255,255,0.02)',
        borderRadius: 16, alignItems: 'center', paddingVertical: 16,
        shadowColor: '#000', shadowOffset: { width: 3, height: 3 },
        shadowOpacity: 0.3, shadowRadius: 8, elevation: 5,
        borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)',
    },
    quickIcon: {
        width: 40, height: 40, borderRadius: 12,
        justifyContent: 'center', alignItems: 'center',
    },

    // Hardening Overlay
    lockOverlay: { zIndex: 9999, justifyContent: 'center', alignItems: 'center' },
    lockBlur: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center', padding: 20 },
    demandHintRow: {
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: 'rgba(245,158,11,0.08)',
        borderWidth: 1, borderColor: 'rgba(245,158,11,0.18)',
        borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10,
        marginBottom: 16,
    },
});
