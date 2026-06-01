import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
    View, StyleSheet, TouchableOpacity, Text,
    ActivityIndicator, Linking, Alert, Animated,
    useWindowDimensions, ScrollView, Image, RefreshControl,
    AppState
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
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
import { DEFAULT_LOCATION, ENV } from '@gtaxi/shared/env';
import { useRideOfferSubscription } from '../services/realtime';
import { supabase } from '@gtaxi/core';
import { Sidebar } from '../components/Sidebar';
import { Ionicons } from '@expo/vector-icons';
import { NfcIdentityHandler } from '../components/NfcIdentityHandler';
import { SURFACE, ANIMATION, VOICES } from '@gtaxi/design-system';
import { elevationGlow, glassSurface, ghostBorder } from '@gtaxi/design-system/utils/style-rules';

const CAR_SIZE = 120;

const LOCKOUT_THRESHOLD_CENTS = -60000;

function getGreeting() {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning,';
    if (h < 17) return 'Good afternoon,';
    return 'Good evening,';
}

function firstName(name?: string) {
    return name?.split(' ')[0] || 'Driver';
}

export function DashboardScreen({ navigation }: { navigation: { navigate: (screen: string, params?: object) => void; goBack: () => void; replace: (screen: string, params?: object) => void } }) {
    const { width, height } = useWindowDimensions();
    const insets = useSafeAreaInsets();
    const { driver, toggleOnline, signOut, refreshPushToken } = useAuth();
    const { location, signalStatus } = useLocationTracking();
    const { offer, clearOffer } = useRideOfferSubscription(driver?.id);
    const isOnline = driver?.is_online;
    const panelHeightLocal = height * 0.54;
    const mapHeightLocal = height - panelHeightLocal + 32;

    const [sidebarVisible, setSidebarVisible] = useState(false);
    const [balanceCents, setBalanceCents] = useState<number | null>(null);
    const [isToggling, setIsToggling] = useState(false);
    const [pushMissing, setPushMissing] = useState(false);
    const [isFixingPush, setIsFixingPush] = useState(false);
    const [todayTrips, setTodayTrips] = useState(0);
    const [todayEarnings, setTodayEarnings] = useState(0);
    const [carLabel, setCarLabel] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [systemStatus, setSystemStatus] = useState<Record<string, unknown>>({ stripe_ready: true, fcm_ready: true, config: {} });
    const [demandHint, setDemandHint] = useState<string | null>(null);
    const [nfcVisible, setNfcVisible] = useState(false);

    const panelY = useSharedValue(panelHeightLocal);
    const carY = useSharedValue(40);
    const carRotate = useSharedValue(0);
    const carSpinFast = useSharedValue(0);
    const earningsVal = useSharedValue(0);
    const glowRadius = useSharedValue(0);

    const card0 = useSharedValue(0);
    const card1 = useSharedValue(0);
    const card2 = useSharedValue(0);
    const cardScales = [card0, card1, card2];

    const navBounce = [
        useSharedValue(1), useSharedValue(1),
        useSharedValue(1), useSharedValue(1),
        useSharedValue(1),
    ];

    const pulseScale = useRef(new Animated.Value(1)).current;
    const pulseOpacity = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        panelY.value = withSpring(0, ANIMATION.spring);
        carY.value = withDelay(300, withSpring(-20, ANIMATION.spring));
        carRotate.value = withRepeat(withTiming(360, { duration: 8000, easing: Easing.linear }), -1, false);
        [card0, card1, card2].forEach((c, i) => {
            c.value = withDelay(i * 70, withSpring(1, ANIMATION.spring));
        });
    }, []);

    useEffect(() => {
        earningsVal.value = withTiming(todayEarnings, { duration: 900 });
    }, [todayEarnings]);

    useEffect(() => {
        const handleAppStateChange = async (nextAppState: string) => {
            if (nextAppState === 'background' || nextAppState === 'inactive') {
                if (driver?.is_online) {
                    await supabase.from('drivers').update({ last_heartbeat_at: new Date().toISOString() }).eq('id', driver.id);
                }
            }
        };
        const subscription = AppState.addEventListener('change', handleAppStateChange);
        const heartbeatInterval = setInterval(async () => {
            if (driver?.is_online && AppState.currentState === 'active') {
                await supabase.from('drivers').update({ last_heartbeat_at: new Date().toISOString() }).eq('id', driver.id);
            }
        }, 30000);
        return () => {
            subscription.remove();
            clearInterval(heartbeatInterval);
        };
    }, [driver?.id, driver?.is_online]);

    useEffect(() => {
        const fetchStatus = async () => {
            try {
                const { data, error } = await supabase.functions.invoke('get_system_status');
                if (!error && data?.success) setSystemStatus(data.data as Record<string, unknown>);
            } catch (err) { /* System status failed */ }
        };
        fetchStatus();
        const checkActiveTrip = async () => {
            if (!driver?.id) return;
            try {
                const { data } = await supabase.from('rides').select('id').eq('driver_id', driver.id).in('status', ['assigned', 'arrived', 'in_progress']).maybeSingle();
                if (data?.id) navigation.replace('ActiveTrip', { rideId: data.id });
            } catch (e) { /* Recovery failed */ }
        };
        checkActiveTrip();
        const fetchBalance = async () => {
            if (!driver?.id) return;
            try {
                const { data, error } = await supabase.rpc('get_wallet_balance', { p_user_id: driver.id });
                if (!error && data != null) setBalanceCents(data as number);
            } catch (e) { /* Balance fetch failed */ }
        };
        fetchBalance();
    }, [driver?.id]);

    useEffect(() => {
        glowRadius.value = withSpring(isOnline ? 80 : 0, ANIMATION.spring);
    }, [isOnline]);

    useEffect(() => {
        if (!isOnline) { pulseOpacity.setValue(0); return; }
        const loop = Animated.loop(Animated.sequence([
            Animated.parallel([
                Animated.spring(pulseScale, { toValue: 1.6, ...ANIMATION.spring, useNativeDriver: true }),
                Animated.spring(pulseOpacity, { toValue: 0, ...ANIMATION.spring, useNativeDriver: true }),
            ]),
            Animated.parallel([
                Animated.spring(pulseScale, { toValue: 1, ...ANIMATION.spring, useNativeDriver: true }),
                Animated.spring(pulseOpacity, { toValue: 0.5, ...ANIMATION.spring, useNativeDriver: true }),
            ]),
        ]));
        pulseOpacity.setValue(0.5);
        loop.start();
        return () => loop.stop();
    }, [isOnline]);

    const currentLat = location?.coords?.latitude ?? DEFAULT_LOCATION.latitude;
    const currentLng = location?.coords?.longitude ?? DEFAULT_LOCATION.longitude;
    const isPending = driver?.verified_status === 'pending';
    const isLockedOut = (balanceCents ?? 0) < LOCKOUT_THRESHOLD_CENTS;

    const card0Style = useAnimatedStyle(() => ({ 
        opacity: card0.value, 
        transform: [{ scale: interpolate(card0.value, [0, 1], [0.9, 1]) }] 
    }));
    const card1Style = useAnimatedStyle(() => ({ 
        opacity: card1.value, 
        transform: [{ scale: interpolate(card1.value, [0, 1], [0.9, 1]) }] 
    }));
    const card2Style = useAnimatedStyle(() => ({ 
        opacity: card2.value, 
        transform: [{ scale: interpolate(card2.value, [0, 1], [0.9, 1]) }] 
    }));

    const navStyle0 = useAnimatedStyle(() => ({ transform: [{ scale: navBounce[0].value }] }));
    const navStyle1 = useAnimatedStyle(() => ({ transform: [{ scale: navBounce[1].value }] }));
    const navStyle2 = useAnimatedStyle(() => ({ transform: [{ scale: navBounce[2].value }] }));
    const navStyle3 = useAnimatedStyle(() => ({ transform: [{ scale: navBounce[3].value }] }));
    const navStyle4 = useAnimatedStyle(() => ({ transform: [{ scale: navBounce[4].value }] }));
    const navStyles = [navStyle0, navStyle1, navStyle2, navStyle3, navStyle4];

    const panelStyle = useAnimatedStyle(() => ({ transform: [{ translateY: panelY.value }] }));
    const carStyle = useAnimatedStyle(() => ({ transform: [{ translateY: carY.value }, { rotate: `${carRotate.value + carSpinFast.value}deg` }] }));

    const handleToggle = async () => { setIsToggling(true); try { await toggleOnline(); } finally { setIsToggling(false); } };
    const handleCarTap = () => { carSpinFast.value = withSequence(withTiming(360, { duration: 600, easing: Easing.out(Easing.quad) }), withTiming(0, { duration: 0 })); setCarLabel(true); setTimeout(() => setCarLabel(false), 2000); };
    const handleFixPush = async () => { setIsFixingPush(true); try { await refreshPushToken?.(); setPushMissing(false); } catch (e) { Alert.alert('Push Setup Failed', 'Please enable notifications in Settings.'); } finally { setIsFixingPush(false); } };
    const onRefresh = useCallback(async () => { setRefreshing(true); try { const { data } = await supabase.functions.invoke('get_system_status'); if (data?.success) setSystemStatus(data.data as Record<string, unknown>); } catch (e) { /* Refresh failed */ } setRefreshing(false); }, []);

    useEffect(() => { if (offer?.ride_id) navigation.navigate('TripRequest', { rideId: offer.ride_id, offer }); }, [offer]);

    if (isPending) return (
        <View style={[s.root, s.center]}>
            <StatusBar style="light" />
            <LinearGradient colors={['#1A1200', SURFACE.base]} style={StyleSheet.absoluteFillObject} />
            <View style={s.iconCircle}><Ionicons name="hourglass-outline" size={32} color={VOICES.driver.accent} /></View>
            <Text style={[s.centerTitle, { fontSize: 24, fontWeight: '800', color: '#FFF' }]}>APPLICATION UNDER REVIEW</Text>
            <Text style={[s.centerBody, { fontSize: 14, fontWeight: '600', color: 'rgba(255,255,255,0.6)' }]}>YOUR PILOT PROFILE HAS BEEN SUBMITTED. YOU'LL BE NOTIFIED ONCE AN ADMINISTRATOR MISSION-CLEARS YOUR ACCOUNT.</Text>
            <TouchableOpacity style={s.outlineBtn} onPress={signOut}><Ionicons name="log-out-outline" size={16} color="#FF4D4D" /><Text style={{ fontSize: 14, fontWeight: '700', color: '#FF4D4D' }}> TERMINATE SESSION</Text></TouchableOpacity>
        </View>
    );

    const QUICK_NAV = [
        { icon: 'wallet-outline', label: 'Wallet', screen: 'Wallet' },
        { icon: 'bar-chart-outline', label: 'Earnings', screen: 'Earnings' },
        { icon: 'calendar-outline', label: 'Schedule', screen: 'ScheduledRides' },
        { icon: 'person-outline', label: 'Profile', screen: 'Profile' },
        { icon: 'warning-outline', label: 'Report', screen: 'ReportIssue' },
    ];

    const rootOpacity = useSharedValue(0);
    useEffect(() => { rootOpacity.value = withSpring(1, ANIMATION.spring); }, []);
    const rootAnimatedStyle = useAnimatedStyle(() => ({ opacity: rootOpacity.value }));

    return (
        <Reanimated.View style={[s.root, rootAnimatedStyle]}>
            <StatusBar style="light" />
            <LinearGradient colors={['#1A1200', SURFACE.base]} style={StyleSheet.absoluteFillObject} />

            <NfcIdentityHandler 
                visible={nfcVisible} 
                onClose={() => setNfcVisible(false)} 
                onSuccess={(profile) => {
                    if (!profile) { Alert.alert("Key Error", "Could not read profile data."); return; }
                    const name = profile.full_name || "Unknown Driver";
                    const balance = ((profile.balance_cents ?? 0) / 100).toFixed(2);
                    Alert.alert("Key Recognized", `Linked to: ${name}\nBalance: $${balance}`);
                }}
            />

            <View style={[s.mapContainer, { height: mapHeightLocal }]} pointerEvents="box-none">
                <MapView style={StyleSheet.absoluteFillObject} provider={PROVIDER_DEFAULT} initialRegion={{ latitude: currentLat, longitude: currentLng, latitudeDelta: 0.05, longitudeDelta: 0.05 }}>
                    <UrlTile urlTemplate={`https://api.mapbox.com/styles/v1/mapbox/dark-v11/tiles/256/{z}/{x}/{y}@2x?access_token=${ENV.MAPBOX_PUBLIC_TOKEN}`} shouldReplaceMapContent maximumZ={19} />
                    {location && (
                        <Marker coordinate={{ latitude: currentLat, longitude: currentLng }}>
                            <View style={s.markerWrap}>
                                <Animated.View style={[s.markerRing, { transform: [{ scale: pulseScale }], opacity: pulseOpacity, borderColor: isOnline ? '#10B981' : VOICES.driver.accent }]} />
                                <View style={[s.markerCore, { backgroundColor: isOnline ? '#10B981' : VOICES.driver.accent }]} />
                            </View>
                        </Marker>
                    )}
                </MapView>

                <View style={[s.mapOverlay, { top: insets.top + 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: Math.min(width - 40, 560) }]} pointerEvents="box-none">
                    <TouchableOpacity style={s.mapBtn} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setSidebarVisible(true); }} activeOpacity={0.8}><Ionicons name="menu-outline" size={22} color={'#FFFFFF'} /></TouchableOpacity>
                    <View style={{ flexDirection: 'row', gap: 12 }}>
                        <TouchableOpacity style={[s.mapBtn, { backgroundColor: VOICES.driver.accent }]} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setNfcVisible(true); }} activeOpacity={0.8}><Ionicons name="radio-outline" size={20} color={'#FFFFFF'} /></TouchableOpacity>
                        <Text style={{ fontSize: 22, fontWeight: '900', color: VOICES.driver.accent, letterSpacing: 2 }}>G-TAXI</Text>
                    </View>
                </View>
            </View>

            <Reanimated.View style={[s.carWrap, { bottom: panelHeightLocal - 20 }, carStyle]}>
                {isOnline && <LinearGradient colors={[VOICES.driver.accent, VOICES.driver.accent]} style={{ position: 'absolute', width: 200, height: 200, borderRadius: 100, opacity: 0.15, top: -40 }} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} />}
                <TouchableOpacity onPress={handleCarTap} activeOpacity={0.9}><Image source={require('../../assets/images/car_gtaxi_standard_v7.png')} style={s.carImg} resizeMode="contain" /></TouchableOpacity>
                {carLabel && <Text style={[s.carLabel, { fontSize: 11, fontWeight: '700', color: VOICES.driver.accent }]}>G-Taxi Standard</Text>}
            </Reanimated.View>

            <Reanimated.View style={[s.panelOuter, { height: panelHeightLocal }, panelStyle, width > 600 && { left: '50%', right: 'auto', width: 600, marginLeft: -300, borderTopLeftRadius: 36, borderTopRightRadius: 36 }]}>
                <BlurView tint="dark" intensity={60} style={[glassSurface(60, 0.2), { flex: 1, borderWidth: 0 }]}>
                    <View style={s.panelInner}>
                        <View style={s.handle} />
                        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 24 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={VOICES.driver.accent} />}>
                            <View style={s.greetingRow}>
                                <View><Text style={{ fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.6)' }}>{getGreeting().toUpperCase()}</Text><Text style={[s.driverName, { fontSize: 24, fontWeight: '800', color: '#FFF' }]}>{firstName(driver?.name)}</Text></View>
                                <TouchableOpacity style={[s.statusPill, isOnline ? s.statusPillOn : s.statusPillOff]} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy); handleToggle(); }} disabled={isToggling} activeOpacity={0.85}>
                                    {isToggling ? <ActivityIndicator color={VOICES.driver.accent} size="small" /> : <View style={{ flexDirection: 'row', alignItems: 'center' }}><View style={[s.statusDot, { backgroundColor: isOnline ? VOICES.driver.accent : 'rgba(174,169,181,0.2)' }]} /><Text style={{ fontSize: 14, fontWeight: '700', color: isOnline ? VOICES.driver.accent : '#AEA9B5' }}>{isOnline ? 'ONLINE' : 'OFFLINE'}</Text></View>}
                                </TouchableOpacity>
                            </View>

                            <View style={s.statsRow}>
                                <Reanimated.View style={[{ flex: 1 }, card0Style]}>
                                    <TouchableOpacity activeOpacity={0.8} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); navigation.navigate('Earnings'); }}>
                                        <View style={[s.statCard, { backgroundColor: VOICES.driver.accent + '0D' }, elevationGlow()]}><Ionicons name="cash-outline" size={16} color={VOICES.driver.accent} /><Text style={[s.statLabel, { fontSize: 10, fontWeight: '700', color: VOICES.driver.accent }]}>EARNINGS</Text><Text style={{ fontSize: 20, fontWeight: '800', color: '#FFF' }}>${todayEarnings.toFixed(2)}</Text></View>
                                    </TouchableOpacity>
                                </Reanimated.View>
                                <Reanimated.View style={[{ flex: 1 }, card1Style]}>
                                    <TouchableOpacity activeOpacity={0.8} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); navigation.navigate('ScheduledRides'); }}>
                                        <View style={[s.statCard, { backgroundColor: VOICES.driver.accent + '08' }, elevationGlow()]}><Ionicons name="car-outline" size={16} color={VOICES.driver.accent} /><Text style={[s.statLabel, { fontSize: 10, fontWeight: '700', color: VOICES.driver.accent }]}>TRIPS</Text><Text style={{ fontSize: 20, fontWeight: '800', color: '#FFF' }}>{todayTrips}</Text></View>
                                    </TouchableOpacity>
                                </Reanimated.View>
                            </View>

                            <Text style={[s.sectionLabel, { fontSize: 10, fontWeight: '700', color: 'rgba(255,255,255,0.6)' }]}>QUICK ACCESS</Text>
                            <View style={s.quickRow}>
                                {QUICK_NAV.map((item, i) => (
                                    <Reanimated.View key={item.screen} style={[{ flex: 1 }, navStyles[i]]}>
                                        <TouchableOpacity style={[s.quickCard, elevationGlow()]} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); navigation.navigate(item.screen); }} activeOpacity={0.7}><View style={[s.quickIcon, { backgroundColor: VOICES.driver.accent + '1A' }]}><Ionicons name={item.icon as 'wallet-outline' | 'bar-chart-outline' | 'calendar-outline' | 'person-outline' | 'warning-outline'} size={20} color={VOICES.driver.accent} /></View><Text style={{ marginTop: 6, fontSize: 10, fontWeight: '700', color: 'rgba(255,255,255,0.6)' }}>{item.label.toUpperCase()}</Text></TouchableOpacity>
                                    </Reanimated.View>
                                ))}
                            </View>
                        </ScrollView>
                    </View>
                </BlurView>
            </Reanimated.View>

            <Sidebar visible={sidebarVisible} onClose={() => setSidebarVisible(false)} user={{ name: driver?.name || 'Driver', rating: 5.0 }} navigation={navigation} />
        </Reanimated.View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: '#0A0718' },
    center: { justifyContent: 'center', alignItems: 'center', padding: 32 },
    iconCircle: { width: 80, height: 80, borderRadius: 40, backgroundColor: VOICES.driver.accent + '14', justifyContent: 'center', alignItems: 'center', marginBottom: 24 },
    centerTitle: { textAlign: 'center', marginBottom: 12 },
    centerBody: { textAlign: 'center', lineHeight: 24, paddingHorizontal: 24, marginBottom: 32 },
    outlineBtn: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 28, borderRadius: 50, ...ghostBorder(0.35) },
    solidBtn: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, paddingHorizontal: 32, borderRadius: 50, gap: 8 },
    mapContainer: { width: '100%', overflow: 'hidden' },
    mapOverlay: { position: 'absolute', left: 20 },
    mapBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(7,5,15,0.85)', justifyContent: 'center', alignItems: 'center', ...ghostBorder(0.05) },
    markerWrap: { width: 32, height: 32, justifyContent: 'center', alignItems: 'center' },
    markerRing: { position: 'absolute', width: 32, height: 32, borderRadius: 16, borderWidth: 2 },
    markerCore: { width: 12, height: 12, borderRadius: 6, borderWidth: 2.5, borderColor: '#0A0718' },
    carWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 10 },
    carImg: { width: CAR_SIZE, height: CAR_SIZE },
    carLabel: { marginTop: 4, letterSpacing: 0.5, textAlign: 'center', backgroundColor: 'rgba(7,5,15,0.7)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
    panelOuter: { position: 'absolute', bottom: 0, left: 0, right: 0, borderTopLeftRadius: 36, borderTopRightRadius: 36, overflow: 'hidden', ...elevationGlow(20) },
    panelInner: { flex: 1, paddingHorizontal: 20, paddingTop: 12 },
    handle: { width: 44, height: 5, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 3, alignSelf: 'center', marginBottom: 20 },
    greetingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
    driverName: { marginTop: 2, letterSpacing: -0.5 },
    statusPill: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 18, paddingVertical: 11, borderRadius: 50 },
    statusPillOn: { backgroundColor: VOICES.driver.accent + '14', ...elevationGlow(), borderColor: VOICES.driver.accent + '40' },
    statusPillOff: { backgroundColor: 'rgba(255,255,255,0.02)', ...ghostBorder(0.05) },
    statusDot: { width: 7, height: 7, borderRadius: 3.5 },
    statsRow: { flexDirection: 'row', gap: 10, marginBottom: 24 },
    statCard: { borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.02)', paddingVertical: 18, paddingHorizontal: 14, gap: 4 },
    statLabel: { letterSpacing: 0.5, marginBottom: 2 },
    sectionLabel: { letterSpacing: 1, marginBottom: 12 },
    quickRow: { flexDirection: 'row', gap: 10 },
    quickCard: { flex: 1, backgroundColor: 'rgba(255,255,255,0.02)', borderRadius: 16, alignItems: 'center', paddingVertical: 16 },
    quickIcon: { width: 40, height: 40, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
});
