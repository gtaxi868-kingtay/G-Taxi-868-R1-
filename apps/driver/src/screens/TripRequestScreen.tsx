import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Alert, Animated, Easing } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useAuth } from '../context/AuthContext';
import { acceptRide, declineRide } from '../services/api';
import { supabase } from '@gtaxi/core';
import { Button, Pop, Txt, FONT, SPACE, GUTTER, useTheme, IconName } from '../ui/kit';
import { DRIVE_COLORS, ttd } from '../theme/drive';

// A new trip offer. The driver has seconds to decide, so the screen answers
// three questions in order, big to small: what do I earn, how long have I
// got, where is it. Everything else is a small badge.

// Only used if an offer arrives without driver_payout_cents. The real share
// is 80% (78% while the driver's recruiter is an active commander); use the
// lowest so the screen can never promise more than the payout.
const DEFAULT_DRIVER_SHARE = 0.78;

// Turn the server's refusal into a plain sentence. It used to say "Trip
// taken" for every failure, which hid the real cause (an expired offer, or
// a driver testing with the same account that booked the ride).
export function acceptFailure(statusCode: number | undefined, reason: string | null): { title: string; body: string } {
    const r = reason || '';
    if (statusCode === 429) return { title: 'Slow down a moment', body: 'Too many taps. Try again in a few seconds.' };
    if (statusCode === 401) return { title: 'Signed out', body: 'Please sign in again.' };
    if (/own ride/i.test(r)) return { title: 'This is your own ride', body: 'You booked this ride with the same account. Use a different rider account to test.' };
    if (/expired|no longer available/i.test(r)) return { title: 'Offer ran out', body: 'The time to accept this trip ended. New trips will keep coming while you are online.' };
    if (/already taken|unavailable/i.test(r)) return { title: 'Trip taken', body: 'Another driver got this one first. More trips are coming.' };
    if (/pending approval/i.test(r)) return { title: 'Not approved yet', body: 'Your driver account is still being reviewed.' };
    if (/active ride/i.test(r)) return { title: 'Finish your current trip first', body: r };
    if (/debt|balance/i.test(r)) return { title: 'Wallet too low', body: 'Settle what you owe in Wallet to accept trips.' };
    return { title: 'Could not accept', body: r || 'Check your signal and try again.' };
}

function paymentLabel(method: string | null): { label: string; icon: IconName } {
    if (method === 'card') return { label: 'Card', icon: 'card-outline' };
    if (method === 'wallet') return { label: 'Wallet', icon: 'wallet-outline' };
    return { label: 'Cash', icon: 'cash-outline' };
}

interface RideDetail {
    pickup_address: string | null;
    dropoff_address: string | null;
    total_fare_cents: number | null;
    payment_method: string | null;
    vehicle_type: string | null;
    rider_id: string | null;
    metadata?: Record<string, any> | null;
}

