import React from 'react';
import { Alert, Image, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { supabase } from '@gtaxi/core';
import { useAuth } from '../context/AuthContext';
import { KeyTile } from '../components/KeyTile';
import { CrystalGradient, BRAND_GRADIENT, Pop, Row, Screen, Section, SPACE, tick, Txt, useTheme } from '../ui/kit';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

// Everything the old hamburger drawer held, minus Trips and Wallet, which are
// now their own tabs. Exported so the test can check no page went missing.
export const YOU_TILES: { title: string; subtitle: string; icon: IconName; color: string; route: string }[] = [
    { title: 'Saved places', subtitle: 'Home, work, faves', icon: 'bookmark', color: '#8B7CFF', route: 'SavedPlaces' },
    { title: 'Notifications', subtitle: 'Your updates', icon: 'notifications', color: '#4C9AFF', route: 'Notifications' },
    { title: 'Promotions', subtitle: 'Codes & deals', icon: 'pricetag', color: '#FF8A3D', route: 'Promo' },
    { title: 'Invite friends', subtitle: 'Share G 868', icon: 'people', color: '#2FB57C', route: 'Referral' },
    { title: 'Settings', subtitle: 'App & privacy', icon: 'settings', color: '#6B6480', route: 'Settings' },
    { title: 'Help', subtitle: 'We\'re here 24/7', icon: 'help-buoy', color: '#FF5C8A', route: 'Help' },
];

export function YouScreen({ navigation }: { navigation: { navigate: (route: string, params?: any) => void } }) {
    const m = useTheme();
    const { profile } = useAuth();
    const name: string = (profile as any)?.full_name || (profile as any)?.name || 'Rider';
    const photo: string | null = (profile as any)?.avatar_url || null;

    const signOut = () => {
        Alert.alert('Sign out?', 'You can sign back in any time.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Sign out', style: 'destructive', onPress: async () => { await supabase.auth.signOut(); } },
        ]);
    };

    return (
        <Screen title="You">
            {/* Who you are */}
            <Pop>
                <Pressable accessibilityRole="button" accessibilityLabel="Your profile" onPress={() => { tick(); navigation.navigate('Profile'); }}
                    style={({ pressed }) => ({ opacity: pressed ? 0.9 : 1 })}>
                    <View style={{ borderRadius: 24, overflow: 'hidden' }}>
                        <CrystalGradient colors={BRAND_GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                            style={{ flexDirection: 'row', alignItems: 'center', padding: SPACE.lg }}>
                            <View style={{ width: 60, height: 60, borderRadius: 30, overflow: 'hidden', borderWidth: 3, borderColor: 'rgba(255,255,255,0.6)',
                                backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' }}>
                                {photo
                                    ? <Image source={{ uri: photo }} style={{ width: 60, height: 60 }} />
                                    : <Txt variant="title" tone="onBrand">{name.charAt(0).toUpperCase()}</Txt>}
                            </View>
                            <View style={{ flex: 1, marginLeft: SPACE.md }}>
                                <Txt variant="title" tone="onBrand" numberOfLines={1}>{name}</Txt>
                                <Txt variant="caption" tone="onBrand" style={{ opacity: 0.85 }}>View and edit your profile</Txt>
                            </View>
                            <Ionicons name="chevron-forward" size={20} color="#FFFFFF" />
                        </CrystalGradient>
                    </View>
                </Pressable>
            </Pop>

            {/* Everything else, as big keys */}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: SPACE.lg, marginHorizontal: -SPACE.xs }}>
                {YOU_TILES.map((t, i) => (
                    <Pop key={t.route} delay={60 + i * 40} style={{ width: '50%', paddingHorizontal: SPACE.xs, marginBottom: SPACE.md }}>
                        <KeyTile size="wide" title={t.title} subtitle={t.subtitle} icon={t.icon} color={t.color} onPress={() => navigation.navigate(t.route)} />
                    </Pop>
                ))}
            </View>

            <Section>
                <Row icon="log-out-outline" title="Sign out" danger onPress={signOut} right={<View />} last />
            </Section>
            <Txt variant="caption" tone="faint" style={{ textAlign: 'center', marginTop: SPACE.lg, color: m.faint }}>
                G 868 · version {Constants.expoConfig?.version || '1.0'}
            </Txt>
        </Screen>
    );
}
