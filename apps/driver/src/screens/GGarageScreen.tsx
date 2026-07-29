import React from 'react';
import {
    View, Text, StyleSheet, ScrollView, TouchableOpacity,
    ActivityIndicator, Alert, RefreshControl, Switch,
} from 'react-native';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SURFACE, VOICES } from '@gtaxi/design-system';
import { ghostBorder, glassSurface } from '@gtaxi/design-system/utils/style-rules';
import { AppScreenProps } from '../navigation/types';
import { useGGarage, type VehicleClass } from '../hooks/useGGarage';

const driver = VOICES.driver;

const TIER_LABEL: Record<string, { label: string; color: string; icon: keyof typeof Ionicons.glyphMap }> = {
    entry: { label: 'Entry', color: driver.textMuted, icon: 'ellipse-outline' },
    proven: { label: 'Proven', color: driver.accent, icon: 'checkmark-circle' },
    elite: { label: 'Elite', color: driver.gold, icon: 'star' },
};

const STATUS_COLOR: Record<string, string> = {
    pending: driver.gold,
    approved: '#10B981',
    active: '#10B981',
    rejected: '#EF4444',
    completed: driver.textMuted,
    defaulted: '#EF4444',
};

const formatTTD = (cents: number) => `$${(cents / 100).toFixed(2)} TTD`;
const CONTRIBUTION_STEP_CENTS = 500;