export function TripRequestScreen({ navigation, route }: any) {
    const m = useTheme();
    const insets = useSafeAreaInsets();
    const { offer } = route.params || {};
    const { driver } = useAuth();

    const totalSeconds = offer?.timeout_seconds ?? 15;
    const [timeLeft, setTimeLeft] = useState<number>(totalSeconds);
    const [isHandling, setIsHandling] = useState(false);
    const handling = useRef(false);
    const [rideDetail, setRideDetail] = useState<RideDetail | null>(null);
    const [detailLoading, setDetailLoading] = useState(true);
    const [isPreferred, setIsPreferred] = useState(false);
    const [stopCount, setStopCount] = useState(0);
    const [hasNode, setHasNode] = useState(false);
    const [photoOnFile, setPhotoOnFile] = useState(false);
    const [trust, setTrust] = useState<{ score: number; badge: string } | null>(null);

    // Countdown bar drains smoothly from full to empty.
    const drain = useRef(new Animated.Value(1)).current;
    useEffect(() => {
        const start = offer?.expires_at ? Math.max(0, (new Date(offer.expires_at).getTime() - Date.now()) / 1000) : totalSeconds;
        drain.setValue(Math.min(1, start / Math.max(1, totalSeconds)));
        Animated.timing(drain, { toValue: 0, duration: start * 1000, easing: Easing.linear, useNativeDriver: false }).start();
    }, [offer?.expires_at]);

    useEffect(() => {
        const unsub = navigation.addListener('beforeRemove', (e: any) => {
            if (handling.current) return;
            e.preventDefault();
            Alert.alert('Skip this trip?', 'Leaving now passes the trip to another driver.', [
                { text: 'Keep it', style: 'cancel' },
                { text: 'Skip trip', style: 'destructive', onPress: () => { handleDecline(false); } },
            ]);
        });
        return unsub;
    }, [navigation]);

    useEffect(() => {
        if (!offer?.ride_id) { setDetailLoading(false); return; }
        let alive = true;
        (async () => {
            try {
                const { data } = await supabase.from('rides')
                    .select('pickup_address, dropoff_address, total_fare_cents, payment_method, vehicle_type, rider_id, metadata')
                    .eq('id', offer.ride_id).maybeSingle();
                if (!alive || !data) return;
                setRideDetail(data);
                const meta = data.metadata || {};
                setHasNode(!!(meta.kiosk_id || meta.node_id || meta.revenue_split?.node_present));
                // Set by create_ride from the rider's stored photos: a photo on
                // file, not a face or ID check.
                setPhotoOnFile(meta.selfie_photo_on_file === true);
                const { data: stps } = await supabase.from('ride_stops').select('stop_type').eq('ride_id', offer.ride_id);
                if (alive && Array.isArray(stps)) setStopCount(stps.filter((x: any) => x.stop_type !== 'pickup' && x.stop_type !== 'dropoff').length);
                if (data.rider_id && driver?.id) {
                    const { data: pref } = await supabase.from('rider_preferences').select('id')
                        .eq('rider_id', data.rider_id).eq('favored_driver_id', driver.id).maybeSingle();
                    if (alive && pref) setIsPreferred(true);
                }
                const ts = await supabase.functions.invoke('calculate_ride_trust_score', { body: { ride_id: offer.ride_id } }).catch(() => ({ data: null }));
                const d = (ts as any)?.data;
                if (alive && d?.success && d?.data) setTrust({ score: d.data.final_score || d.data.score || 0, badge: d.data.badge || 'STANDARD' });
            } catch { /* details are extra; the offer itself still shows */ }
            finally { if (alive) setDetailLoading(false); }
        })();
        return () => { alive = false; };
    }, [offer?.ride_id]);

    // If the rider cancels while this offer is on screen, leave at once
    // with the reason stated — never sit out the countdown on a dead trip
    // or let an Accept tap land on a ride that no longer exists.
    useEffect(() => {
        if (!offer?.ride_id) return;
        let gone = false;
        const leaveCancelled = () => {
            if (gone || handling.current) return;
            gone = true;
            handling.current = true;
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            Alert.alert('Trip cancelled', 'The rider cancelled this trip. You are still online — the next trip will come to you here.');
            navigation.goBack();
        };
        const checkRide = async () => {
            const { data } = await supabase.from('rides').select('status').eq('id', offer.ride_id).maybeSingle();
            if (data?.status === 'cancelled') leaveCancelled();
        };
        const ch = supabase.channel(`trip_request_ride_${offer.ride_id}`)
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rides', filter: `id=eq.${offer.ride_id}` }, (payload: any) => {
                if (payload.new?.status === 'cancelled') leaveCancelled();
            })
            .subscribe((status) => { if (status === 'SUBSCRIBED') checkRide(); });
        const poll = setInterval(checkRide, 5000);
        return () => { gone = true; clearInterval(poll); ch.unsubscribe(); };
    }, [offer?.ride_id]);

    useEffect(() => {
        if (!offer?.expires_at) return;
        const t = setInterval(() => {
            const left = Math.max(0, Math.floor((new Date(offer.expires_at).getTime() - Date.now()) / 1000));
            setTimeLeft(left);
            if (left <= 3 && left > 0) Haptics.selectionAsync().catch(() => {});
            if (left <= 0) { clearInterval(t); handleDecline(true); }
        }, 1000);
        return () => clearInterval(t);
    }, [offer?.expires_at]);

    const handleAccept = async () => {
        if (!offer?.ride_id || !driver?.id || handling.current) return;
        handling.current = true;
        setIsHandling(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        const { error, statusCode, reason } = await acceptRide(offer.ride_id, driver.id);
        if (error) {
            const { title, body } = acceptFailure(statusCode, reason);
            Alert.alert(title, body);
            navigation.goBack();
        } else navigation.replace('ActiveTrip', { rideId: offer.ride_id });
    };

    const handleDecline = async (auto: boolean) => {
        if (handling.current) return;
        handling.current = true;
        setIsHandling(true);
        if (auto) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        try { if (offer?.id) await declineRide(offer.id); } catch { /* the offer expires on the server anyway */ }
        navigation.goBack();
    };

    const earnCents = offer?.driver_payout_cents
        ?? Math.round((rideDetail?.total_fare_cents || offer?.fare_cents || 0) * DEFAULT_DRIVER_SHARE);
    const km = offer?.distance_meters ? (offer.distance_meters / 1000).toFixed(1) : null;
    const pay = paymentLabel(rideDetail?.payment_method || offer?.payment_method || 'cash');
    const urgency = timeLeft > 5 ? DRIVE_COLORS.cyan : timeLeft > 2 ? DRIVE_COLORS.warn : DRIVE_COLORS.danger;
    const pickup = rideDetail?.pickup_address || offer?.pickup_address || 'Pickup near you';
    const dropoff = rideDetail?.dropoff_address || offer?.dropoff_address || 'Destination';

    const badges: { icon: IconName; label: string; color: string }[] = [];
    if (isPreferred) badges.push({ icon: 'star', label: 'Rider picked you before', color: DRIVE_COLORS.money });
    if (hasNode) badges.push({ icon: 'storefront', label: 'Shop pickup', color: DRIVE_COLORS.violet });
    if (photoOnFile) badges.push({ icon: 'person-circle', label: 'Rider photo on file', color: DRIVE_COLORS.online });
    if (trust?.badge === 'VERIFIED_SAFE') badges.push({ icon: 'shield-checkmark', label: `Trusted rider ${trust.score}`, color: DRIVE_COLORS.online });
    if (trust?.badge === 'SAFE_ROUTE') badges.push({ icon: 'shield-outline', label: `Safe route ${trust.score}`, color: DRIVE_COLORS.cyan });

    return (
        <View style={[s.root, { backgroundColor: m.page, paddingTop: insets.top + SPACE.lg, paddingBottom: Math.max(insets.bottom, SPACE.lg) }]}>
            <StatusBar style="light" />

            {/* Countdown */}
            <View style={s.timerRow}>
                <Txt variant="overline" tone="dim">NEW TRIP</Txt>
                <Text style={[s.seconds, { color: urgency }]}>{timeLeft}s</Text>
            </View>
            <View style={[s.track, { backgroundColor: m.field }]}>
                <Animated.View style={[s.fill, { backgroundColor: urgency, width: drain.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]} />
            </View>

            {/* What you earn */}
            <Pop style={s.earnBlock}>
                <Txt variant="label" tone="dim">You earn</Txt>
                <Text style={[s.earn, { color: DRIVE_COLORS.money }]} numberOfLines={1} adjustsFontSizeToFit>{ttd(earnCents)}</Text>
                <View style={s.statsRow}>
                    {km ? <Stat icon="navigate-outline" label={`${km} km`} /> : null}
                    {offer?.duration_min ? <Stat icon="time-outline" label={`${offer.duration_min} min`} /> : null}
                    <Stat icon={pay.icon} label={pay.label} />
                    {stopCount > 0 ? <Stat icon="git-commit-outline" label={`+${stopCount} stop${stopCount > 1 ? 's' : ''}`} /> : null}
                </View>
            </Pop>

            {/* Where */}
            <Pop delay={80} style={[s.route, { backgroundColor: m.tile, borderColor: m.chipBorder }]}>
                <View style={s.addrRow}>
                    <View style={[s.dot, { backgroundColor: DRIVE_COLORS.online }]} />
                    <View style={{ flex: 1 }}>
                        <Txt variant="caption" tone="faint">Pick up</Txt>
                        <Txt variant="bodyStrong" numberOfLines={2}>{detailLoading && !offer?.pickup_address ? 'Loading…' : pickup}</Txt>
                    </View>
                </View>
                <View style={[s.connector, { backgroundColor: m.chipBorder }]} />
                <View style={s.addrRow}>
                    <View style={[s.square, { backgroundColor: DRIVE_COLORS.money }]} />
                    <View style={{ flex: 1 }}>
                        <Txt variant="caption" tone="faint">Drop off</Txt>
                        <Txt variant="bodyStrong" numberOfLines={2}>{detailLoading && !offer?.dropoff_address ? 'Loading…' : dropoff}</Txt>
                    </View>
                </View>
            </Pop>

            {badges.length > 0 ? (
                <View style={s.badges}>
                    {badges.map((b) => (
                        <View key={b.label} style={[s.badge, { borderColor: `${b.color}55`, backgroundColor: `${b.color}18` }]}>
                            <Ionicons name={b.icon} size={13} color={b.color} />
                            <Txt variant="label" style={{ color: b.color, marginLeft: 5 }}>{b.label}</Txt>
                        </View>
                    ))}
                </View>
            ) : null}

            <View style={{ flex: 1 }} />

            <View style={s.actions}>
                <Button title="Skip" variant="secondary" onPress={() => handleDecline(false)} disabled={isHandling} style={{ flex: 1 }} />
                <Button title="Accept" icon="checkmark-circle" color={DRIVE_COLORS.online} onPress={handleAccept} loading={isHandling} style={{ flex: 2 }} />
            </View>
        </View>
    );
}

function Stat({ icon, label }: { icon: IconName; label: string }) {
    const m = useTheme();
    return (
        <View style={[s.stat, { backgroundColor: m.field }]}>
            <Ionicons name={icon} size={15} color={m.dim} />
            <Txt variant="label" style={{ marginLeft: 5 }}>{label}</Txt>
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, paddingHorizontal: GUTTER },
    timerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
    seconds: { fontFamily: FONT.roundBlack, fontSize: 28 },
    track: { height: 10, borderRadius: 5, overflow: 'hidden', marginTop: SPACE.sm },
    fill: { height: 10, borderRadius: 5 },
    earnBlock: { marginTop: SPACE.xxl },
    earn: { fontFamily: FONT.roundBlack, fontSize: 60, lineHeight: 68, fontVariant: ['tabular-nums'] },
    statsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm, marginTop: SPACE.sm },
    stat: { flexDirection: 'row', alignItems: 'center', height: 34, paddingHorizontal: 12, borderRadius: 17 },
    route: { marginTop: SPACE.xl, borderRadius: 20, borderWidth: 2, padding: SPACE.lg },
    addrRow: { flexDirection: 'row', alignItems: 'center' },
    dot: { width: 14, height: 14, borderRadius: 7, marginRight: SPACE.md },
    square: { width: 14, height: 14, borderRadius: 4, marginRight: SPACE.md },
    connector: { width: 2, height: 22, marginLeft: 6, marginVertical: 4 },
    badges: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm, marginTop: SPACE.lg },
    badge: { flexDirection: 'row', alignItems: 'center', height: 30, paddingHorizontal: 10, borderRadius: 15, borderWidth: 1 },
    actions: { flexDirection: 'row', gap: SPACE.md },
});
