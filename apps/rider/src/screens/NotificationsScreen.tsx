import React, { useCallback, useEffect, useState } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity,
    FlatList, ActivityIndicator, RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useNetInfo } from '@react-native-community/netinfo';
import { useAuth } from '../context/AuthContext';
import { supabase } from '@gtaxi/core';
import { SURFACE, VOICES } from '@gtaxi/design-system';
import { ghostBorder } from '@gtaxi/design-system/utils/style-rules';
import { AppScreenProps } from '../navigation/types';

interface NotificationRow {
    id: string;
    type: string | null;
    title: string;
    body: string | null;
    is_read: boolean;
    created_at: string;
}

// Maps a notification type to an icon + accent. Falls back to a neutral bell.
const TYPE_META: Record<string, { icon: string; color: string }> = {
    ride:     { icon: 'car-sport',      color: VOICES.rider.accent },
    payment:  { icon: 'wallet',         color: '#10B981' },
    promo:    { icon: 'pricetag',       color: '#F59E0B' },
    escape:   { icon: 'airplane',       color: '#D4AF37' },
    grocery:  { icon: 'cart',           color: '#F59E0B' },
    laundry:  { icon: 'shirt',          color: '#38BDF8' },
    system:   { icon: 'information-circle', color: '#8B5CF6' },
};

