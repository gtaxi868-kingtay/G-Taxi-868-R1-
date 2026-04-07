import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
    View, StyleSheet, TouchableOpacity,
    ActivityIndicator, Linking, Alert, Animated,
    Dimensions, ScrollView, Image, AppState, AppStateStatus, Appearance, Modal, TextInput, KeyboardAvoidingView
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
    withSequence, useAnimatedStyle, useDerivedValue,
    Easing, interpolate, runOnJS,
} from 'react-native-reanimated';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { useLocationTracking } from '../hooks/useLocationTracking';
import { DEFAULT_LOCATION, ENV } from '../../../../shared/env';
import { useRideOfferSubscription } from '../services/realtime';
import { BRAND, VOICES, RADIUS, SEMANTIC, GRADIENTS, GlassCard, StatusBadge } from '../design-system';
import { Txt } from '../design-system/primitives';
import { Logo } from '../../../../shared/design-system/components';
import { supabase } from '../../../../shared/supabase';
import { Sidebar } from '../components/Sidebar';
import { Ionicons } from '@expo/vector-icons';

const { width, height } = Dimensions.get('window');
const PANEL_HEIGHT = height * 0.54;
const MAP_HEIGHT = height - PANEL_HEIGHT + 32;
const CAR_SIZE = 120;

