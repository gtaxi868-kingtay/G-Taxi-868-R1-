import React, { useState, useEffect } from 'react';
import {
    View, StyleSheet, TouchableOpacity, ScrollView,
    useWindowDimensions, Text, ActivityIndicator, Alert
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@gtaxi/core';
import { useAuth } from '../context/AuthContext';
import { SURFACE, VOICES, ANIMATION } from '@gtaxi/design-system';
import { ghostBorder, elevationGlow, glassSurface } from '@gtaxi/design-system/utils/style-rules';
import { AppScreenProps } from '../navigation/types';

const CYAN = '#06B6D4';

const TIERS = [
    {
        id: 'free',
        name: 'FREE',
        price: 0,
        period: '',
        color: [VOICES.rider.accent, VOICES.rider.accentDark],
        icon: 'person',
        features: ['Standard pricing', '3 min wait grace', 'Regular matching'],
        unavailable: ['Priority matching', 'Extra discounts', 'VIP support']
    },
    {
        id: 'plus',
        name: 'PLUS',
        price: 29,
        period: '/month',
        color: ['#C0C0C0', '#808080'],
        icon: 'star',
        popular: false,
        features: ['10% off all rides', '5 min wait grace', 'Priority matching', 'Premium support'],
        unavailable: ['Maximum discounts']
    },
    {
        id: 'pro',
        name: 'PRO',
        price: 79,
        period: '/month',
        color: ['#FFD700', '#FFA500'],
        icon: 'diamond',
        popular: true,
        features: ['20% off all rides', '8 min wait grace', 'VIP priority', '24/7 support', 'Free cancellations'],
        unavailable: []
    }
];

export function SubscriptionScreen({ navigation }: AppScreenProps<'Subscription'>) {
    const { width, height } = useWindowDimensions();
    const insets = useSafeAreaInsets();
    const { user } = useAuth();
    const [currentTier, setCurrentTier] = useState('free');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchCurrentTier();
    }, []);

    const fetchCurrentTier = async () => {
        if (!user?.id) return;
        try {
            const { data } = await supabase
                .from('profiles')
                .select('subscription_tier')
                .eq('id', user.id)
                .single();
            if (data) setCurrentTier(data.subscription_tier || 'free');
        } catch (e) {
        } finally {
            setLoading(false);
        }
    };

    const handleSubscribe = async (tierId: string) => {
        if (tierId === currentTier) {
            Alert.alert('Current Plan', `You're already on the ${tierId.toUpperCase()} plan.`);
            return;
        }

        if (tierId === 'free') {
            Alert.alert('Downgrade', 'Contact support to downgrade your plan.');
            return;
        }

        Alert.alert(
            'Coming Soon',
            'Subscription billing will be available soon. Stay tuned for Plus and Pro plans!',
            [{ text: 'OK' }]
        );
    };

    if (loading) {
        return (
            <View style={[s.root, { justifyContent: 'center', alignItems: 'center' }]}>
                <StatusBar style="light" />
                <LinearGradient colors={['#1A0533', '#0D1B4B']} style={StyleSheet.absoluteFillObject} />
                <ActivityIndicator color={CYAN} />
            </View>
        );
    }

    return (
        <View style={s.root}>
            <StatusBar style="light" />
            <LinearGradient colors={['#1A0533', '#0D1B4B']} style={StyleSheet.absoluteFillObject} />

            <View style={[s.header, { paddingTop: insets.top + 20 }]}>
                <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()}>
                    <Ionicons name="chevron-back" size={28} color="#FFF" />
                </TouchableOpacity>
                <Text style={s.headerTitle}>Choose Your Plan</Text>
                <Text style={s.headerSubtitle}>Upgrade for better rides</Text>
            </View>

            <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
                {TIERS.map((tier) => (
                    <View key={tier.id} style={[s.tierCard, tier.popular && s.popularCard]}>
                        {tier.popular && (
                            <View style={s.popularBadge}>
                                <Text style={s.popularText}>MOST POPULAR</Text>
                            </View>
                        )}

                        <LinearGradient colors={tier.color as any} style={s.tierGradient}>
                            <View style={s.tierHeader}>
                                <View style={s.tierIcon}>
                                    <Ionicons name={tier.icon as any} size={24} color="#FFF" />
                                </View>
                                <View>
                                    <Text style={s.tierName}>{tier.name}</Text>
                                    <View style={s.priceRow}>
                                        <Text style={s.price}>${tier.price}</Text>
                                        <Text style={s.period}>{tier.period}</Text>
                                    </View>
                                </View>
                            </View>

                            <View style={s.features}>
                                {tier.features.map((feature, i) => (
                                    <View key={i} style={s.featureRow}>
                                        <Ionicons name="checkmark-circle" size={18} color="#10B981" />
                                        <Text style={s.featureText}>{feature}</Text>
                                    </View>
                                ))}
                                {tier.unavailable.map((feature, i) => (
                                    <View key={`u${i}`} style={[s.featureRow, s.unavailable]}>
                                        <Ionicons name="close-circle" size={18} color="rgba(255,255,255,0.6)" />
                                        <Text style={[s.featureText, s.unavailableText]}>{feature}</Text>
                                    </View>
                                ))}
                            </View>

                            <TouchableOpacity
                                style={[s.subscribeBtn, currentTier === tier.id && s.currentBtn, tier.id !== 'free' && tier.id !== currentTier && {opacity: 0.6}]}
                                onPress={() => handleSubscribe(tier.id)}
                                disabled={tier.id !== 'free' && tier.id !== currentTier}
                            >
                                <Text style={s.subscribeText}>
                                    {currentTier === tier.id ? 'CURRENT PLAN' : tier.id === 'free' ? 'FREE TIER' : 'COMING SOON'}
                                </Text>
                            </TouchableOpacity>
                        </LinearGradient>
                    </View>
                ))}

                <View style={s.footer}>
                    <Text style={s.footerText}>Subscriptions renew automatically. Cancel anytime.</Text>
                </View>
            </ScrollView>
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: SURFACE.base },
    header: {
        paddingHorizontal: 20,
        paddingBottom: 20,
    },
    backBtn: {
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: 'rgba(255,255,255,0.1)',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 16,
    },
    headerTitle: {
        fontSize: 28,
        fontWeight: '800',
        color: '#FFF',
    },
    headerSubtitle: {
        fontSize: 14,
        color: 'rgba(255,255,255,0.6)',
        marginTop: 4,
    },
    scroll: {
        padding: 20,
        paddingBottom: 40,
    },
    tierCard: {
        borderRadius: 24,
        marginBottom: 16,
        overflow: 'hidden',
    },
    popularCard: {
        borderWidth: 2,
        borderColor: '#FFD700',
    },
    popularBadge: {
        position: 'absolute',
        top: 0,
        right: 0,
        backgroundColor: '#FFD700',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderBottomLeftRadius: 12,
        zIndex: 10,
    },
    popularText: {
        fontSize: 11,
        fontWeight: '800',
        color: SURFACE.base,
    },
    tierGradient: {
        padding: 20,
    },
    tierHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 16,
    },
    tierIcon: {
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: 'rgba(255,255,255,0.2)',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
    },
    tierName: {
        fontSize: 20,
        fontWeight: '800',
        color: '#FFF',
    },
    priceRow: {
        flexDirection: 'row',
        alignItems: 'baseline',
    },
    price: {
        fontSize: 32,
        fontWeight: '800',
        color: '#FFF',
    },
    period: {
        fontSize: 14,
        color: 'rgba(255,255,255,0.8)',
        marginLeft: 4,
    },
    features: {
        marginVertical: 16,
    },
    featureRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginVertical: 6,
    },
    featureText: {
        fontSize: 14,
        color: '#FFF',
        marginLeft: 10,
        fontWeight: '500',
    },
    unavailable: {
        opacity: 0.6,
    },
    unavailableText: {
        color: 'rgba(255,255,255,0.6)',
        textDecorationLine: 'line-through',
    },
    subscribeBtn: {
        backgroundColor: 'rgba(255,255,255,0.2)',
        paddingVertical: 14,
        borderRadius: 12,
        alignItems: 'center',
        ...ghostBorder(),
    },
    currentBtn: {
        backgroundColor: 'rgba(16,185,129,0.2)',
        borderColor: '#10B981',
    },
    subscribeText: {
        fontSize: 15,
        fontWeight: '800',
        color: '#FFF',
    },
    footer: {
        marginTop: 20,
        alignItems: 'center',
    },
    footerText: {
        fontSize: 12,
        color: 'rgba(255,255,255,0.6)',
        textAlign: 'center',
    },
});
