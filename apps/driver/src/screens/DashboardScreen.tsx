import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
    View, StyleSheet, Pressable, Text, ActivityIndicator, Alert, Animated, Easing, AppState,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MapView, { Marker, Circle, PROVIDER_DEFAULT, UrlTile } from 'react-native-maps';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { useLocationTracking } from '../hooks/useLocationTracking';
import { DEFAULT_LOCATION, ENV } from '@g868/shared/env';
import { useRideOfferSubscription, useDeliveryOfferSubscription } from '../services/realtime';
import { supabase } from '@gtaxi/core';
import { NfcIdentityHandler } from '../components/NfcIdentityHandler';
import { AreaSafetyCard } from '../components/AreaSafetyCard';
import { Button, Pop, Progress, Txt, FONT, SPACE, tick, useTheme, usePressScale } from '../ui/kit';
import { DRIVE_COLORS, greetingFor, ttd } from '../theme/drive';
import { GButton } from '../components/GButton';
import {
    computeStreak, goalLine, goalProgress, streakLine, ttDay,
    DEFAULT_GOAL_CENTS, GOAL_CHOICES_CENTS,
} from '../utils/driveStats';

// The Drive tab (founder, 2026-10-27): the map is the screen. A light game
// layer (streak, daily goal, a short celebration after each trip) sits in
// small pieces at the edges and never covers the map.

const LOCKOUT_THRESHOLD_CENTS = -60000;
const GOAL_KEY = 'drive_goal_cents';
const GOAL_CELEBRATED_KEY = 'drive_goal_celebrated_day';

type Hotspot = { label: string; score: number; lat: number; lng: number };
type Toast = { icon: keyof typeof Ionicons.glyphMap; title: string; body?: string; color: string } | null;

function firstName(name?: string) {
    return name?.trim().split(' ')[0] || 'Driver';
}