const LOCKOUT_THRESHOLD_CENTS = -60000;
const SPRING_CFG = { damping: 20, stiffness: 150 };

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
const AnimText = Reanimated.createAnimatedComponent(Txt);

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
    const [systemStatus, setSystemStatus] = useState<any>({ stripe_ready: true, fcm_ready: true, config: {} });
    const [demandHint, setDemandHint] = useState<string | null>(null);

    // ── Reanimated shared values ──────────────────────────────────────────────
    const panelY = useSharedValue(PANEL_HEIGHT);
    const carY = useSharedValue(40);
    const carRotate = useSharedValue(0);
    const carSpinFast = useSharedValue(0); // tap spin
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

    // Old Animated API for marker pulse (keep existing logic untouched)
    const pulseScale = useRef(new Animated.Value(1)).current;
    const pulseOpacity = useRef(new Animated.Value(0)).current;

    // ── Mount animations ──────────────────────────────────────────────────────
    useEffect(() => {
        // Panel spring up
        panelY.value = withSpring(0, SPRING_CFG);
        // Car floats up 300ms after panel
        carY.value = withDelay(300, withSpring(-20, { damping: 14, stiffness: 120 }));
        // Continuous slow car rotation
        carRotate.value = withRepeat(
            withTiming(360, { duration: 8000, easing: Easing.linear }),
            -1, false
        );
        // Stat cards stagger in
        [card0, card1, card2].forEach((c, i) => {
            c.value = withDelay(i * 70, withSpring(1, { damping: 12, stiffness: 200 }));
        });
    }, []);

    // ── Earnings count-up on data load ────────────────────────────────────────
    useEffect(() => {
        earningsVal.value = withTiming(todayEarnings, { duration: 900 });
    }, [todayEarnings]);

    // Fix 3: System Diagnostics
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
    }, []);

    // ── Online glow ───────────────────────────────────────────────────────────
    useEffect(() => {
        glowRadius.value = withSpring(isOnline ? 80 : 0, { damping: 14, stiffness: 100 });
    }, [isOnline]);

    // ── Marker pulse (old Animated API — kept exactly) ────────────────────────
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

    // ── Demand hint (Stage 1 Fix 4) ──────────────────────────────────────────
    useEffect(() => {
        if (!isOnline || !location?.coords) { setDemandHint(null); return; }

        const dLat = location.coords.latitude;
        const dLng = location.coords.longitude;

        const fetchHint = async () => {
            try {
                const { data } = await supabase.rpc('get_demand_hint', {
                    p_driver_lat: dLat,
                    p_driver_lng: dLng,
                });
                setDemandHint(data || null);
            } catch { /* non-critical */ }
        };

        fetchHint();
        const interval = setInterval(fetchHint, 120000);
        return () => clearInterval(interval);
    }, [isOnline, location?.coords?.latitude, location?.coords?.longitude]);

    // ── Offer navigation (DO NOT TOUCH) ───────────────────────────────────────
    useEffect(() => {
        if (offer && isOnline) {
            navigation.navigate('TripRequest', { offer });
            clearOffer();
        }
    }, [offer, isOnline]);

    // ── Stats fetch (DO NOT TOUCH) ────────────────────────────────────────────
    const currentLat = location?.coords.latitude || DEFAULT_LOCATION.latitude;
    const currentLng = location?.coords.longitude || DEFAULT_LOCATION.longitude;

    // ── Stats fetch function (Harden & Sync) ─────────────────────────────────
    const fetchBalanceAndStats = useCallback(async () => {
        if (!driver?.id) return;
        try {
            const { data: balData } = await supabase.rpc('get_wallet_balance', { p_user_id: driver.id });
            setBalanceCents(Math.round(Number(balData) || 0));

            const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
            const { data: rideData } = await supabase.from('rides').select('total_fare_cents')
                .eq('driver_id', driver.id).eq('status', 'completed')
                .gte('created_at', startOfDay.toISOString());

            if (rideData) {
                setTodayTrips(rideData.length);
                setTodayEarnings(rideData.reduce((a, r) => a + (r.total_fare_cents || 0), 0) * 0.81 / 100);
            }
        } catch (err) {
            console.warn('Dashboard stats fetch failed:', err);
        }
    }, [driver?.id]);

    useEffect(() => {
        fetchBalanceAndStats();
    }, [fetchBalanceAndStats]);

    // Refresh on focus (Fix F)
    useFocusEffect(
        useCallback(() => {
            fetchBalanceAndStats();
        }, [fetchBalanceAndStats])
    );

    // ── Reconnection Sync (Fix 4.2) ───────────────────────────────────────────
    useEffect(() => {
        const handleAppStateChange = async (nextState: AppStateStatus) => {
            if (nextState === 'active' && driver?.id) {
                console.log('App returned to foreground. Syncing state...');
                // Refetch balance and trip stats
                try {
                    const { data } = await supabase.rpc('get_wallet_balance', { p_user_id: driver.id });
                    setBalanceCents(Math.round(Number(data) || 0));
                } catch (err) {
                    console.warn('Foreground balance sync failed:', err);
                }
            }
        };
        const sub = AppState.addEventListener('change', handleAppStateChange);
        return () => sub.remove();
    }, [driver?.id]);

    // ── Push token check (DO NOT REMOVE) ──────────────────────────────────────
    useEffect(() => {
        if (driver && !driver.push_token) setPushMissing(true);
        else setPushMissing(false);
    }, [driver?.push_token]);

    const handleFixPush = async () => {
        setIsFixingPush(true);
        await refreshPushToken();
        setPushMissing(false);
        setIsFixingPush(false);
    };

    // ── Guards ────────────────────────────────────────────────────────────────
    const isLockedOut = balanceCents !== null && balanceCents <= LOCKOUT_THRESHOLD_CENTS;
    const isPending = driver?.status === 'pending';

    // ── handleToggle (DO NOT INLINE) ──────────────────────────────────────────
    const handleToggle = async () => {
        if (isToggling || !driver?.id) return;
        setIsToggling(true);
        if (isOnline) { await toggleOnline(); setIsToggling(false); return; }
        try {
            const { data } = await supabase.rpc('get_wallet_balance', { p_user_id: driver.id });
            const fresh = Math.round(Number(data) || 0);
            setBalanceCents(fresh);
            if (fresh <= LOCKOUT_THRESHOLD_CENTS) {
                Alert.alert('Account Locked', 'Balance below -$600 TTD. Contact admin to settle.');
                return;
            }
            await toggleOnline();
        } catch { Alert.alert('Error', 'Could not verify status. Try again.'); }
        finally { setIsToggling(false); }
    };

    // ── Car PNG tap handler ───────────────────────────────────────────────────
    const handleCarTap = () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        // Fast 360° spin on top of slow rotation
        carSpinFast.value = withSequence(
            withTiming(360, { duration: 400, easing: Easing.out(Easing.cubic) }),
            withTiming(0, { duration: 0 })
        );
        setCarLabel(true);
        setTimeout(() => setCarLabel(false), 1500);
    };

    // ── Animated styles ───────────────────────────────────────────────────────
    const panelStyle = useAnimatedStyle(() => ({
        transform: [{ translateY: panelY.value }],
    }));
    const carStyle = useAnimatedStyle(() => {
        return {
            transform: [
                { translateY: carY.value },
                { rotate: `${carRotate.value + carSpinFast.value}deg` } as any,
            ],
        };
    });
    const glowStyle = useAnimatedStyle(() => ({
        opacity: interpolate(glowRadius.value, [0, 80], [0, 1]),
    }));

    const makeCardStyle = (sv: Reanimated.SharedValue<number>) =>
        useAnimatedStyle(() => ({
            transform: [{ scale: sv.value }],
            opacity: sv.value,
        }));
    const card0Style = makeCardStyle(card0);
    const card1Style = makeCardStyle(card1);
    const card2Style = makeCardStyle(card2);
    const cardStyles = [card0Style, card1Style, card2Style];

    const makeNavBounce = (sv: Reanimated.SharedValue<number>) =>
        useAnimatedStyle(() => ({ transform: [{ scale: sv.value }] }));
    const navStyles = navBounce.map(makeNavBounce);

    // ── Derived earnings display ───────────────────────────────────────────────
    const earningsDisplay = useDerivedValue(() =>
        `$${earningsVal.value.toFixed(2)}`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // ── PENDING SCREEN (DO NOT REMOVE) ────────────────────────────────────────
    // ─────────────────────────────────────────────────────────────────────────
    if (isPending) return (
        <View style={[s.root, s.center]}>
            <StatusBar style="light" />
            <View style={s.iconCircle}>
                <Ionicons name="hourglass-outline" size={32} color={BRAND.purpleLight} />
            </View>
            <Txt variant="headingL" weight="heavy" color="#FFF" style={s.centerTitle}>
                APPLICATION UNDER REVIEW
            </Txt>
            <Txt variant="bodyReg" weight="heavy" color={VOICES.driver.textMuted} style={s.centerBody}>
                YOUR PILOT PROFILE HAS BEEN SUBMITTED. YOU'LL BE NOTIFIED ONCE AN ADMINISTRATOR MISSION-CLEARS YOUR ACCOUNT.
            </Txt>
            <TouchableOpacity style={s.outlineBtn} onPress={signOut}>
                <Ionicons name="log-out-outline" size={16} color={SEMANTIC.danger} />
                <Txt variant="bodyBold" weight="heavy" color={SEMANTIC.danger}> TERMINATE SESSION</Txt>
            </TouchableOpacity>
        </View>
    );

    // ─────────────────────────────────────────────────────────────────────────
    // ── LOCKOUT SCREEN (Truth Layer) ──────────────────────────────────────────
    // ─────────────────────────────────────────────────────────────────────────
    if (isLockedOut) return (
        <View style={s.root}>
            <StatusBar style="light" />
            <LinearGradient colors={['#0A0718', '#1A0505']} style={StyleSheet.absoluteFill} />
            
            <View style={[s.center, { flex: 1 }]}>
                <View style={[s.iconCircle, { backgroundColor: 'rgba(239, 68, 68, 0.15)', width: 100, height: 100, borderRadius: 50 }]}>
                    <Ionicons name="alert-circle" size={48} color={SEMANTIC.danger} />
                </View>
                <Txt variant="displayXL" weight="heavy" color={SEMANTIC.danger} style={[s.centerTitle, { marginTop: 24 }]}>ACCOUNT SUSPENDED</Txt>
                <Txt variant="headingM" weight="heavy" color="#FFF" style={{ marginBottom: 12 }}>
                    ${(Math.abs(balanceCents || 0) / 100).toFixed(2)} TTD COMMISSION DEBT
                </Txt>
                <Txt variant="bodyReg" weight="heavy" color={VOICES.driver.textMuted} style={s.centerBody}>
                    YOUR ACCOUNT HAS BEEN AUTOMATICALLY SUSPENDED DUE TO EXCESSIVE COMMISSION DEBT. SETTLE YOUR BALANCE TO RESUME LOGISTICS OPERATIONS.
                </Txt>
                
                <TouchableOpacity
                    style={[s.solidBtn, { backgroundColor: SEMANTIC.danger, width: '100%' }]}
                    onPress={() => Linking.openURL('https://wa.me/18685550100?text=I need to settle my G-Taxi commission balance.')}
                >
                    <Ionicons name="logo-whatsapp" size={20} color="#FFF" />
                    <Txt variant="bodyBold" weight="heavy" color="#FFF"> SETTLE BALANCE NOW</Txt>
                </TouchableOpacity>

                <TouchableOpacity style={[s.outlineBtn, { marginTop: 20, borderColor: 'rgba(255,255,255,0.1)' }]} onPress={signOut}>
                    <Txt variant="bodyReg" weight="heavy" color={VOICES.driver.textMuted}>TERMINATE SESSION</Txt>
                </TouchableOpacity>
            </View>
        </View>
    );

    // ─────────────────────────────────────────────────────────────────────────
    // ── MAINTENANCE / FORCED UPDATE (Fix 7) ───────────────────────────────────
    // ─────────────────────────────────────────────────────────────────────────
    if (systemStatus.config?.maintenance_mode === 'true') return (
        <View style={[s.root, s.center]}>
            <StatusBar style="light" />
            <BlurView tint="dark" intensity={100} style={StyleSheet.absoluteFill}>
                <View style={[s.center, { marginTop: height * 0.2 }]}>
                    <Ionicons name="construct-outline" size={64} color={BRAND.purple} />
                    <Txt variant="headingL" weight="heavy" color="#FFF" style={[s.centerTitle, { marginTop: 24 }]}>SYSTEM MAINTENANCE</Txt>
                    <Txt variant="bodyReg" weight="heavy" color={VOICES.driver.textMuted} style={s.centerBody}>
                        G-TAXI IS CURRENTLY UNDERGOING MISSION-CRITICAL SYSTEMS MAINTENANCE. PLEASE CHECK BACK SHORTLY.
                    </Txt>
                </View>
            </BlurView>
        </View>
    );

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
            <BlurView tint="dark" intensity={100} style={StyleSheet.absoluteFill}>
                <View style={[s.center, { marginTop: height * 0.2 }]}>
                    <Ionicons name="cloud-download-outline" size={64} color={BRAND.purple} />
                    <Txt variant="headingL" weight="heavy" color="#FFF" style={[s.centerTitle, { marginTop: 24 }]}>SECURE UPDATE REQUIRED</Txt>
                    <Txt variant="bodyReg" weight="heavy" color={VOICES.driver.textMuted} style={s.centerBody}>
                        A MANDATORY SECURITY PATCH IS REQUIRED TO ACCESS THE G-TAXI DRIVER NETWORK.
                    </Txt>
                    <TouchableOpacity style={[s.solidBtn, { backgroundColor: BRAND.purple }]} onPress={() => Alert.alert("Update", "Please update via the App Store or Google Play.")}>
                        <Txt variant="bodyBold" weight="heavy" color="#FFF">DOWNLOAD NOW</Txt>
                    </TouchableOpacity>
                </View>
            </BlurView>
        </View>
    );

    // ─────────────────────────────────────────────────────────────────────────
    // ── MAIN DASHBOARD ────────────────────────────────────────────────────────
    // ─────────────────────────────────────────────────────────────────────────
    const QUICK_NAV = [
        { icon: 'wallet-outline', label: 'Wallet', screen: 'Wallet' },
        { icon: 'bar-chart-outline', label: 'Earnings', screen: 'Earnings' },
        { icon: 'calendar-outline', label: 'Schedule', screen: 'ScheduledRides' },
        { icon: 'person-outline', label: 'Profile', screen: 'Profile' },
    ];

    return (
        <View style={s.root}>
            <StatusBar style="light" />

            {/* ── MAP LAYER ─────────────────────────────────────────────────── */}
            <View style={[s.mapContainer, { height: MAP_HEIGHT }]}>
                <MapView
                    style={StyleSheet.absoluteFillObject}
                    provider={PROVIDER_DEFAULT}
                    region={{ latitude: currentLat, longitude: currentLng, latitudeDelta: 0.025, longitudeDelta: 0.025 }}
                    showsUserLocation={false}
                    showsMyLocationButton={false}
                    pitchEnabled={false}
                    rotateEnabled={false}
                >
                    {/* BUG_FIX 1 — Mapbox dark-v11 tile layer */}
                    <UrlTile
                        urlTemplate={`https://api.mapbox.com/styles/v1/mapbox/light-v11/tiles/256/{z}/{x}/{y}@2x?access_token=${ENV.MAPBOX_PUBLIC_TOKEN}`}
                        shouldReplaceMapContent={true}
                        maximumZ={19}
                        flipY={false}
                    />

                    {location && (
                        <Marker coordinate={{ latitude: currentLat, longitude: currentLng }}>
                            <View style={s.markerWrap}>
                                <Animated.View style={[
                                    s.markerRing,
                                    {
                                        transform: [{ scale: pulseScale }], opacity: pulseOpacity,
                                        borderColor: isOnline ? SEMANTIC.success : BRAND.purple
                                    }
                                ]} />
                                <View style={[s.markerCore, { backgroundColor: isOnline ? SEMANTIC.success : BRAND.purple }]} />
                            </View>
                        </Marker>
                    )}
                </MapView>

                {/* Gradient fog at bottom of map (Removed to let the clean neumorphic dashboard pop) */}

                {/* Menu button & Logo — top ─────────────────────────────── */}
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
                    
                    {/* The G-Taxi Logo requested to be prominently displayed on UI */}
                    <Image 
                        source={require('../../assets/logo.png')} 
                        style={{width: 140, height: 48, resizeMode: 'contain', opacity: 0.9, tintColor: BRAND.purple}} 
                    />
                </View>

                {/* Searching chip — top center */}
                {isOnline && (
                    <View style={s.searchChipContainer}>
                        <View style={s.searchChip}>
                            <ActivityIndicator color={SEMANTIC.success} size="small" />
                            <Txt variant="caption" weight="heavy" color={SEMANTIC.success} style={{ marginLeft: 8, letterSpacing: 0.5 }}>
                                SEARCHING FOR TRIPS
                            </Txt>
                        </View>
                        
                        {/* Signal Health HUD (Phase 11) */}
                        <View style={[s.signalChip, { 
                            borderColor: signalStatus === 'lock' ? 'rgba(16,185,129,0.3)' : 
                                         signalStatus === 'dead_reckoning' ? 'rgba(245,158,11,0.4)' : 'rgba(239,68,68,0.3)' 
                        }]}>
                            <Ionicons 
                                name={signalStatus === 'lock' ? "radio-outline" : signalStatus === 'dead_reckoning' ? "pulse-outline" : "alert-circle-outline"} 
                                size={12} 
                                color={signalStatus === 'lock' ? SEMANTIC.success : signalStatus === 'dead_reckoning' ? SEMANTIC.warning : SEMANTIC.danger} 
                            />
                            <Txt variant="caption" weight="heavy" color={signalStatus === 'lock' ? SEMANTIC.success : signalStatus === 'dead_reckoning' ? SEMANTIC.warning : SEMANTIC.danger} style={{ marginLeft: 4 }}>
                                {signalStatus === 'lock' ? 'GPS LOCK' : signalStatus === 'dead_reckoning' ? 'SIGNAL SURVIVAL' : 'NO SIGNAL'}
                            </Txt>
                        </View>
                    </View>
                )}
            </View>

            {/* ── CAR PNG — floats ABOVE panel edge (BUG_FIX 3) ──────────────── */}
            <Reanimated.View style={[s.carWrap, carStyle]}>
                {/* Standard glow — only when online */}
                {isOnline && (
                    <LinearGradient
                        colors={['rgba(124,58,237,0.3)', 'transparent']}
                        style={[StyleSheet.absoluteFillObject, { borderRadius: CAR_SIZE / 2 }]}
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
                    <Txt variant="caption" weight="heavy" color={BRAND.purpleLight} style={s.carLabel}>
                        G-Taxi Standard
                    </Txt>
                )}
            </Reanimated.View>

            {/* ── BOTTOM PANEL (BLACKBERRY PRO) ──────────────────────────────────── */}
            <Reanimated.View style={[s.panelOuter, panelStyle]}>
                <GlassCard variant="driver" style={s.panelInner}>
                    <View style={s.handle} />

                    <ScrollView
                        showsVerticalScrollIndicator={false}
                        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
                        bounces={false}
                    >
                        {/* ── Greeting row ─────────────────────────────── */}
                        <View style={s.greetingRow}>
                            <View>
                                <Txt variant="caption" weight="heavy" color={VOICES.driver.textMuted} style={{ letterSpacing: 1.5 }}>
                                    {getGreeting().toUpperCase()}
                                </Txt>
                                <Txt variant="headingL" weight="heavy" color="#FFF" style={s.driverName}>
                                    {firstName(driver?.name)}
                                </Txt>
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
                                    <ActivityIndicator color={BRAND.cyan} size="small" />
                                ) : (
                                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                        <View style={[s.statusDot, { backgroundColor: isOnline ? BRAND.cyan : 'rgba(255,255,255,0.1)' }]} />
                                        <Txt variant="bodyBold" weight="heavy" color={isOnline ? BRAND.cyan : VOICES.driver.textMuted}>
                                            {isOnline ? 'ONLINE' : 'OFFLINE'}
                                        </Txt>
                                    </View>
                                )}
                            </TouchableOpacity>
                        </View>

                        {/* ── Push notification banner ── */}
                        {pushMissing && (
                            <TouchableOpacity
                                style={s.pushBanner}
                                onPress={handleFixPush}
                                disabled={isFixingPush}
                                activeOpacity={0.8}
                            >
                                <Ionicons name="notifications-off-outline" size={16} color={SEMANTIC.warning} />
                                <Txt variant="caption" weight="heavy" color={SEMANTIC.warning} style={{ flex: 1, marginLeft: 8 }}>
                                    {isFixingPush ? 'ENABLING...' : 'PUSH OFFLINE — TAP TO ENABLE ALERTS'}
                                </Txt>
                                <Ionicons name="chevron-forward" size={14} color={SEMANTIC.warning} />
                            </TouchableOpacity>
                        )}

                            {/* ── Debt Warning Banner (Truth Layer) ── */}
                            {balanceCents !== null && balanceCents <= -40000 && !isLockedOut && (
                                <View style={s.debtBanner}>
                                    <BlurView intensity={20} tint="dark" style={s.debtBlur}>
                                        <Ionicons name="warning" size={20} color={SEMANTIC.warning} />
                                        <View style={{ flex: 1, marginLeft: 12 }}>
                                            <Txt variant="bodyBold" weight="heavy" color={SEMANTIC.warning}>DEBT WARNING</Txt>
                                            <Txt variant="small" weight="heavy" color="rgba(255,255,255,0.6)">Your debt is ${(Math.abs(balanceCents)/100).toFixed(2)}. Lockout at $600.00.</Txt>
                                        </View>
                                    </BlurView>
                                </View>
                            )}

                            {/* Fix 3: FCM Server Connectivity Warning */}
                            {!systemStatus.fcm_ready && (
                                <View style={[s.pushBanner, { backgroundColor: 'rgba(239, 68, 68, 0.1)', borderColor: 'rgba(239, 68, 68, 0.3)' }]}>
                                    <Ionicons name="alert-circle-outline" size={16} color={SEMANTIC.danger} />
                                    <Txt variant="caption" weight="heavy" color={SEMANTIC.danger} style={{ flex: 1, marginLeft: 8 }}>
                                        Push Offline: Server keys missing. Stay in the app to receive requests.
                                    </Txt>
                                </View>
                            )}

                            {/* ── Stat cards ─── */}
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
                                            <Ionicons name="cash-outline" size={16} color={SEMANTIC.warning} style={{ marginBottom: 4 }} />
                                            <Txt variant="small" weight="heavy" color={SEMANTIC.warning} style={s.statLabel}>EARNINGS</Txt>
                                            <Txt variant="headingM" weight="heavy" color="#FFF">
                                                ${todayEarnings.toFixed(2)}
                                            </Txt>
                                            <Txt variant="small" weight="heavy" color={VOICES.driver.textMuted}>TODAY · TTD</Txt>
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
                                        <View style={[s.statCard, { borderColor: 'rgba(0,255,255,0.2)', backgroundColor: 'rgba(0,255,255,0.03)' }]}>
                                            <Ionicons name="car-outline" size={16} color={BRAND.cyan} style={{ marginBottom: 4 }} />
                                            <Txt variant="small" weight="heavy" color={BRAND.cyan} style={s.statLabel}>TRIPS</Txt>
                                            <Txt variant="headingM" weight="heavy" color="#FFF">
                                                {todayTrips}
                                            </Txt>
                                            <Txt variant="small" weight="heavy" color={VOICES.driver.textMuted}>COMPLETED</Txt>
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
                                                color={balanceCents !== null && balanceCents < 0 ? SEMANTIC.danger : SEMANTIC.success}
                                                style={{ marginBottom: 4 }}
                                            />
                                            <Txt
                                                variant="small"
                                                weight="heavy"
                                                color={balanceCents !== null && balanceCents < 0 ? SEMANTIC.danger : SEMANTIC.success}
                                                style={s.statLabel}
                                            >
                                                BALANCE
                                            </Txt>
                                            <Txt variant="headingM" weight="heavy" color="#FFF">
                                                {balanceCents !== null ? `$${(Math.abs(balanceCents) / 100).toFixed(0)}` : '--'}
                                            </Txt>
                                            <Txt variant="small" weight="heavy" color={VOICES.driver.textMuted}>TTD</Txt>
                                        </View>
                                    </TouchableOpacity>
                                </Reanimated.View>
                            </View>

                            {/* ── Demand hint ─── */}
                            {isOnline && demandHint && (
                                <View style={s.demandHintRow}>
                                    <Ionicons name="flash" size={14} color={demandHint.startsWith('HIGH') ? BRAND.cyan : VOICES.driver.textMuted} />
                                    <Txt variant="caption" weight="heavy" color={demandHint.startsWith('HIGH') ? BRAND.cyan : VOICES.driver.textMuted} style={{ marginLeft: 8, flex: 1, letterSpacing: 0.5 }}>
                                        {demandHint.toUpperCase()}
                                    </Txt>
                                </View>
                            )}

                            {/* ── Quick nav ─────────────────────────────────── */}
                            <Txt variant="small" weight="heavy" color={VOICES.driver.textMuted} style={s.sectionLabel}>
                                QUICK ACCESS
                            </Txt>
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
                                                <Ionicons name={item.icon as any} size={20} color={BRAND.cyan} />
                                            </View>
                                            <Txt variant="small" weight="heavy" color={VOICES.driver.textMuted} style={{ marginTop: 6 }}>
                                                {item.label.toUpperCase()}
                                            </Txt>
                                        </TouchableOpacity>
                                    </Reanimated.View>
                                ))}
                            </View>
                    </ScrollView>
                </GlassCard>
            </Reanimated.View>

            {/* ── SIDEBAR ───────────────────────────────────────────────────── */}
            <Sidebar
                visible={sidebarVisible}
                onClose={() => setSidebarVisible(false)}
                user={{ name: driver?.name || 'Driver', rating: 5.0, photo_url: undefined }}
                navigation={navigation}
            />

            {/* --- FIX 7 & 12: FORCED UPDATE / MAINTENANCE OVERLAYS --- */}
            {systemStatus?.config?.maintenance_mode === 'true' && (
                <View style={[StyleSheet.absoluteFill, s.lockOverlay]}>
                    <BlurView tint="dark" intensity={100} style={s.lockBlur}>
                        <Ionicons name="construct" size={64} color={BRAND.purple} />
                        <Txt variant="headingL" weight="heavy" color="#FFF" style={{ marginTop: 24, textAlign: 'center' }}>FLEET OFFLINE</Txt>
                        <Txt variant="bodyReg" weight="heavy" color={VOICES.driver.textMuted} style={{ marginTop: 12, textAlign: 'center', paddingHorizontal: 40 }}>
                            G-TAXI IS CURRENTLY PERFORMING MISSION-CRITICAL SYSTEMS MAINTENANCE. NAVIGATION AND DISPATCH ARE TEMPORARILY SUSPENDED.
                        </Txt>
                    </BlurView>
                </View>
            )}

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
                            <View style={[StyleSheet.absoluteFill, s.lockOverlay]}>
                                <BlurView tint="dark" intensity={100} style={s.lockBlur}>
                                    <Ionicons name="cloud-download" size={64} color={BRAND.purple} />
                                    <Txt variant="headingL" weight="heavy" color="#FFF" style={{ marginTop: 24, textAlign: 'center' }}>SECURE UPDATE REQUIRED</Txt>
                                    <Txt variant="bodyReg" weight="heavy" color={VOICES.driver.textMuted} style={{ marginTop: 12, textAlign: 'center', paddingHorizontal: 40 }}>
                                        A MANDATORY SECURITY PATCH (V{systemStatus.config.min_version_driver}) IS REQUIRED TO ACCESS THE G-TAXI DRIVER NETWORK.
                                    </Txt>
                                    <TouchableOpacity 
                                        style={[s.solidBtn, { backgroundColor: BRAND.purple, marginTop: 32 }]} 
                                        onPress={() => Alert.alert("Secure Update", "Please download the latest build from the pilot portal.")}
                                    >
                                        <Txt variant="bodyBold" color="#FFF">Download Now</Txt>
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

// ── Styles ────────────────────────────────────────────────────────────────────
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
        overflow: 'hidden', backgroundColor: VOICES.driver.bg,
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
    statusPillOn: { backgroundColor: 'rgba(0,255,194,0.05)', borderWidth: 1, borderColor: 'rgba(0,255,194,0.1)' },
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
