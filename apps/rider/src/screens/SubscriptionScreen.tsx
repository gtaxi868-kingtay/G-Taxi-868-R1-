import React, { useState, useEffect } from 'react';
import {
    View, StyleSheet, TouchableOpacity, ScrollView,
    Dimensions, Text, ActivityIndicator, Alert
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../../shared/supabase';
import { useAuth } from '../context/AuthContext';

const { width, height } = Dimensions.get('window');

const COLORS = {
    bgPrimary: '#0D0B1E',
    bgSecondary: '#160B32',
    gradientStart: '#1A0533',
    gradientEnd: '#0D1B4B',
    purple: '#7B5CF0',
    purpleDark: '#5B3FD0',
    purpleLight: '#9B7CF0',
    cyan: '#00E5FF',
    cyanDark: '#0099BB',
    white: '#FFFFFF',
    textSecondary: 'rgba(255,255,255,0.6)',
    textMuted: 'rgba(255,255,255,0.5)',
    glassBg: 'rgba(255,255,255,0.06)',
    glassBorder: 'rgba(123,92,240,0.3)',
    gold: '#FFD700',
    goldDark: '#B8860B',
    silver: '#C0C0C0',
    silverDark: '#808080',
    success: '#00FF94',
};

const TIERS = [
    {
        id: 'free',
        name: 'FREE',
        price: 0,
        period: '',
        color: ['#7C3AED', '#4C1D95'],
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

export function SubscriptionScreen({ navigation }: any) {
    const insets = useSafeAreaInsets();
    const { user } = useAuth();
    const [currentTier, setCurrentTier] = useState('free');
    const [loading, setLoading] = useState(true);
    const [subscribing, setSubscribing] = useState<string | null>(null);

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
            console.warn('Failed to fetch tier:', e);
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

        setSubscribing(tierId);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

        // Simulate subscription process
        setTimeout(() => {
            setSubscribing(null);
            Alert.alert(
                'Subscription Ready',
                `The ${tierId.toUpperCase()} plan will be available for purchase soon.`,
                [{ text: 'OK', onPress: () => navigation.goBack() }]
            );
        }, 1500);
    };

    if (loading) {
        return (
            <View style={[s.root, { justifyContent: 'center', alignItems: 'center' }]}>
                <StatusBar style="light" />
                <LinearGradient colors={[COLORS.gradientStart, COLORS.gradientEnd]} style={StyleSheet.absoluteFillObject} />
                <ActivityIndicator color={COLORS.cyan} />
            </View>
        );
    }

    return (
        <View style={s.root}>
            <StatusBar style="light" />
            <LinearGradient colors={[COLORS.gradientStart, COLORS.gradientEnd]} style={StyleSheet.absoluteFillObject} />

            {/* Header */}
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
                                        <Ionicons name="checkmark-circle" size={18} color={COLORS.success} />
                                        <Text style={s.featureText}>{feature}</Text>
                                    </View>
                                ))}
                                {tier.unavailable.map((feature, i) => (
                                    <View key={`u${i}`} style={[s.featureRow, s.unavailable]}>
                                        <Ionicons name="close-circle" size={18} color={COLORS.textMuted} />
                                        <Text style={[s.featureText, s.unavailableText]}>{feature}</Text>
                                    </View>
                                ))}
                            </View>

                            <TouchableOpacity
                                style={[s.subscribeBtn, currentTier === tier.id && s.currentBtn]}
                                onPress={() => handleSubscribe(tier.id)}
                                disabled={subscribing === tier.id}
                            >
                                {subscribing === tier.id ? (
                                    <ActivityIndicator color="#FFF" />
                                ) : (
                                    <Text style={s.subscribeText}>
                                        {currentTier === tier.id ? 'CURRENT PLAN' : tier.id === 'free' ? 'FREE TIER' : 'SUBSCRIBE'}
                                    </Text>
                                )}
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
    root: { flex: 1, backgroundColor: COLORS.bgPrimary },
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
        color: COLORS.textSecondary,
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
        borderColor: COLORS.gold,
    },
    popularBadge: {
        position: 'absolute',
        top: 0,
        right: 0,
        backgroundColor: COLORS.gold,
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderBottomLeftRadius: 12,
        zIndex: 10,
    },
    popularText: {
        fontSize: 11,
        fontWeight: '800',
        color: COLORS.bgPrimary,
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
        color: COLORS.textMuted,
        textDecorationLine: 'line-through',
    },
    subscribeBtn: {
        backgroundColor: 'rgba(255,255,255,0.2)',
        paddingVertical: 14,
        borderRadius: 12,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.3)',
    },
    currentBtn: {
        backgroundColor: 'rgba(0,255,148,0.2)',
        borderColor: COLORS.success,
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
        color: COLORS.textMuted,
        textAlign: 'center',
    },
});
