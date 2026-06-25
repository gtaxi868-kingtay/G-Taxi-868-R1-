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
import * as Haptics from 'expo-haptics';
import Reanimated, {
    useSharedValue, withSpring, withTiming, withRepeat, withDelay,
    withSequence, useAnimatedStyle,
    Easing, interpolate,
} from 'react-native-reanimated';
import { useAuth } from '../context/AuthContext';
import { useLocationTracking } from '../hooks/useLocationTracking';
import { DEFAULT_LOCATION, ENV } from '@gtaxi/shared/env';
import { useRideOfferSubscription, useDeliveryOfferSubscription } from '../services/realtime';
import { supabase } from '@gtaxi/core';
import { Sidebar } from '../components/Sidebar';
import { Ionicons } from '@expo/vector-icons';
import { NfcIdentityHandler } from '../components/NfcIdentityHandler';
import { SURFACE, ANIMATION, VOICES } from '@gtaxi/design-system';
import { LiquidGlass } from '@gtaxi/design-system/native';
import { elevationGlow, ghostBorder } from '@gtaxi/design-system/utils/style-rules';

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

const QUICK_NAV = [
    { icon: 'wallet-outline', label: 'Wallet', screen: 'Wallet' },
    { icon: 'bar-chart-outline', label: 'Earnings', screen: 'Earnings' },
    { icon: 'calendar-outline', label: 'Schedule', screen: 'ScheduledRides' },
    { icon: 'person-outline', label: 'Profile', screen: 'Profile' },
    { icon: 'warning-outline', label: 'Report', screen: 'ReportIssue' },
    { icon: 'home-outline', label: 'Scout', screen: 'ScoutReferral' },
    { icon: 'people-outline', label: 'Refer', screen: 'DriverReferral' },
    { icon: 'car-sport-outline', label: 'Buy Car', screen: 'VehicleSales' },
] as const;

