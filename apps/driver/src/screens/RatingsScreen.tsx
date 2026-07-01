import React, { useEffect, useState, useCallback } from 'react';
import {
    View, StyleSheet, ScrollView, TouchableOpacity,
    ActivityIndicator, Text, RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@gtaxi/core';
import { useAuth } from '../context/AuthContext';
import { SURFACE, VOICES } from '@gtaxi/design-system';
import { ghostBorder, glassSurface } from '@gtaxi/design-system/utils/style-rules';

interface RatingRow {
    id: string;
    rating: number;
    comment: string | null;
    ride_id: string;
    created_at: string;
    rider_name?: string;
}

export function RatingsScreen({ navigation }: { navigation: { goBack: () => void } }) {
    const insets = useSafeAreaInsets();
    const { driver } = useAuth();
    const [avgRating, setAvgRating] = useState<number | null>(null);
    const [totalRatings, setTotalRatings] = useState(0);
    const [ratings, setRatings] = useState<RatingRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    const fetchRatings = useCallback(async () => {
        if (!driver?.id) return;

        const { data: profile } = await supabase
            .from('profiles')
            .select('avg_rating, total_ratings')
            .eq('id', driver.id)
            .single();

        if (profile) {
            setAvgRating(profile.avg_rating);
            setTotalRatings(profile.total_ratings || 0);
        }

        const { data: rows } = await supabase
            .from('ratings')
            .select('id, rating, comment, ride_id, created_at')
            .eq('driver_id', driver.id)
            .order('created_at', { ascending: false })
            .limit(50);

        if (rows) setRatings(rows);
        setLoading(false);
        setRefreshing(false);
    }, [driver?.id]);

    useEffect(() => { fetchRatings(); }, [fetchRatings]);

    const onRefresh = () => {
        setRefreshing(true);
        fetchRatings();
    };

    if (loading) {
        return (
            <View style={[s.root, s.center]}>
                <ActivityIndicator color={VOICES.driver.accent} size="large" />
            </View>
        );
    }

    const starCount = Math.round(avgRating || 0);

    return (
        <View style={s.root}>
            <BlurView tint="dark" intensity={80} style={[s.headerBlur, { paddingTop: insets.top + 8 }, glassSurface(80, 0.2)]}>
                <View style={s.headerInner}>
                    <TouchableOpacity style={s.backBtn} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); navigation.goBack(); }} activeOpacity={0.8}>
                        <Ionicons name="chevron-back" size={22} color="#EAF3F6" />
                    </TouchableOpacity>
                    <Text style={{ fontSize: 20, fontWeight: '700', color: '#EAF3F6' }}>My Ratings</Text>
                    <View style={s.backBtn} pointerEvents="none" />
                </View>
            </BlurView>

            <ScrollView
                contentContainerStyle={[s.scroll, { paddingTop: insets.top + 64 }]}
                showsVerticalScrollIndicator={false}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={VOICES.driver.accent} colors={[VOICES.driver.accent]} />}
            >
                <View style={s.hero}>
                    <Text style={s.heroRating}>{avgRating?.toFixed(1) || '0.0'}</Text>
                    <View style={s.starRow}>
                        {[1, 2, 3, 4, 5].map(i => (
                            <Ionicons key={i} name={i <= starCount ? 'star' : 'star-outline'} size={22} color="#E6B450" />
                        ))}
                    </View>
                    <Text style={s.heroSubtext}>{totalRatings} rating{totalRatings !== 1 ? 's' : ''}</Text>
                </View>

                {ratings.length === 0 ? (
                    <View style={s.emptyWrap}>
                        <Ionicons name="star-outline" size={36} color="rgba(255,255,255,0.6)" />
                        <Text style={{ fontSize: 14, color: 'rgba(255,255,255,0.6)', marginTop: 12, textAlign: 'center' }}>
                            No ratings yet. Keep driving!
                        </Text>
                    </View>
                ) : (
                    <View style={s.list}>
                        {ratings.map((r, idx) => {
                            const date = new Date(r.created_at);
                            const dateStr = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
                            return (
                                <View key={r.id} style={[s.row, idx === ratings.length - 1 && { borderBottomWidth: 0 }]}>
                                    <View style={s.rowLeft}>
                                        <Text style={s.rowRating}>{r.rating}</Text>
                                        <Ionicons name="star" size={14} color="#E6B450" />
                                    </View>
                                    <View style={{ flex: 1 }}>
                                        {r.comment ? (
                                            <Text style={s.rowComment} numberOfLines={2}>{r.comment}</Text>
                                        ) : (
                                            <Text style={s.rowNoComment}>No comment</Text>
                                        )}
                                        <Text style={s.rowDate}>{dateStr}</Text>
                                    </View>
                                </View>
                            );
                        })}
                    </View>
                )}

                <View style={{ height: insets.bottom + 32 }} />
            </ScrollView>
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: SURFACE.base },
    center: { justifyContent: 'center', alignItems: 'center' },
    scroll: { paddingHorizontal: 20 },
    headerBlur: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20, ...ghostBorder(0.15) },
    headerInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 12 },
    backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' },
    hero: { alignItems: 'center', paddingVertical: 32 },
    heroRating: { fontSize: 64, fontWeight: '800', color: '#EAF3F6', letterSpacing: -2 },
    starRow: { flexDirection: 'row', gap: 4, marginTop: 8 },
    heroSubtext: { fontSize: 13, color: 'rgba(255,255,255,0.6)', marginTop: 8 },
    emptyWrap: { paddingVertical: 40, alignItems: 'center', ...ghostBorder(0.15), borderRadius: 20, borderStyle: 'dashed', marginBottom: 28 },
    list: { backgroundColor: SURFACE.containerLow, borderRadius: 20, ...ghostBorder(0.15), overflow: 'hidden', marginBottom: 28 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.04)' },
    rowLeft: { flexDirection: 'row', alignItems: 'center', gap: 4, width: 44 },
    rowRating: { fontSize: 18, fontWeight: '800', color: '#E6B450' },
    rowComment: { fontSize: 14, color: '#EAF3F6', lineHeight: 20 },
    rowNoComment: { fontSize: 13, color: 'rgba(255,255,255,0.4)', fontStyle: 'italic' },
    rowDate: { fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 4 },
});
