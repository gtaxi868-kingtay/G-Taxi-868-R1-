import React from 'react';
import { View, Text, Pressable, Alert, StyleSheet, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { Screen, Txt, Card, Section, Row, Pop, FONT, SPACE, GUTTER, tick, useTheme, shade, IconName } from '../ui/kit';
import { DRIVE_COLORS } from '../theme/drive';

// The "You" tab: everything that used to live in the hamburger menu and the
// ten home tiles, grouped so a driver finds things without hunting.

type Tile = { icon: IconName; label: string; screen: string; color: string };

const TILES: Tile[] = [
    { icon: 'calendar', label: 'Scheduled', screen: 'ScheduledRides', color: DRIVE_COLORS.cyan },
    { icon: 'star', label: 'Ratings', screen: 'Ratings', color: DRIVE_COLORS.money },
    { icon: 'document-text', label: 'Documents', screen: 'ComplianceDocuments', color: DRIVE_COLORS.violet },
    { icon: 'people', label: 'Refer a driver', screen: 'DriverReferral', color: DRIVE_COLORS.online },
    { icon: 'storefront', label: 'Scout a shop', screen: 'ScoutReferral', color: DRIVE_COLORS.streak },
    { icon: 'git-network', label: 'Networks', screen: 'Networks', color: DRIVE_COLORS.cyan },
];

const MORE: { icon: IconName; title: string; subtitle: string; screen: string }[] = [
    { icon: 'options-outline', title: 'Trip preferences', subtitle: 'Which trips you want offered', screen: 'StrategySettings' },
    { icon: 'car-sport-outline', title: 'Buy a car', subtitle: 'Vehicles for sale to drivers', screen: 'VehicleSales' },
    { icon: 'key-outline', title: 'Lease a car', subtitle: 'BYD lease, paid from your trips', screen: 'Lease' },
    { icon: 'construct-outline', title: 'G Garage', subtitle: 'Service and repairs', screen: 'GGarage' },
    { icon: 'flag-outline', title: 'Become a G-Lead', subtitle: 'Recruit drivers and shops in your area', screen: 'BecomeCommander' },
];

export function YouScreen({ navigation }: { navigation: { navigate: (screen: string, params?: object) => void } }) {
    const m = useTheme();
    const { width } = useWindowDimensions();
    const { driver, signOut } = useAuth();
    const tileW = (width - GUTTER * 2 - SPACE.md * 2) / 3;
    const go = (screen: string) => { tick(); navigation.navigate(screen); };
    const rating = driver?.rating != null ? Number(driver.rating).toFixed(2) : null;

    return (
        <Screen>
            <Pop>
                <Card onPress={() => go('Profile')} style={{ flexDirection: 'row', alignItems: 'center', marginTop: SPACE.md }}>
                    <View style={[st.avatar, { backgroundColor: m.accent }]}>
                        <Text style={st.avatarText}>{(driver?.name || 'D').charAt(0).toUpperCase()}</Text>
                    </View>
                    <View style={{ flex: 1, marginLeft: SPACE.md }}>
                        <Txt variant="title" numberOfLines={1}>{driver?.name || 'Driver'}</Txt>
                        <Txt variant="caption" tone="dim" numberOfLines={1}>
                            {[driver?.vehicle_model, driver?.plate_number].filter(Boolean).join(' · ') || 'Add your vehicle in your profile'}
                        </Txt>
                        <View style={st.badges}>
                            <View style={[st.badge, { backgroundColor: 'rgba(244,206,119,0.14)' }]}>
                                <Ionicons name="star" size={12} color={DRIVE_COLORS.money} />
                                <Txt variant="label" style={{ color: DRIVE_COLORS.money, marginLeft: 4 }}>{rating ?? 'New'}</Txt>
                            </View>
                            {driver?.verified_status === 'approved' ? (
                                <View style={[st.badge, { backgroundColor: 'rgba(47,208,138,0.14)' }]}>
                                    <Ionicons name="shield-checkmark" size={12} color={DRIVE_COLORS.online} />
                                    <Txt variant="label" style={{ color: DRIVE_COLORS.online, marginLeft: 4 }}>Verified</Txt>
                                </View>
                            ) : null}
                        </View>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color={m.faint} />
                </Card>
            </Pop>

            <Section title="Your tools">
                <View style={st.grid}>
                    {TILES.map((t, i) => (
                        <Pop key={t.screen} delay={40 * i}>
                            <Pressable accessibilityRole="button" accessibilityLabel={t.label} onPress={() => go(t.screen)}
                                style={({ pressed }) => [st.tile, { width: tileW, backgroundColor: m.tile, borderColor: m.chipBorder, transform: [{ translateY: pressed ? 3 : 0 }], borderBottomWidth: pressed ? 2 : 5 }]}>
                                <View style={[st.tileIcon, { backgroundColor: t.color, borderBottomColor: shade(t.color) }]}>
                                    <Ionicons name={t.icon} size={22} color="#08090D" />
                                </View>
                                <Txt variant="label" numberOfLines={2} style={{ textAlign: 'center' }}>{t.label}</Txt>
                            </Pressable>
                        </Pop>
                    ))}
                </View>
            </Section>

            <Section title="More">
                <Card style={{ paddingVertical: 0 }}>
                    {MORE.map((r, i) => (
                        <Row key={r.screen} icon={r.icon} title={r.title} subtitle={r.subtitle} onPress={() => go(r.screen)} last={i === MORE.length - 1} />
                    ))}
                </Card>
            </Section>

            <Section title="Help">
                <Card style={{ paddingVertical: 0 }}>
                    <Row icon="warning-outline" title="Report a problem" subtitle="Trip, payment or safety issue" onPress={() => go('ReportIssue')} />
                    <Row icon="document-outline" title="Terms and privacy" onPress={() => go('Legal')} />
                    <Row icon="log-out-outline" title="Sign out" danger last onPress={() => {
                        Alert.alert('Sign out?', driver?.is_online ? 'You are online. Signing out stops trip offers.' : 'You can sign back in any time.', [
                            { text: 'Cancel', style: 'cancel' },
                            { text: 'Sign out', style: 'destructive', onPress: () => { signOut(); } },
                        ]);
                    }} />
                </Card>
            </Section>
        </Screen>
    );
}

const st = StyleSheet.create({
    avatar: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
    avatarText: { fontFamily: FONT.roundBlack, fontSize: 24, color: '#08090D' },
    badges: { flexDirection: 'row', gap: SPACE.sm, marginTop: SPACE.sm },
    badge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, height: 24, borderRadius: 12 },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.md },
    tile: { alignItems: 'center', paddingVertical: SPACE.lg, paddingHorizontal: SPACE.sm, borderRadius: 20, borderWidth: 2 },
    tileIcon: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: SPACE.sm, borderBottomWidth: 4 },
});