export function DashboardScreen({ navigation }: { navigation: { navigate: (screen: string, params?: object) => void; goBack: () => void; replace: (screen: string, params?: object) => void } }) {
    const { width, height } = useWindowDimensions();
    const insets = useSafeAreaInsets();
    const { driver, toggleOnline, signOut, refreshPushToken } = useAuth();
    const { location, signalStatus } = useLocationTracking();
    const { offer, clearOffer } = useRideOfferSubscription(driver?.id);
    const { offer: deliveryOffer, clearOffer: clearDeliveryOffer } = useDeliveryOfferSubscription(driver?.id);
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
    const carSpinFast = useSharedValue(0);
    const glowRadius = useSharedValue(0);

    const card0 = useSharedValue(0);
    const card1 = useSharedValue(0);

    const navBounce = [
        useSharedValue(1), useSharedValue(1), useSharedValue(1), useSharedValue(1),
        useSharedValue(1), useSharedValue(1), useSharedValue(1), useSharedValue(1),
    ];

    const pulseScale = useRef(new Animated.Value(1)).current;
    const pulseOpacity = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        panelY.value = withSpring(0, ANIMATION.spring);
        carY.value = withRepeat(
            withSequence(
                withTiming(-28, { duration: 2200, easing: Easing.inOut(Easing.sin) }),
                withTiming(-12, { duration: 2200, easing: Easing.inOut(Easing.sin) }),
            ),
            -1, true,
        );
        [card0, card1].forEach((c, i) => {
            c.value = withDelay(i * 80, withSpring(1, ANIMATION.spring));
        });
    }, []);

    const fetchStats = useCallback(async () => {
        if (!driver?.id) return;
        try {
            const todayStart = new Date();
            todayStart.setHours(0, 0, 0, 0);
            const { data: rides } = await supabase
                .from('rides')
                .select('total_fare')
                .eq('driver_id', driver.id)
                .eq('status', 'completed')
                .gte('completed_at', todayStart.toISOString());
            if (rides) {
                setTodayTrips(rides.length);
                setTodayEarnings(rides.reduce((sum, r: any) => sum + (r.total_fare ?? 0), 0));
            }
        } catch (e) { }
    }, [driver?.id]);

    useEffect(() => {
        const earningsAnim = withTiming(todayEarnings, { duration: 900 });
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
            } catch (err) { }
        };
        fetchStatus();
        const checkActiveTrip = async () => {
            if (!driver?.id) return;
            try {
                const { data } = await supabase.from('rides').select('id').eq('driver_id', driver.id).in('status', ['assigned', 'arrived', 'in_progress']).maybeSingle();
                if (data?.id) navigation.replace('ActiveTrip', { rideId: data.id });
            } catch (e) { }
        };
        checkActiveTrip();
        const fetchBalance = async () => {
            if (!driver?.id) return;
            try {
                const { data, error } = await supabase.rpc('get_wallet_balance', { p_user_id: driver.id });
                if (!error && data != null) setBalanceCents(data as number);
            } catch (e) { }
        };
        fetchBalance();
        fetchStats();
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
        transform: [{ scale: interpolate(card0.value, [0, 1], [0.95, 1]) }],
    }));
    const card1Style = useAnimatedStyle(() => ({
        opacity: card1.value,
        transform: [{ scale: interpolate(card1.value, [0, 1], [0.95, 1]) }],
    }));

    const navStyle0 = useAnimatedStyle(() => ({ transform: [{ scale: navBounce[0].value }] }));
    const navStyle1 = useAnimatedStyle(() => ({ transform: [{ scale: navBounce[1].value }] }));
    const navStyle2 = useAnimatedStyle(() => ({ transform: [{ scale: navBounce[2].value }] }));
    const navStyle3 = useAnimatedStyle(() => ({ transform: [{ scale: navBounce[3].value }] }));
    const navStyle4 = useAnimatedStyle(() => ({ transform: [{ scale: navBounce[4].value }] }));
    const navStyle5 = useAnimatedStyle(() => ({ transform: [{ scale: navBounce[5].value }] }));
    const navStyle6 = useAnimatedStyle(() => ({ transform: [{ scale: navBounce[6].value }] }));
    const navStyle7 = useAnimatedStyle(() => ({ transform: [{ scale: navBounce[7].value }] }));
    const navStyles = [navStyle0, navStyle1, navStyle2, navStyle3, navStyle4, navStyle5, navStyle6, navStyle7];

    const panelStyle = useAnimatedStyle(() => ({ transform: [{ translateY: panelY.value }] }));
    const carStyle = useAnimatedStyle(() => ({ transform: [{ translateY: carY.value }] }));

    const handleToggle = async () => { setIsToggling(true); try { await toggleOnline(); } finally { setIsToggling(false); } };
    const handleCarTap = () => {
        carSpinFast.value = withSequence(withTiming(360, { duration: 600, easing: Easing.out(Easing.quad) }), withTiming(0, { duration: 0 }));
        setCarLabel(true);
        setTimeout(() => setCarLabel(false), 2000);
    };
    const handleFixPush = async () => {
        setIsFixingPush(true);
        try { await refreshPushToken?.(); setPushMissing(false); }
        catch (e) { Alert.alert('Push Setup Failed', 'Please enable notifications in Settings.'); }
        finally { setIsFixingPush(false); }
    };
    const onRefresh = useCallback(async () => {
        setRefreshing(true);
        try {
            const { data } = await supabase.functions.invoke('get_system_status');
            if (data?.success) setSystemStatus(data.data as Record<string, unknown>);
        } catch (e) { }
        await fetchStats();
        setRefreshing(false);
    }, [fetchStats]);

    useEffect(() => { if (offer?.ride_id) navigation.navigate('TripRequest', { rideId: offer.ride_id, offer }); }, [offer]);
    useEffect(() => { if (deliveryOffer?.order_id) navigation.navigate('DeliveryRequest', { orderId: deliveryOffer.order_id, offer: deliveryOffer }); }, [deliveryOffer]);

    if (isPending) return (
        <View style={[s.root, s.center]}>
            <StatusBar style="light" />
            <LinearGradient colors={['#1A1200', SURFACE.base]} style={StyleSheet.absoluteFillObject} />
            <LiquidGlass voice="driver" style={s.iconCircle}>
                <Ionicons name="hourglass-outline" size={32} color={VOICES.driver.accent} />
            </LiquidGlass>
            <Text style={[s.centerTitle, { fontSize: 22, fontWeight: '700', color: '#FFF' }]}>Application under review</Text>
            <Text style={[s.centerBody, { fontSize: 14, fontWeight: '400', color: 'rgba(255,255,255,0.6)', lineHeight: 22 }]}>We're reviewing your documents. You'll be notified once an administrator approves your account — usually within 1–2 days.</Text>
            <TouchableOpacity style={s.outlineBtn} onPress={signOut} accessibilityLabel="Sign out" accessibilityRole="button">
                <Ionicons name="log-out-outline" size={16} color="#FF4D4D" />
                <Text style={{ fontSize: 14, fontWeight: '600', color: '#FF4D4D', marginLeft: 6 }}>Sign out</Text>
            </TouchableOpacity>
        </View>
    );

    const tileWidth = (width - 40 - 24) / 4;

    return (
        <View style={s.root}>
            <StatusBar style="light" />
            <LinearGradient colors={['#1A1200', SURFACE.base]} style={StyleSheet.absoluteFillObject} />

            <NfcIdentityHandler
                visible={nfcVisible}
                onClose={() => setNfcVisible(false)}
                onSuccess={(profile) => {
                    if (!profile) { Alert.alert('Key Error', 'Could not read profile data.'); return; }
                    const name = profile.full_name || 'Unknown Driver';
                    const balance = ((profile.balance_cents ?? 0) / 100).toFixed(2);
                    Alert.alert('Key Recognized', `Linked to: ${name}\nBalance: $${balance}`);
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

                <View style={[s.mapOverlay, { top: insets.top + 12 }]} pointerEvents="box-none">
                    <TouchableOpacity style={s.mapBtn} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setSidebarVisible(true); }} activeOpacity={0.8} accessibilityLabel="Open driver menu" accessibilityRole="button">
                        <Ionicons name="menu-outline" size={22} color="#FFFFFF" />
                    </TouchableOpacity>
                    <View style={{ flexDirection: 'row', gap: 10 }}>
                        <TouchableOpacity style={[s.mapBtn, { backgroundColor: VOICES.driver.accent + '20', borderColor: VOICES.driver.accent + '40', borderWidth: 1 }]} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setNfcVisible(true); }} activeOpacity={0.8} accessibilityLabel="Scan NFC kiosk" accessibilityRole="button">
                            <Ionicons name="radio-outline" size={20} color={VOICES.driver.accent} />
                        </TouchableOpacity>
                        <Text style={s.logoText}>G-TAXI</Text>
                    </View>
                </View>
            </View>

            <Reanimated.View style={[s.carWrap, { bottom: panelHeightLocal - 20 }, carStyle]}>
                {isOnline && (
                    <View style={[s.carGlow, { width: 140, height: 140, borderRadius: 70, backgroundColor: VOICES.driver.accent + '12', position: 'absolute', top: -10 }]} />
                )}
                <TouchableOpacity onPress={handleCarTap} activeOpacity={0.9} accessibilityLabel="View vehicle details" accessibilityRole="button">
                    <Image source={require('../../assets/images/car_gtaxi_standard_v7.png')} style={s.carImg} resizeMode="contain" />
                </TouchableOpacity>
                {carLabel && (
                    <Text style={s.carLabel}>G-Taxi Standard</Text>
                )}
            </Reanimated.View>

            <Reanimated.View style={[s.panelOuter, { height: panelHeightLocal }, panelStyle, width > 600 && { left: '50%', right: 'auto', width: 600, marginLeft: -300 }]}>
                <LiquidGlass voice="driver" style={{ flex: 1, borderWidth: 0 }} tier="chrome">
                    <View style={s.panelInner}>
                        <View style={s.handle} />
                        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 24 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={VOICES.driver.accent} />}>
                            <View style={s.greetingRow}>
                                <View>
                                    <Text style={s.greetingText}>{getGreeting()}</Text>
                                    <Text style={s.driverName}>{firstName(driver?.name)}</Text>
                                </View>
                                <TouchableOpacity
                                    style={[s.statusPill, isOnline ? s.statusPillOn : s.statusPillOff]}
                                    onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy); handleToggle(); }}
                                    disabled={isToggling}
                                    activeOpacity={0.85}
                                    accessibilityLabel={isOnline ? 'Go offline' : 'Go online to receive rides'}
                                    accessibilityRole="switch"
                                    accessibilityState={{ checked: isOnline }}
                                >
                                    {isToggling ? (
                                        <ActivityIndicator color={VOICES.driver.accent} size="small" />
                                    ) : (
                                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                            <View style={[s.statusDot, { backgroundColor: isOnline ? VOICES.driver.accent : 'rgba(174,169,181,0.3)' }]} />
                                            <Text style={[s.statusText, { color: isOnline ? VOICES.driver.accent : '#AEA9B5' }]}>
                                                {isOnline ? 'Online' : 'Offline'}
                                            </Text>
                                        </View>
                                    )}
                                </TouchableOpacity>
                            </View>

                            <Reanimated.View style={[s.heroBlock, card0Style]}>
                                <TouchableOpacity
                                    activeOpacity={0.85}
                                    onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); navigation.navigate('Earnings'); }}
                                    accessibilityLabel={`Today's earnings: $${todayEarnings.toFixed(2)}`}
                                    accessibilityRole="button"
                                    style={{ flex: 1 }}
                                >
                                    <View style={s.heroBlockInner}>
                                        <View style={{ flex: 1 }}>
                                            <Text style={s.heroLabel}>Today's earnings</Text>
                                            <Text style={s.heroAmount}>${todayEarnings.toFixed(2)}</Text>
                                            <Text style={s.heroDetail}>{todayTrips} {todayTrips === 1 ? 'trip' : 'trips'} completed</Text>
                                        </View>
                                        <View style={s.heroRight}>
                                            <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.25)" />
                                        </View>
                                    </View>
                                </TouchableOpacity>

                                {balanceCents !== null && (
                                    <View style={s.heroDivider} />
                                )}
                                {balanceCents !== null && (
                                    <TouchableOpacity
                                        style={s.walletRow}
                                        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); navigation.navigate('Wallet'); }}
                                        activeOpacity={0.7}
                                        accessibilityLabel={`Wallet balance: $${(balanceCents / 100).toFixed(2)}`}
                                        accessibilityRole="button"
                                    >
                                        <Ionicons name="wallet-outline" size={14} color="rgba(255,255,255,0.4)" />
                                        <Text style={s.walletLabel}>Wallet</Text>
                                        <Text style={[s.walletAmount, isLockedOut && { color: '#EF4444' }]}>
                                            ${(balanceCents / 100).toFixed(2)} TTD
                                        </Text>
                                        <Ionicons name="chevron-forward" size={12} color="rgba(255,255,255,0.2)" />
                                    </TouchableOpacity>
                                )}
                            </Reanimated.View>

                            {pushMissing && (
                                <TouchableOpacity style={s.pushBanner} onPress={handleFixPush} disabled={isFixingPush} activeOpacity={0.8} accessibilityLabel="Fix push notifications" accessibilityRole="button">
                                    <Ionicons name="notifications-off-outline" size={16} color="#F59E0B" />
                                    <Text style={s.pushBannerText}>Notifications off — tap to fix</Text>
                                    {isFixingPush && <ActivityIndicator size="small" color="#F59E0B" style={{ marginLeft: 8 }} />}
                                </TouchableOpacity>
                            )}

                            <Text style={s.sectionLabel}>Quick access</Text>
                            <Reanimated.View style={[s.quickGrid, card1Style]}>
                                {QUICK_NAV.map((item, i) => (
                                    <Reanimated.View key={item.screen} style={[{ width: tileWidth }, navStyles[i]]}>
                                        <TouchableOpacity
                                            style={s.quickCard}
                                            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); navigation.navigate(item.screen); }}
                                            activeOpacity={0.7}
                                            accessibilityLabel={`Go to ${item.label}`}
                                            accessibilityRole="button"
                                        >
                                            <View style={s.quickIconWrap}>
                                                <Ionicons name={item.icon as any} size={20} color={VOICES.driver.accent} />
                                            </View>
                                            <Text style={s.quickLabel}>{item.label}</Text>
                                        </TouchableOpacity>
                                    </Reanimated.View>
                                ))}
                            </Reanimated.View>
                        </ScrollView>
                    </View>
                </LiquidGlass>
            </Reanimated.View>

            <Sidebar visible={sidebarVisible} onClose={() => setSidebarVisible(false)} user={{ name: driver?.name || 'Driver', rating: 5.0 }} navigation={navigation} />
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: '#0A0718' },
    center: { justifyContent: 'center', alignItems: 'center', padding: 32 },
    iconCircle: { width: 80, height: 80, justifyContent: 'center', alignItems: 'center', marginBottom: 24 },
    centerTitle: { textAlign: 'center', marginBottom: 12 },
    centerBody: { textAlign: 'center', lineHeight: 24, paddingHorizontal: 24, marginBottom: 32 },
    outlineBtn: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 28, borderRadius: 50, ...ghostBorder(0.35) },
    solidBtn: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, paddingHorizontal: 32, borderRadius: 50, gap: 8 },
    mapContainer: { width: '100%', overflow: 'hidden' },
    mapOverlay: { position: 'absolute', left: 20, right: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    mapBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(7,5,15,0.85)', justifyContent: 'center', alignItems: 'center', ...ghostBorder(0.05) },
    logoText: { fontSize: 22, fontWeight: '900', color: VOICES.driver.accent, letterSpacing: 2, alignSelf: 'center' },
    markerWrap: { width: 32, height: 32, justifyContent: 'center', alignItems: 'center' },
    markerRing: { position: 'absolute', width: 32, height: 32, borderRadius: 16, borderWidth: 2 },
    markerCore: { width: 12, height: 12, borderRadius: 6, borderWidth: 2.5, borderColor: '#0A0718' },
    carWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 10 },
    carGlow: {},
    carImg: { width: CAR_SIZE, height: CAR_SIZE },
    carLabel: { marginTop: 4, fontSize: 11, fontWeight: '600', color: VOICES.driver.accent, letterSpacing: 0.5, textAlign: 'center', backgroundColor: 'rgba(7,5,15,0.7)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
    panelOuter: { position: 'absolute', bottom: 0, left: 0, right: 0, borderTopLeftRadius: 32, borderTopRightRadius: 32, overflow: 'hidden', borderTopWidth: 0.5, borderTopColor: 'rgba(255,255,255,0.06)' },
    panelInner: { flex: 1, paddingHorizontal: 20, paddingTop: 10 },
    handle: { width: 40, height: 4, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 2, alignSelf: 'center', marginBottom: 18 },
    greetingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
    greetingText: { fontSize: 13, fontWeight: '400', color: 'rgba(255,255,255,0.45)' },
    driverName: { fontSize: 22, fontWeight: '700', color: '#FFF', marginTop: 1, letterSpacing: -0.3 },
    statusPill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 50 },
    statusPillOn: { backgroundColor: VOICES.driver.accent + '14', borderWidth: 1, borderColor: VOICES.driver.accent + '35' },
    statusPillOff: { backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
    statusDot: { width: 7, height: 7, borderRadius: 3.5 },
    statusText: { fontSize: 13, fontWeight: '600' },
    heroBlock: {
        backgroundColor: 'rgba(255,255,255,0.04)',
        borderRadius: 20,
        borderWidth: 0.5,
        borderColor: 'rgba(255,255,255,0.08)',
        marginBottom: 20,
        overflow: 'hidden',
    },
    heroBlockInner: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 18,
        paddingTop: 18,
        paddingBottom: 14,
    },
    heroLabel: { fontSize: 12, fontWeight: '500', color: 'rgba(255,255,255,0.45)', marginBottom: 4 },
    heroAmount: { fontSize: 34, fontWeight: '800', color: VOICES.driver.gold, letterSpacing: -0.5 },
    heroDetail: { fontSize: 12, color: 'rgba(255,255,255,0.35)', marginTop: 4 },
    heroRight: { paddingLeft: 12 },
    heroDivider: { height: 0.5, backgroundColor: 'rgba(255,255,255,0.06)', marginHorizontal: 18 },
    walletRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 18,
        paddingVertical: 12,
    },
    walletLabel: { fontSize: 12, color: 'rgba(255,255,255,0.4)', flex: 1 },
    walletAmount: { fontSize: 13, fontWeight: '600', color: VOICES.driver.gold },
    pushBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: 'rgba(245,158,11,0.08)',
        borderRadius: 12,
        borderWidth: 0.5,
        borderColor: 'rgba(245,158,11,0.25)',
        paddingHorizontal: 14,
        paddingVertical: 10,
        marginBottom: 16,
    },
    pushBannerText: { fontSize: 13, color: '#F59E0B', flex: 1 },
    sectionLabel: { fontSize: 12, fontWeight: '500', color: 'rgba(255,255,255,0.35)', marginBottom: 12, letterSpacing: 0.2 },
    quickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    quickCard: {
        backgroundColor: 'rgba(255,255,255,0.03)',
        borderRadius: 14,
        borderWidth: 0.5,
        borderColor: 'rgba(255,255,255,0.07)',
        alignItems: 'center',
        paddingVertical: 14,
        paddingHorizontal: 4,
    },
    quickIconWrap: {
        width: 38,
        height: 38,
        borderRadius: 11,
        backgroundColor: VOICES.driver.accent + '14',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 6,
    },
    quickLabel: { fontSize: 10, fontWeight: '500', color: 'rgba(255,255,255,0.45)', textAlign: 'center' },
});