export function DashboardScreen({ navigation }: { navigation: { navigate: (screen: string, params?: object) => void } }) {
    const m = useTheme();
    const insets = useSafeAreaInsets();
    const { driver, user, toggleOnline, signOut } = useAuth();
    const { location } = useLocationTracking();
    const { offer } = useRideOfferSubscription(driver?.id);
    const { offer: deliveryOffer } = useDeliveryOfferSubscription(driver?.id);
    const isOnline = !!driver?.is_online;

    const mapRef = useRef<MapView>(null);
    const [cardH, setCardH] = useState(260);
    const [balanceCents, setBalanceCents] = useState<number | null>(null);
    const [isToggling, setIsToggling] = useState(false);
    const [todayTrips, setTodayTrips] = useState<number | null>(null);
    const [todayCents, setTodayCents] = useState(0);
    const [streak, setStreak] = useState({ days: 0, todayDone: false });
    const [goalCents, setGoalCents] = useState<number>(DEFAULT_GOAL_CENTS);
    const [pickingGoal, setPickingGoal] = useState(false);
    const [hotspots, setHotspots] = useState<Hotspot[]>([]);
    const [nfcVisible, setNfcVisible] = useState(false);
    const [statsError, setStatsError] = useState(false);
    const [toast, setToast] = useState<Toast>(null);
    const [activeRideId, setActiveRideId] = useState<string | null>(null);
    const lastTrips = useRef<number | null>(null);

    const currentLat = location?.coords?.latitude ?? DEFAULT_LOCATION.latitude;
    const currentLng = location?.coords?.longitude ?? DEFAULT_LOCATION.longitude;
    const isPending = driver?.verified_status === 'pending';
    const isLockedOut = (balanceCents ?? 0) < LOCKOUT_THRESHOLD_CENTS;

    // ---- data ------------------------------------------------------------------

    useEffect(() => {
        AsyncStorage.getItem(GOAL_KEY).then((v) => { const n = Number(v); if (n > 0) setGoalCents(n); }, () => {});
    }, []);

    const showToast = useCallback((t: NonNullable<Toast>) => {
        setToast(t);
        setTimeout(() => setToast(null), 3800);
    }, []);

    const fetchStats = useCallback(async () => {
        if (!driver?.id) return;
        try {
            const since = new Date(Date.now() - 31 * 86_400_000).toISOString();
            const { data, error } = await supabase
                .from('rides')
                .select('driver_payout_cents, completed_at')
                .eq('driver_id', driver.id)
                .in('status', ['completed', 'payment_confirmed', 'closed'])
                .gte('completed_at', since);
            if (error) throw error;
            const rows = (data ?? []) as { driver_payout_cents: number | null; completed_at: string | null }[];
            const today = ttDay(new Date());
            const todays = rows.filter((r) => r.completed_at && ttDay(r.completed_at) === today);
            const cents = todays.reduce((sum, r) => sum + (r.driver_payout_cents ?? 0), 0);
            const prev = lastTrips.current;
            setTodayTrips(todays.length);
            setTodayCents(cents);
            setStreak(computeStreak(rows.map((r) => r.completed_at || '')));
            setStatsError(false);
            lastTrips.current = todays.length;

            // A finished trip since we last looked: a short, quiet celebration.
            if (prev !== null && todays.length > prev) {
                const latest = todays.reduce((a, b) => ((a.completed_at || '') > (b.completed_at || '') ? a : b));
                showToast({ icon: 'checkmark-circle', title: `Trip done · +${ttd(latest.driver_payout_cents)}`, body: `${todays.length} today`, color: DRIVE_COLORS.online });
            }
            // First time over the daily goal today: a bigger one, once a day.
            if (goalProgress(cents, goalCents).reached) {
                const done = await AsyncStorage.getItem(GOAL_CELEBRATED_KEY).catch(() => null);
                if (done !== today) {
                    await AsyncStorage.setItem(GOAL_CELEBRATED_KEY, today).catch(() => {});
                    if (prev !== null) {
                        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                        showToast({ icon: 'trophy', title: 'Daily goal reached', body: `${ttd(cents, 0)} today. Everything from here is extra.`, color: DRIVE_COLORS.money });
                    }
                }
            }
        } catch {
            setStatsError(true);
        }
    }, [driver?.id, goalCents, showToast]);

    const fetchBalance = useCallback(async () => {
        if (!user?.id) return;
        try {
            // get_wallet_balance enforces p_user_id === auth.uid() (the auth
            // user id, not drivers.id).
            const { data, error } = await supabase.rpc('get_wallet_balance', { p_user_id: user.id });
            if (!error && data != null) setBalanceCents(data as number);
        } catch { /* balance stays hidden */ }
    }, [user?.id]);

    const fetchDemand = useCallback(async () => {
        if (!driver?.id) return;
        try {
            // Recency-decayed pickups in ~550 m cells, computed server-side.
            const { data, error } = await supabase.functions.invoke('driver_heatmap');
            if (!error && Array.isArray(data?.cells)) {
                setHotspots(data.cells
                    .filter((c: any) => c.lat != null && c.lng != null)
                    .map((c: any) => ({ label: c.label || 'Busy area', score: Number(c.score) || 0, lat: c.lat, lng: c.lng })));
            } else setHotspots([]);
        } catch { setHotspots([]); }
    }, [driver?.id]);

    // A live trip always has a way back in from here. The app-level checks
    // can fail silently (one bad signal at the wrong second), so the home
    // screen checks too and shows a card the driver can tap — no auto-jump,
    // no maybeSingle (two active rows must never read as "no trip"). A
    // failed check keeps the last known state; the next minute retries.
    const checkActiveRide = useCallback(async () => {
        if (!driver?.id) return;
        const { data, error } = await supabase
            .from('rides')
            .select('id')
            .eq('driver_id', driver.id)
            .in('status', ['assigned', 'arrived', 'in_progress'])
            .order('updated_at', { ascending: false })
            .limit(1);
        if (!error) setActiveRideId(data?.[0]?.id ?? null);
    }, [driver?.id]);

    // Refresh whenever the Drive tab comes back into view (e.g. after a trip).
    // While it's on screen, check again every minute (also retries after a
    // failed load).
    useFocusEffect(useCallback(() => {
        fetchStats();
        fetchBalance();
        checkActiveRide();
        const t = setInterval(() => { fetchStats(); fetchBalance(); checkActiveRide(); }, 60_000);
        return () => clearInterval(t);
    }, [fetchStats, fetchBalance, checkActiveRide]));

    useEffect(() => {
        fetchDemand();
        const t = setInterval(fetchDemand, 10 * 60 * 1000);
        return () => clearInterval(t);
    }, [fetchDemand]);

    // Heartbeat while online.
    useEffect(() => {
        const beat = () => { if (driver?.is_online) supabase.from('drivers').update({ last_seen: new Date().toISOString() }).eq('id', driver.id).then(() => {}, () => {}); };
        const sub = AppState.addEventListener('change', (s) => { if (s !== 'active') beat(); });
        const t = setInterval(() => { if (AppState.currentState === 'active') beat(); }, 30000);
        return () => { sub.remove(); clearInterval(t); };
    }, [driver?.id, driver?.is_online]);

    useEffect(() => { if (offer?.ride_id) navigation.navigate('TripRequest', { rideId: offer.ride_id, offer }); }, [offer]);
    useEffect(() => { if (deliveryOffer?.order_id) navigation.navigate('DeliveryRequest', { orderId: deliveryOffer.order_id, offer: deliveryOffer }); }, [deliveryOffer]);

    // ---- actions ---------------------------------------------------------------

    const handleToggle = async () => {
        if (!isOnline && isLockedOut) {
            Alert.alert('Wallet too low to go online', `Your wallet is at ${ttd(balanceCents)}. Top up past -TT$600 to take trips again.`, [
                { text: 'Not now', style: 'cancel' },
                { text: 'Open Wallet', onPress: () => navigation.navigate('Wallet') },
            ]);
            return;
        }
        Haptics.impactAsync(isOnline ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Heavy);
        setIsToggling(true);
        try { await toggleOnline(); }
        catch { Alert.alert('Could not change status', 'Check your signal and try again.'); }
        finally { setIsToggling(false); }
    };

    const chooseGoal = (cents: number) => {
        tick();
        setGoalCents(cents);
        setPickingGoal(false);
        AsyncStorage.setItem(GOAL_KEY, String(cents)).catch(() => {});
    };

    const flyTo = (lat: number, lng: number) => {
        tick();
        mapRef.current?.animateCamera({ center: { latitude: lat, longitude: lng }, zoom: 14 }, { duration: 700 });
    };

    // ---- pending approval ------------------------------------------------------

    if (isPending) return (
        <View style={[s.root, { backgroundColor: m.page, justifyContent: 'center', padding: SPACE.xxl }]}>
            <StatusBar style="light" />
            <Pop>
                <View style={[s.pendingIcon, { backgroundColor: m.field }]}><Ionicons name="hourglass-outline" size={32} color={m.accent} /></View>
                <Txt variant="hero" style={{ textAlign: 'center' }}>Application under review</Txt>
                <Txt tone="dim" style={{ textAlign: 'center', marginTop: SPACE.md, marginBottom: SPACE.xxl }}>
                    We're checking your documents. You'll get a message once you're approved, usually within 1–2 days.
                </Txt>
                <Button title="Sign out" variant="secondary" icon="log-out-outline" onPress={signOut} />
            </Pop>
        </View>
    );

    // ---- map-first layout ------------------------------------------------------

    const goal = goalProgress(todayCents, goalCents);
    const topHot = [...hotspots].sort((a, b) => b.score - a.score)[0];

    return (
        <View style={[s.root, { backgroundColor: m.page }]}>
            <StatusBar style="light" />
            <NfcIdentityHandler
                visible={nfcVisible}
                onClose={() => setNfcVisible(false)}
                onSuccess={async (profile) => {
                    if (!profile) { Alert.alert('Key not read', 'Could not read that key. Try again.'); return; }
                    const { data: cents } = await supabase.rpc('get_wallet_balance', { p_user_id: profile.id });
                    Alert.alert('Key recognised', `Linked to: ${profile.full_name || 'rider'}\nWallet: ${typeof cents === 'number' ? ttd(cents) : 'unavailable'}`);
                }}
            />

            <MapView
                ref={mapRef}
                style={StyleSheet.absoluteFillObject}
                provider={PROVIDER_DEFAULT}
                initialRegion={{ latitude: currentLat, longitude: currentLng, latitudeDelta: 0.05, longitudeDelta: 0.05 }}
                mapPadding={{ top: insets.top + 60, bottom: cardH, left: 0, right: 0 }}
                showsCompass={false}
                toolbarEnabled={false}
            >
                {ENV.MAPBOX_PUBLIC_TOKEN ? (
                    <UrlTile urlTemplate={`https://api.mapbox.com/styles/v1/mapbox/${m.mapStyle}/tiles/256/{z}/{x}/{y}@2x?access_token=${ENV.MAPBOX_PUBLIC_TOKEN}`} shouldReplaceMapContent maximumZ={19} />
                ) : null}
                {hotspots.map((h, i) => (
                    <Circle
                        key={`heat-${i}`}
                        center={{ latitude: h.lat, longitude: h.lng }}
                        radius={350}
                        fillColor={`rgba(255,159,67,${0.10 + 0.25 * h.score})`}
                        strokeColor={`rgba(255,159,67,${0.25 + 0.4 * h.score})`}
                        strokeWidth={1}
                    />
                ))}
                {location ? (
                    <Marker coordinate={{ latitude: currentLat, longitude: currentLng }} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
                        <DriverDot online={isOnline} />
                    </Marker>
                ) : null}
            </MapView>

            {/* Readability wash under the status bar */}
            <GButton name={driver?.name?.split(' ')[0]} />
            <LinearGradient pointerEvents="none" colors={m.mapWash as [string, string]} style={[s.topWash, { height: insets.top + 90 }]} />

            {/* Top: who you are (left), streak + key reader (right) */}
            <View style={[s.topRow, { top: insets.top + SPACE.sm }]} pointerEvents="box-none">
                <View style={[s.glass, s.hello]}>
                    <View style={[s.avatar, { backgroundColor: m.accent }]}>
                        <Text style={s.avatarText}>{firstName(driver?.name).charAt(0).toUpperCase()}</Text>
                    </View>
                    <View>
                        <Txt variant="caption" tone="dim">{greetingFor()}</Txt>
                        <Txt variant="headline" numberOfLines={1}>{firstName(driver?.name)}</Txt>
                    </View>
                </View>
                <View style={{ flexDirection: 'row', gap: SPACE.sm }}>
                    <Pressable accessibilityRole="button" accessibilityLabel={streakLine(streak.days, streak.todayDone)}
                        onPress={() => { tick(); showToast({ icon: 'flame', title: streakLine(streak.days, streak.todayDone), body: 'One finished trip a day keeps it going.', color: DRIVE_COLORS.streak }); }}
                        style={[s.glass, s.chip]}>
                        <Ionicons name="flame" size={18} color={streak.days > 0 ? DRIVE_COLORS.streak : m.faint} />
                        <Text style={[s.chipNum, { color: streak.days > 0 ? DRIVE_COLORS.streak : m.faint }]}>{streak.days}</Text>
                    </Pressable>
                    <Pressable accessibilityRole="button" accessibilityLabel="Scan a G-Touch key" onPress={() => { tick(); setNfcVisible(true); }} style={[s.glass, s.round]}>
                        <Ionicons name="radio-outline" size={20} color={m.accent} />
                    </Pressable>
                </View>
            </View>

            {/* Busy area hint: tap to look there */}
            {isOnline && topHot ? (
                <Pressable onPress={() => flyTo(topHot.lat, topHot.lng)} accessibilityRole="button" accessibilityLabel={`Busy now near ${topHot.label}. Show on map`}
                    style={[s.glass, s.hotChip, { top: insets.top + 76 }]}>
                    <Ionicons name="flame-outline" size={15} color={DRIVE_COLORS.streak} />
                    <Txt variant="label" numberOfLines={1} style={{ marginLeft: 6, maxWidth: 220 }}>Busy now: {topHot.label}</Txt>
                </Pressable>
            ) : null}

            {/* Celebration / info toast */}
            {toast ? (
                <Pop style={[s.toastWrap, { top: insets.top + 120 }]}>
                    <View style={[s.toast, { borderColor: toast.color }]}>
                        <Ionicons name={toast.icon} size={26} color={toast.color} />
                        <View style={{ marginLeft: SPACE.md, flex: 1 }}>
                            <Txt variant="headline">{toast.title}</Txt>
                            {toast.body ? <Txt variant="caption" tone="dim">{toast.body}</Txt> : null}
                        </View>
                    </View>
                </Pop>
            ) : null}

            {/* Re-centre */}
            <Pressable accessibilityRole="button" accessibilityLabel="Centre map on me" onPress={() => flyTo(currentLat, currentLng)}
                style={[s.glass, s.round, s.recentre, { bottom: cardH + SPACE.md }]}>
                <Ionicons name="locate" size={20} color={m.ink} />
            </Pressable>

            {/* Trip in progress: the manual way back to the trip screen */}
            {activeRideId ? (
                <Pressable accessibilityRole="button" accessibilityLabel="Trip in progress. Return to the trip"
                    onPress={() => { tick(); navigation.navigate('ActiveTrip', { rideId: activeRideId }); }}
                    style={[s.tripCard, { bottom: cardH + SPACE.md + 56 }]}>
                    <Ionicons name="navigate-circle" size={26} color={DRIVE_COLORS.online} />
                    <View style={{ marginLeft: SPACE.md, flex: 1 }}>
                        <Txt variant="headline" style={{ color: DRIVE_COLORS.online }}>Trip in progress</Txt>
                        <Txt variant="caption" tone="dim">Tap to return to your trip</Txt>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color={m.dim} />
                </Pressable>
            ) : null}

            {/* Bottom card: today, goal, and the one big action */}
            <View style={s.cardWrap} onLayout={(e) => setCardH(e.nativeEvent.layout.height)}>
                <LinearGradient colors={m.sheet as [string, string]} style={[s.card, { borderColor: m.sheetBorder }]}>
                    <View style={s.statsRow}>
                        <Pressable style={{ flex: 1 }} onPress={() => { tick(); navigation.navigate('Earnings'); }} accessibilityRole="button" accessibilityLabel={`Today ${ttd(todayCents)}. Open earnings`}>
                            <Txt variant="overline" tone="faint">TODAY</Txt>
                            {todayTrips === null && !statsError ? <ActivityIndicator color={DRIVE_COLORS.money} style={{ alignSelf: 'flex-start', marginVertical: 8 }} /> : (
                                <Text style={[s.money, { color: DRIVE_COLORS.money }]} numberOfLines={1} adjustsFontSizeToFit>{ttd(todayCents)}</Text>
                            )}
                            <Txt variant="caption" tone="dim">
                                {statsError ? "Couldn't load today. Check your signal; it retries every minute." : `${todayTrips ?? 0} ${todayTrips === 1 ? 'trip' : 'trips'}`}
                            </Txt>
                        </Pressable>
                        {balanceCents !== null ? (
                            <Pressable onPress={() => { tick(); navigation.navigate('Wallet'); }} accessibilityRole="button" accessibilityLabel={`Wallet ${ttd(balanceCents)}`}
                                style={[s.walletPill, { backgroundColor: isLockedOut ? 'rgba(255,90,95,0.14)' : m.field }]}>
                                <Ionicons name="wallet-outline" size={15} color={isLockedOut ? DRIVE_COLORS.danger : m.dim} />
                                <Txt variant="label" style={{ marginLeft: 6, color: isLockedOut ? DRIVE_COLORS.danger : m.ink }}>{ttd(balanceCents)}</Txt>
                            </Pressable>
                        ) : null}
                    </View>

                    <Pressable onPress={() => { tick(); setPickingGoal((v) => !v); }} accessibilityRole="button" accessibilityLabel={`${goalLine(todayCents, goalCents)}. Change goal`} style={{ marginTop: SPACE.md }}>
                        <Progress value={goal.ratio} color={goal.reached ? DRIVE_COLORS.online : DRIVE_COLORS.money} height={10} />
                        <View style={s.goalRow}>
                            <Txt variant="caption" tone={goal.reached ? 'success' : 'dim'}>{goalLine(todayCents, goalCents)}</Txt>
                            <Txt variant="caption" tone="faint">{pickingGoal ? 'Close' : 'Change'}</Txt>
                        </View>
                    </Pressable>
                    {pickingGoal ? (
                        <View style={s.goalChoices}>
                            {GOAL_CHOICES_CENTS.map((c) => (
                                <Pressable key={c} onPress={() => chooseGoal(c)} accessibilityRole="button" accessibilityState={{ selected: c === goalCents }}
                                    style={[s.goalChoice, { borderColor: c === goalCents ? DRIVE_COLORS.money : m.chipBorder, backgroundColor: c === goalCents ? 'rgba(244,206,119,0.12)' : m.chip }]}>
                                    <Txt variant="label" style={{ color: c === goalCents ? DRIVE_COLORS.money : m.ink }}>{ttd(c, 0)}</Txt>
                                </Pressable>
                            ))}
                        </View>
                    ) : null}

                    {isLockedOut ? (
                        <Txt variant="caption" tone="danger" style={{ marginTop: SPACE.md }}>
                            Your wallet is below -TT$600. Top up in Wallet to take trips.
                        </Txt>
                    ) : null}

                    <View style={{ marginTop: SPACE.lg }}>
                        {isOnline ? (
                            <View style={s.onlineRow}>
                                <View style={s.onlineInfo}>
                                    <Radar />
                                    <View style={{ marginLeft: SPACE.md, flex: 1 }}>
                                        <Txt variant="headline" style={{ color: DRIVE_COLORS.online }}>You're online</Txt>
                                        <Txt variant="caption" tone="dim">Looking for trips near you</Txt>
                                    </View>
                                </View>
                                <Button title="Go offline" size="md" variant="secondary" onPress={handleToggle} loading={isToggling} style={{ width: 132 }} />
                            </View>
                        ) : (
                            <Button title="Go online" icon="power" color={DRIVE_COLORS.online} onPress={handleToggle} loading={isToggling} />
                        )}
                    </View>

                    <AreaSafetyCard lat={location ? currentLat : null} lng={location ? currentLng : null} />
                </LinearGradient>
            </View>
        </View>
    );
}