function timeAgo(iso: string): string {
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return '';
    const diff = Math.max(0, Date.now() - then);
    const min = Math.floor(diff / 60000);
    if (min < 1) return 'Just now';
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const days = Math.floor(hr / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function NotificationsScreen({ navigation }: AppScreenProps<'Notifications'>) {
    const insets = useSafeAreaInsets();
    const { user } = useAuth();
    const netInfo = useNetInfo();

    const [items, setItems] = useState<NotificationRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [errored, setErrored] = useState(false);

    const fetchNotifications = useCallback(async () => {
        if (!user?.id) {
            setLoading(false);
            return;
        }
        try {
            const { data, error } = await supabase
                .from('notifications')
                .select('id, type, title, body, is_read, created_at')
                .eq('user_id', user.id)
                .order('created_at', { ascending: false })
                .limit(50);

            if (error) {
                // The notifications table may not exist yet (backend follow-up).
                // Treat "missing relation" as an empty inbox, not a hard error.
                const missingTable = /relation .* does not exist|could not find the table/i.test(error.message);
                if (missingTable) {
                    setItems([]);
                    setErrored(false);
                } else {
                    console.warn('[Notifications] fetch failed:', error.message);
                    setErrored(true);
                }
                return;
            }

            setItems((data as NotificationRow[]) || []);
            setErrored(false);

            // Mark unread as read once viewed (best-effort, non-blocking).
            const unreadIds = (data || []).filter((n: any) => !n.is_read).map((n: any) => n.id);
            if (unreadIds.length > 0) {
                supabase
                    .from('notifications')
                    .update({ is_read: true })
                    .in('id', unreadIds)
                    .then(({ error: uErr }) => {
                        if (uErr) console.warn('[Notifications] mark-read failed:', uErr.message);
                    });
            }
        } catch (err: any) {
            console.warn('[Notifications] unexpected error:', err?.message);
            setErrored(true);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [user?.id]);

    useEffect(() => { fetchNotifications(); }, [fetchNotifications]);

    const onRefresh = useCallback(() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        setRefreshing(true);
        fetchNotifications();
    }, [fetchNotifications]);

    const renderItem = ({ item }: { item: NotificationRow }) => {
        const meta = TYPE_META[item.type || 'system'] || { icon: 'notifications', color: VOICES.rider.accent };
        return (
            <View style={[s.row, !item.is_read && s.rowUnread]}>
                <View style={[s.rowIcon, { backgroundColor: `${meta.color}22` }]}>
                    <Ionicons name={meta.icon as any} size={20} color={meta.color} />
                </View>
                <View style={s.rowBody}>
                    <Text style={s.rowTitle} numberOfLines={1}>{item.title}</Text>
                    {item.body ? <Text style={s.rowText} numberOfLines={2}>{item.body}</Text> : null}
                    <Text style={s.rowTime}>{timeAgo(item.created_at)}</Text>
                </View>
                {!item.is_read && <View style={s.unreadDot} />}
            </View>
        );
    };

    const header = (
        <View style={[s.header, { paddingTop: insets.top + 10 }]}>
            <TouchableOpacity
                style={s.backBtn}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); navigation.goBack(); }}
                accessibilityLabel="Go back"
                accessibilityRole="button"
            >
                <Ionicons name="chevron-back" size={24} color="#FFF" />
            </TouchableOpacity>
            <Text style={s.headerTitle}>Notifications</Text>
            <View style={{ width: 44 }} />
        </View>
    );

    // Offline — surface it honestly rather than showing a stale empty inbox.
    if (netInfo.isConnected === false && items.length === 0 && !loading) {
        return (
            <View style={s.root}>
                <StatusBar style="light" />
                {header}
                <View style={s.center}>
                    <View style={s.emptyIconWrap}>
                        <Ionicons name="cloud-offline-outline" size={36} color="rgba(242,245,248,0.4)" />
                    </View>
                    <Text style={s.emptyTitle}>You're offline</Text>
                    <Text style={s.emptySub}>Reconnect to see your latest updates.</Text>
                </View>
            </View>
        );
    }

    if (loading) {
        return (
            <View style={s.root}>
                <StatusBar style="light" />
                {header}
                <View style={s.center}>
                    <ActivityIndicator color={VOICES.rider.accent} size="large" />
                </View>
            </View>
        );
    }

    if (errored) {
        return (
            <View style={s.root}>
                <StatusBar style="light" />
                {header}
                <View style={s.center}>
                    <View style={s.emptyIconWrap}>
                        <Ionicons name="alert-circle-outline" size={36} color="#EF4444" />
                    </View>
                    <Text style={s.emptyTitle}>Couldn't load notifications</Text>
                    <Text style={s.emptySub}>Pull down to try again.</Text>
                    <TouchableOpacity
                        style={s.retryBtn}
                        onPress={onRefresh}
                        accessibilityLabel="Retry loading notifications"
                        accessibilityRole="button"
                    >
                        <Text style={s.retryText}>Retry</Text>
                    </TouchableOpacity>
                </View>
            </View>
        );
    }

    return (
        <View style={s.root}>
            <StatusBar style="light" />
            {header}
            <FlatList
                data={items}
                keyExtractor={(item) => item.id}
                renderItem={renderItem}
                contentContainerStyle={[s.listContent, { paddingBottom: insets.bottom + 24 }]}
                showsVerticalScrollIndicator={false}
                refreshControl={
                    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={VOICES.rider.accent} />
                }
                ListEmptyComponent={
                    <View style={s.center}>
                        <View style={s.emptyIconWrap}>
                            <Ionicons name="notifications-outline" size={36} color={VOICES.rider.accent} />
                        </View>
                        <Text style={s.emptyTitle}>You're all caught up</Text>
                        <Text style={s.emptySub}>Ride updates, receipts and offers will land here.</Text>
                    </View>
                }
            />
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: SURFACE.base },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        paddingBottom: 16,
    },
    backBtn: {
        width: 44, height: 44, borderRadius: 14,
        backgroundColor: 'rgba(255,255,255,0.05)',
        alignItems: 'center', justifyContent: 'center',
        ...ghostBorder(0.1),
    },
    headerTitle: { fontSize: 20, fontWeight: '800', color: '#FFF', fontFamily: 'SpaceGrotesk-Bold' },

    listContent: { paddingHorizontal: 20, paddingTop: 4, gap: 10, flexGrow: 1 },

    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        backgroundColor: SURFACE.containerLow,
        borderRadius: 18,
        padding: 14,
        ...ghostBorder(0.06),
    },
    rowUnread: {
        backgroundColor: SURFACE.containerHigh,
        borderColor: 'rgba(29,224,230,0.18)',
        borderWidth: 1,
    },
    rowIcon: {
        width: 44, height: 44, borderRadius: 14,
        alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
    },
    rowBody: { flex: 1 },
    rowTitle: { fontSize: 15, fontWeight: '700', color: '#F2F5F8', fontFamily: 'Manrope-Bold' },
    rowText: { fontSize: 13, color: 'rgba(242,245,248,0.6)', marginTop: 2, lineHeight: 18, fontFamily: 'Manrope-Regular' },
    rowTime: { fontSize: 11, color: 'rgba(242,245,248,0.4)', marginTop: 6, fontWeight: '600' },
    unreadDot: {
        width: 8, height: 8, borderRadius: 4,
        backgroundColor: VOICES.rider.accent,
        flexShrink: 0,
    },

    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
    emptyIconWrap: {
        width: 72, height: 72, borderRadius: 24,
        backgroundColor: 'rgba(255,255,255,0.04)',
        alignItems: 'center', justifyContent: 'center',
        marginBottom: 16,
        ...ghostBorder(0.08),
    },
    emptyTitle: { fontSize: 18, fontWeight: '800', color: '#F2F5F8', textAlign: 'center', fontFamily: 'SpaceGrotesk-Bold' },
    emptySub: { fontSize: 14, color: 'rgba(242,245,248,0.5)', textAlign: 'center', marginTop: 6, lineHeight: 20, fontFamily: 'Manrope-Regular' },

    retryBtn: {
        marginTop: 20,
        paddingHorizontal: 28, paddingVertical: 14,
        borderRadius: 16,
        backgroundColor: VOICES.rider.accent,
    },
    retryText: { fontSize: 15, fontWeight: '800', color: SURFACE.base },
});