export default function GGarageScreen({ navigation }: AppScreenProps<'GGarage'>) {
    const insets = useSafeAreaInsets();
    const {
        tier, registrationClass, eligibility, vehicleClasses, openRequest,
        loading, refreshing, submitting, refresh, submitRequest,
    } = useGGarage();

    const [selectedClass, setSelectedClass] = React.useState<string | null>(null);
    const [source, setSource] = React.useState<'local_dealer' | 'platform_import'>('local_dealer');
    const [contribution, setContribution] = React.useState(0);
    const [hOptIn, setHOptIn] = React.useState(false);

    React.useEffect(() => {
        if (eligibility?.eligible && contribution === 0) {
            setContribution(eligibility.min_daily_contribution_cents!);
        }
        if (!selectedClass && vehicleClasses.length) {
            setSelectedClass(vehicleClasses[0].key);
        }
    }, [eligibility, vehicleClasses]);

    const tierInfo = TIER_LABEL[tier] ?? TIER_LABEL.entry;
    const canRequest = !openRequest && registrationClass !== 'private' && eligibility?.eligible;

    const adjustContribution = (delta: number) => {
        if (!eligibility?.eligible) return;
        Haptics.selectionAsync();
        setContribution((c) => Math.min(
            eligibility.max_daily_contribution_cents!,
            Math.max(eligibility.min_daily_contribution_cents!, c + delta),
        ));
    };

    const onSubmit = async () => {
        if (!selectedClass) {
            Alert.alert('Choose a vehicle', 'Select a vehicle class first');
            return;
        }
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        const result = await submitRequest({
            vehicleClassKey: selectedClass,
            source,
            requestedDailyContributionCents: contribution,
            hRegistrationOptIn: hOptIn,
        });
        if (!result.success) {
            Alert.alert('Error', result.error || 'Request failed');
            return;
        }
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert('Request Submitted', 'Your G Garage request is pending admin review. You will be notified when it is decided.');
    };

    if (loading) {
        return (
            <View style={[s.root, s.center]}>
                <ActivityIndicator color={driver.accent} size="large" />
            </View>
        );
    }

    return (
        <View style={s.root}>
            <BlurView tint="dark" intensity={90} style={[s.headerBlur, { paddingTop: insets.top }, glassSurface(90, 0.2)]}>
                <View style={s.headerInner}>
                    <TouchableOpacity
                        style={s.backBtn}
                        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); navigation.goBack(); }}
                        accessibilityLabel="Go back"
                        accessibilityRole="button"
                    >
                        <Ionicons name="chevron-back" size={24} color={driver.text} />
                    </TouchableOpacity>
                    <Text style={s.headerTitle}>G Garage</Text>
                    <View style={{ width: 44 }} />
                </View>
            </BlurView>

            <ScrollView
                contentContainerStyle={[s.scroll, { paddingTop: insets.top + 80 }]}
                showsVerticalScrollIndicator={false}
                refreshControl={
                    <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={driver.accent} colors={[driver.accent]} />
                }
            >
                {/* Tier */}
                <View style={[s.card, glassSurface(0.15), { flexDirection: 'row', alignItems: 'center', gap: 14 }]}>
                    <View style={[s.tierBadge, { backgroundColor: `${tierInfo.color}18` }]}>
                        <Ionicons name={tierInfo.icon} size={24} color={tierInfo.color} />
                    </View>
                    <View style={{ flex: 1 }}>
                        <Text style={[s.cardTitle, { color: tierInfo.color, marginBottom: 2 }]}>{tierInfo.label} Tier</Text>
                        <Text style={s.mutedText}>Unlocks from your real ride history and rank — not a purchase.</Text>
                    </View>
                </View>

                {/* Registration compliance */}
                {registrationClass !== 'H' && (
                    <View style={[s.card, glassSurface(0.15), s.warnCard]}>
                        <Ionicons name="warning" size={22} color="#EF4444" />
                        <Text style={[s.mutedText, { flex: 1, marginLeft: 12, color: '#F3B4B4' }]}>
                            {registrationClass === 'private'
                                ? "Your vehicle is flagged as a private (non-for-hire) plate. You can't receive a G Garage vehicle until this is resolved."
                                : "Your vehicle registration ('H' for-hire plate) hasn't been verified yet. Upload proof from Profile → Documents to unlock G Garage."}
                        </Text>
                    </View>
                )}

                {/* Open request */}
                {openRequest && (
                    <View style={[s.card, glassSurface(0.15)]}>
                        <Text style={s.sectionLabel}>YOUR REQUEST</Text>
                        <Text style={s.vehicleName}>
                            {vehicleClasses.find((c) => c.key === openRequest.vehicle_class_key)?.label ?? openRequest.vehicle_class_key}
                        </Text>
                        <View style={s.statsRow}>
                            <View style={s.statBox}>
                                <Text style={[s.statValue, { color: driver.gold }]}>{formatTTD(openRequest.requested_daily_contribution_cents)}</Text>
                                <Text style={s.statLabel}>Per Day</Text>
                            </View>
                            <View style={s.statSep} />
                            <View style={s.statBox}>
                                <Text style={[s.statValue, { color: STATUS_COLOR[openRequest.status] ?? driver.text, textTransform: 'uppercase' }]}>
                                    {openRequest.status}
                                </Text>
                                <Text style={s.statLabel}>Status</Text>
                            </View>
                        </View>
                        {openRequest.decision_reason && (
                            <Text style={[s.mutedText, { marginTop: 14 }]}>{openRequest.decision_reason}</Text>
                        )}
                    </View>
                )}

                {/* Not eligible */}
                {!openRequest && registrationClass !== 'private' && !eligibility?.eligible && (
                    <View style={[s.card, glassSurface(0.15)]}>
                        <Text style={s.cardTitle}>Not Yet Eligible</Text>
                        <Text style={s.mutedText}>
                            G Garage sizes your contribution range from your own real earnings — drive at least{' '}
                            {eligibility?.days_required ?? 14} distinct days with completed rides in the last 30 days.
                            You currently have {eligibility?.days_with_earnings ?? 0}.
                        </Text>
                    </View>
                )}

                {/* Request form */}
                {canRequest && (
                    <>
                        <View style={[s.card, glassSurface(0.15)]}>
                            <Text style={s.sectionLabel}>CHOOSE A VEHICLE</Text>
                            {vehicleClasses.map((vc: VehicleClass) => {
                                const active = selectedClass === vc.key;
                                return (
                                    <TouchableOpacity
                                        key={vc.key}
                                        onPress={() => { Haptics.selectionAsync(); setSelectedClass(vc.key); }}
                                        style={[s.choiceRow, active && s.choiceRowActive]}
                                        accessibilityRole="radio"
                                        accessibilityState={{ checked: active }}
                                    >
                                        <Ionicons
                                            name={active ? 'radio-button-on' : 'radio-button-off'}
                                            size={20}
                                            color={active ? driver.gold : 'rgba(255,255,255,0.3)'}
                                        />
                                        <View style={{ marginLeft: 12, flex: 1 }}>
                                            <Text style={s.choiceLabel}>{vc.label}</Text>
                                            {vc.description && <Text style={s.choiceSubtext}>{vc.description}</Text>}
                                        </View>
                                    </TouchableOpacity>
                                );
                            })}
                            {vehicleClasses.length === 0 && (
                                <Text style={s.mutedText}>No vehicle classes currently available — check back soon.</Text>
                            )}
                        </View>

                        <View style={[s.card, glassSurface(0.15)]}>
                            <Text style={s.sectionLabel}>SOURCE</Text>
                            <View style={{ flexDirection: 'row', gap: 10 }}>
                                {(['local_dealer', 'platform_import'] as const).map((opt) => {
                                    const active = source === opt;
                                    return (
                                        <TouchableOpacity
                                            key={opt}
                                            onPress={() => { Haptics.selectionAsync(); setSource(opt); }}
                                            style={[s.sourceBtn, active && { backgroundColor: driver.accent, borderColor: driver.accent }]}
                                        >
                                            <Text style={[s.sourceBtnText, active && { color: SURFACE.base }]}>
                                                {opt === 'local_dealer' ? 'Local Dealer' : 'Platform Import'}
                                            </Text>
                                        </TouchableOpacity>
                                    );
                                })}
                            </View>
                            {source === 'platform_import' && (
                                <Text style={[s.mutedText, { marginTop: 10 }]}>
                                    Platform-facilitated import may be cheaper but depends on legal confirmation for your
                                    specific vehicle. The local dealer is always the safe fallback.
                                </Text>
                            )}
                        </View>

                        <View style={[s.card, glassSurface(0.15)]}>
                            <Text style={s.sectionLabel}>YOUR DAILY CONTRIBUTION</Text>
                            <Text style={s.mutedText}>
                                Computed from your real last-30-day earnings. Choose anywhere in your range — pay more
                                to own it faster, or stay near the minimum.
                            </Text>
                            <Text style={s.contributionValue}>{formatTTD(contribution)}/day</Text>
                            <View style={s.stepperRow}>
                                <TouchableOpacity onPress={() => adjustContribution(-CONTRIBUTION_STEP_CENTS)} style={s.stepperBtn}>
                                    <Ionicons name="remove" size={22} color={driver.gold} />
                                </TouchableOpacity>
                                <View style={s.stepperTrack}>
                                    <View
                                        style={[
                                            s.stepperFill,
                                            {
                                                width: `${Math.min(100, Math.max(0,
                                                    ((contribution - eligibility!.min_daily_contribution_cents!) /
                                                        Math.max(1, eligibility!.max_daily_contribution_cents! - eligibility!.min_daily_contribution_cents!)) * 100,
                                                ))}%` as any,
                                            },
                                        ]}
                                    />
                                </View>
                                <TouchableOpacity onPress={() => adjustContribution(CONTRIBUTION_STEP_CENTS)} style={s.stepperBtn}>
                                    <Ionicons name="add" size={22} color={driver.gold} />
                                </TouchableOpacity>
                            </View>
                            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                                <Text style={s.rangeLabel}>Min {formatTTD(eligibility!.min_daily_contribution_cents!)}</Text>
                                <Text style={s.rangeLabel}>Max {formatTTD(eligibility!.max_daily_contribution_cents!)}</Text>
                            </View>
                            <Text style={[s.mutedText, { marginTop: 10 }]}>
                                Platform matches a percentage of every dollar you commit, funded from the platform
                                reserve — you never pay more than you chose.
                            </Text>
                        </View>

                        <View style={[s.card, glassSurface(0.15), { flexDirection: 'row', alignItems: 'center' }]}>
                            <View style={{ flex: 1, marginRight: 12 }}>
                                <Text style={s.choiceLabel}>Apply for 'H' registration through G Garage</Text>
                                <Text style={s.choiceSubtext}>Optional, paid convenience service. Skip if your vehicle is already 'H' registered.</Text>
                            </View>
                            <Switch value={hOptIn} onValueChange={(v) => { Haptics.selectionAsync(); setHOptIn(v); }} trackColor={{ true: driver.accent }} />
                        </View>

                        <TouchableOpacity
                            onPress={onSubmit}
                            disabled={submitting || !selectedClass}
                            style={[s.submitBtn, (submitting || !selectedClass) && { opacity: 0.5 }]}
                        >
                            {submitting ? (
                                <ActivityIndicator color={SURFACE.base} size="small" />
                            ) : (
                                <>
                                    <Ionicons name="construct-sharp" size={18} color={SURFACE.base} style={{ marginRight: 8 }} />
                                    <Text style={s.submitBtnText}>SUBMIT REQUEST</Text>
                                </>
                            )}
                        </TouchableOpacity>
                    </>
                )}

                <View style={{ height: insets.bottom + 40 }} />
            </ScrollView>
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: SURFACE.base },
    center: { justifyContent: 'center', alignItems: 'center' },
    scroll: { paddingHorizontal: 20 },

    headerBlur: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20, ...ghostBorder(0.15) },
    headerInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 16 },
    backBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' },
    headerTitle: { fontSize: 20, fontWeight: '800', color: driver.text },

    card: { padding: 24, marginBottom: 16, borderRadius: 24, ...ghostBorder(0.15) },
    warnCard: { flexDirection: 'row', alignItems: 'center', borderColor: 'rgba(239,68,68,0.3)' },
    cardTitle: { fontSize: 18, fontWeight: '800', color: driver.text, marginBottom: 8 },
    mutedText: { fontSize: 13, color: driver.textMuted, lineHeight: 19 },
    sectionLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 1.5, color: driver.textMuted, marginBottom: 14, textTransform: 'uppercase' },

    tierBadge: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },

    vehicleName: { fontSize: 22, fontWeight: '800', color: driver.text, marginBottom: 14 },
    statsRow: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 16, padding: 16, alignItems: 'center' },
    statBox: { flex: 1, alignItems: 'center' },
    statValue: { fontSize: 16, fontWeight: '800', marginBottom: 4 },
    statLabel: { fontSize: 11, color: driver.textMuted, textAlign: 'center' },
    statSep: { width: 1, height: 32, backgroundColor: 'rgba(255,255,255,0.08)' },

    choiceRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 12, borderRadius: 14, marginBottom: 6, borderWidth: 1, borderColor: 'transparent' },
    choiceRowActive: { backgroundColor: `${driver.gold}15`, borderColor: `${driver.gold}4D` },
    choiceLabel: { fontSize: 15, fontWeight: '700', color: driver.text },
    choiceSubtext: { fontSize: 12, color: driver.textMuted, marginTop: 2 },

    sourceBtn: { flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', alignItems: 'center' },
    sourceBtnText: { fontSize: 13, fontWeight: '700', color: driver.text },

    contributionValue: { fontSize: 28, fontWeight: '800', color: driver.gold, marginTop: 12 },
    stepperRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12, marginBottom: 8 },
    stepperBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: `${driver.gold}1F`, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: `${driver.gold}40` },
    stepperTrack: { flex: 1, height: 6, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 3, overflow: 'hidden' },
    stepperFill: { height: '100%', backgroundColor: driver.gold, borderRadius: 3 },
    rangeLabel: { fontSize: 11, color: driver.textMuted },

    submitBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: driver.gold, borderRadius: 14, paddingVertical: 16, marginTop: 8 },
    submitBtnText: { fontSize: 15, fontWeight: '800', color: SURFACE.base },
});
