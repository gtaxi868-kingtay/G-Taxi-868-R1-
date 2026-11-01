import React, { useMemo } from 'react';
import { View, StyleSheet, Pressable, Text, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { WaitFeeDisplay, EntertainmentHUD, QuietRideBanner, LogisticsHud } from './telemetry';
import { decodePolyline, haversineKm, riderDisplayName } from './telemetry/geo';
import type { NavigationAndStatusControlProps } from './telemetry/types';
import { Button, Txt, FONT, SPACE, tick, useTheme, IconName } from '../ui/kit';
import { DRIVE_COLORS } from '../theme/drive';
import { tripStep } from '../utils/tripStep';

// The active-trip panel (founder, 2026-10-27): one plain sentence saying what
// to do now, one big button that does it, the rider one tap away. The map
// stays visible above it. SOS sits top-left where a thumb finds it fast.

const STEPS = ['Pickup', 'Wait', 'Drop-off'];

function payLabel(method: string | null | undefined): { label: string; icon: IconName; color: string } {
    if (method === 'card') return { label: 'Card · paid in app', icon: 'card-outline', color: DRIVE_COLORS.cyan };
    if (method === 'wallet') return { label: 'Wallet · paid in app', icon: 'wallet-outline', color: DRIVE_COLORS.cyan };
    return { label: 'Cash · collect at the end', icon: 'cash-outline', color: DRIVE_COLORS.money };
}

export function NavigationAndStatusControl(props: NavigationAndStatusControlProps) {
    const m = useTheme();
    const insets = useSafeAreaInsets();
    const { ride, rider, orderItems = [], isQuietRide, hasMerchantPhoto,
        onArrived, onVerifyPickup, onComplete, onCancel, onSOS, onOpenNavigation, onChat, onCall,
        onDeliveryConfirmPickup, onEntertainmentAccept, onEntertainmentReject,
    } = props;
    const status = ride?.status || '';
    const isDelivery = !!ride?.order_id;
    const now = tripStep(status, isDelivery, !!hasMerchantPhoto);

    const coords = useMemo(
        () => props.routeCoords?.length ? props.routeCoords : (ride?.route_geometry ? decodePolyline(ride.route_geometry) : []),
        [props.routeCoords, ride?.route_geometry],
    );
    const km = useMemo(() => haversineKm(coords), [coords]);
    const pay = payLabel(ride?.payment_method);
    const where = status === 'assigned' ? ride?.pickup_address : ride?.dropoff_address;

    if (status === 'completed' || status === 'closed') return null;

    const runAction = () => {
        if (!now.actionEnabled) {
            if (now.action === 'deliveryPickup') Alert.alert('Waiting for the shop', 'The shop must photograph the order before you take it. Ask them to tap "Ready" in their app.');
            return;
        }
        if (now.action === 'arrived') onArrived?.();
        else if (now.action === 'verify') onVerifyPickup?.();
        else if (now.action === 'deliveryPickup') onDeliveryConfirmPickup?.();
        else if (now.action === 'complete') onComplete?.();
    };

    return (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
            {/* Top: SOS (left), signal (centre), cancel (right) */}
            <View style={[st.top, { top: insets.top + SPACE.sm }]} pointerEvents="box-none">
                <Pressable onPress={() => { tick(); onSOS?.(); }} accessibilityRole="button" accessibilityLabel="SOS emergency" style={st.sos}>
                    <Text style={st.sosText}>SOS</Text>
                </Pressable>
                {props.signalStatus === 'dead_reckoning' || props.signalStatus === 'searching' ? (
                    <View style={[st.glass, st.signal]}>
                        <Ionicons name="cellular-outline" size={14} color={DRIVE_COLORS.warn} />
                        <Txt variant="label" style={{ color: DRIVE_COLORS.warn, marginLeft: 6 }}>{props.signalStatus === 'searching' ? 'Finding GPS…' : 'Weak GPS'}</Txt>
                    </View>
                ) : <View />}
                <Pressable onPress={() => { tick(); onCancel?.(); }} accessibilityRole="button" accessibilityLabel="Cancel trip" style={[st.glass, st.round]}>
                    <Ionicons name="close" size={22} color={m.ink} />
                </Pressable>
            </View>

            {/* Bottom panel */}
            <View style={st.panelWrap}>
                <LinearGradient colors={m.sheet as [string, string]} style={[st.panel, { borderColor: m.sheetBorder, paddingBottom: Math.max(insets.bottom, SPACE.lg) }]}>
                    {/* Step track */}
                    <View style={st.track}>
                        {STEPS.map((label, i) => (
                            <View key={label} style={{ flex: 1 }}>
                                <View style={[st.seg, { backgroundColor: i <= now.step ? DRIVE_COLORS.online : m.field }]} />
                                <Txt variant="caption" tone={i === now.step ? 'ink' : 'faint'} style={{ marginTop: 4 }}>{label}</Txt>
                            </View>
                        ))}
                    </View>

                    <Txt variant="title" style={{ marginTop: SPACE.md }}>{now.title}</Txt>
                    {where ? <Txt variant="bodyStrong" tone="dim" numberOfLines={2} style={{ marginTop: 2 }}>{where}</Txt> : null}
                    <Txt variant="caption" tone="faint" style={{ marginTop: 4 }}>
                        {km > 0 ? `${km.toFixed(1)} km on the route · ` : ''}{now.hint}
                    </Txt>

                    {status === 'arrived' && ride?.arrived_at ? <View style={{ marginTop: SPACE.md }}><WaitFeeDisplay arrivedAt={ride.arrived_at} /></View> : null}
                    {orderItems.length > 0 ? <View style={{ marginTop: SPACE.md }}><LogisticsHud items={orderItems} /></View> : null}
                    {isQuietRide ? <View style={{ marginTop: SPACE.md }}><QuietRideBanner /></View> : null}
                    {ride?.entertainment_url && ride?.entertainment_status === 'pending' ? (
                        <View style={{ marginTop: SPACE.md }}><EntertainmentHUD url={ride.entertainment_url} onAccept={onEntertainmentAccept} onReject={onEntertainmentReject} /></View>
                    ) : null}

                    {/* Rider */}
                    <View style={[st.rider, { borderColor: m.chipBorder }]}>
                        <View style={[st.avatar, { backgroundColor: m.field }]}>
                            <Ionicons name="person" size={20} color={m.dim} />
                        </View>
                        <View style={{ flex: 1, marginLeft: SPACE.md }}>
                            <Txt variant="bodyStrong" numberOfLines={1}>{riderDisplayName(rider)}</Txt>
                            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
                                <Ionicons name={pay.icon} size={13} color={pay.color} />
                                <Txt variant="caption" style={{ color: pay.color, marginLeft: 4 }}>{pay.label}</Txt>
                            </View>
                        </View>
                        <Pressable onPress={() => { tick(); onChat?.(); }} accessibilityRole="button" accessibilityLabel="Message rider" style={[st.round, { backgroundColor: m.field }]}>
                            <Ionicons name="chatbubble-ellipses" size={20} color={m.ink} />
                        </Pressable>
                        <Pressable onPress={() => { tick(); onCall?.(); }} accessibilityRole="button" accessibilityLabel="Call rider" style={[st.round, { backgroundColor: m.field, marginLeft: SPACE.sm }]}>
                            <Ionicons name="call" size={20} color={m.ink} />
                        </Pressable>
                    </View>

                    {/* Actions */}
                    <View style={st.actions}>
                        {onOpenNavigation ? (
                            <Button title="Navigate" icon="navigate" variant="secondary" onPress={onOpenNavigation} style={{ flex: 1 }} />
                        ) : null}
                        {now.action ? (
                            <Button
                                title={now.actionLabel}
                                icon={now.actionIcon}
                                color={now.action === 'complete' ? DRIVE_COLORS.moneyDeep : DRIVE_COLORS.online}
                                onPress={runAction}
                                disabled={!now.actionEnabled}
                                style={{ flex: 2 }}
                            />
                        ) : null}
                    </View>
                </LinearGradient>
            </View>
        </View>
    );
}

const st = StyleSheet.create({
    top: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', zIndex: 20 },
    glass: { backgroundColor: 'rgba(14,17,23,0.9)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
    sos: { width: 56, height: 56, borderRadius: 28, backgroundColor: DRIVE_COLORS.danger, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 4, borderBottomColor: '#B3262B' },
    sosText: { fontFamily: FONT.roundBlack, fontSize: 16, color: '#FFFFFF', letterSpacing: 0.5 },
    signal: { flexDirection: 'row', alignItems: 'center', height: 34, paddingHorizontal: 12, borderRadius: 17 },
    round: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
    panelWrap: { position: 'absolute', left: 0, right: 0, bottom: 0 },
    panel: { borderTopLeftRadius: 28, borderTopRightRadius: 28, borderWidth: 1, borderBottomWidth: 0, paddingHorizontal: SPACE.xl, paddingTop: SPACE.lg },
    track: { flexDirection: 'row', gap: SPACE.sm },
    seg: { height: 6, borderRadius: 3 },
    rider: { flexDirection: 'row', alignItems: 'center', marginTop: SPACE.lg, paddingTop: SPACE.lg, borderTopWidth: 1 },
    avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
    actions: { flexDirection: 'row', gap: SPACE.md, marginTop: SPACE.lg },
});