// Your position: a bright dot; green with a soft ring while online.
function DriverDot({ online }: { online: boolean }) {
    const color = online ? DRIVE_COLORS.online : DRIVE_COLORS.cyan;
    return (
        <View style={s.dotWrap}>
            <View style={[s.dotRing, { borderColor: color, backgroundColor: online ? 'rgba(47,208,138,0.18)' : 'rgba(63,217,232,0.15)' }]} />
            <View style={[s.dotCore, { backgroundColor: color }]} />
        </View>
    );
}

// Calm "searching" pulse next to "You're online": slow, small, no flashing.
function Radar() {
    const v = useRef(new Animated.Value(0)).current;
    useEffect(() => {
        const loop = Animated.loop(Animated.timing(v, { toValue: 1, duration: 1800, easing: Easing.out(Easing.quad), useNativeDriver: true }));
        loop.start();
        return () => loop.stop();
    }, []);
    return (
        <View style={s.radar}>
            <Animated.View style={[s.radarRing, {
                opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] }),
                transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.8] }) }],
            }]} />
            <View style={s.radarCore} />
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1 },
    pendingIcon: { width: 80, height: 80, borderRadius: 40, alignSelf: 'center', alignItems: 'center', justifyContent: 'center', marginBottom: SPACE.xl },
    topWash: { position: 'absolute', top: 0, left: 0, right: 0 },
    topRow: { position: 'absolute', left: SPACE.lg, right: SPACE.lg, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    glass: { backgroundColor: 'rgba(14,17,23,0.88)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)' },
    hello: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingLeft: 6, paddingRight: 16, borderRadius: 28, maxWidth: '60%' },
    avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
    avatarText: { fontFamily: FONT.roundBlack, fontSize: 18, color: '#08090D' },
    chip: { flexDirection: 'row', alignItems: 'center', height: 48, paddingHorizontal: 14, borderRadius: 24 },
    chipNum: { fontFamily: FONT.roundBlack, fontSize: 18, marginLeft: 4 },
    round: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
    hotChip: { position: 'absolute', alignSelf: 'center', flexDirection: 'row', alignItems: 'center', height: 36, paddingHorizontal: 14, borderRadius: 18 },
    toastWrap: { position: 'absolute', left: SPACE.lg, right: SPACE.lg },
    toast: { flexDirection: 'row', alignItems: 'center', padding: SPACE.lg, borderRadius: 20, borderWidth: 2, backgroundColor: 'rgba(14,17,23,0.96)' },
    tripCard: { position: 'absolute', left: SPACE.lg, right: SPACE.lg, flexDirection: 'row', alignItems: 'center', padding: SPACE.lg, borderRadius: 20, borderWidth: 2, borderColor: DRIVE_COLORS.online, backgroundColor: 'rgba(14,17,23,0.96)' },
    recentre: { position: 'absolute', right: SPACE.lg },
    cardWrap: { position: 'absolute', left: 0, right: 0, bottom: 0 },
    card: { borderTopLeftRadius: 28, borderTopRightRadius: 28, borderWidth: 1, borderBottomWidth: 0, paddingHorizontal: SPACE.xl, paddingTop: SPACE.lg, paddingBottom: SPACE.lg },
    statsRow: { flexDirection: 'row', alignItems: 'flex-start' },
    money: { fontFamily: FONT.roundBlack, fontSize: 38, lineHeight: 44, fontVariant: ['tabular-nums'] },
    walletPill: { flexDirection: 'row', alignItems: 'center', height: 36, paddingHorizontal: 12, borderRadius: 18, marginTop: 4 },
    goalRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
    goalChoices: { flexDirection: 'row', gap: SPACE.sm, marginTop: SPACE.sm },
    goalChoice: { flex: 1, height: 40, borderRadius: 12, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
    onlineRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.md },
    onlineInfo: { flex: 1, flexDirection: 'row', alignItems: 'center' },
    radar: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
    radarRing: { position: 'absolute', width: 28, height: 28, borderRadius: 14, backgroundColor: DRIVE_COLORS.online },
    radarCore: { width: 12, height: 12, borderRadius: 6, backgroundColor: DRIVE_COLORS.online },
    dotWrap: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
    dotRing: { position: 'absolute', width: 34, height: 34, borderRadius: 17, borderWidth: 2 },
    dotCore: { width: 14, height: 14, borderRadius: 7, borderWidth: 3, borderColor: '#08090D' },
});
