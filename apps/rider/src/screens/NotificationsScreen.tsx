import React, { useCallback, useEffect, useState } from 'react';
import { View, FlatList, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useNetInfo } from '@react-native-community/netinfo';
import { useAuth } from '../context/AuthContext';
import { supabase } from '@gtaxi/core';
import { Button, EmptyState, GUTTER, Header, Loading, SPACE, Txt, useTheme } from '../ui/kit';
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
    ride:     { icon: 'car-sport',      color: '#8B7CFF' },
    payment:  { icon: 'wallet',         color: '#2FB57C' },
    promo:    { icon: 'pricetag',       color: '#F59E0B' },
    escape:   { icon: 'airplane',       color: '#3FD9E8' },
    grocery:  { icon: 'cart',           color: '#F59E0B' },
    laundry:  { icon: 'shirt',          color: '#3FD9E8' },
    system:   { icon: 'information-circle', color: '#8B7CFF' },
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
                    .then(
                        ({ error: uErr }) => {
                            if (uErr) console.warn('[Notifications] mark-read failed:', uErr.message);
                        },
                        (err: unknown) => console.warn('[Notifications] mark-read network error:', err),
                    );
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

    const m = useTheme();

    const renderItem = ({ item, index }: { item: NotificationRow; index: number }) => {
        const meta = TYPE_META[item.type || 'system'] || { icon: 'notifications', color: '#8B7CFF' };
        return (
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', paddingVertical: SPACE.md, borderBottomWidth: index === items.length - 1 ? 0 : 1, borderBottomColor: m.chipBorder }}>
                <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: `${meta.color}22`, alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name={meta.icon as any} size={19} color={meta.color} />
                </View>
                <View style={{ flex: 1, marginLeft: SPACE.md }}>
                    <Txt variant="bodyStrong" numberOfLines={1}>{item.title}</Txt>
                    {item.body ? <Txt variant="body" tone="dim" numberOfLines={3} style={{ marginTop: 2 }}>{item.body}</Txt> : null}
                    <Txt variant="caption" tone="faint" style={{ marginTop: SPACE.xs }}>{timeAgo(item.created_at)}</Txt>
                </View>
                {!item.is_read && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#8B7CFF', marginTop: 6, marginLeft: SPACE.sm }} />}
            </View>
        );
    };

    const offline = netInfo.isConnected === false && items.length === 0 && !loading;

    return (
        <View style={{ flex: 1, backgroundColor: m.page }}>
            <StatusBar style={m.statusBar} />
            <Header title="Notifications" onBack={() => { Haptics.selectionAsync(); navigation.goBack(); }} />
            {loading ? <Loading /> : offline ? (
                <EmptyState icon="cloud-offline-outline" title="You are offline" body="Reconnect to see your latest updates." />
            ) : errored ? (
                <EmptyState icon="alert-circle-outline" title="Could not load notifications" body="Check your connection and try again."
                    action={<Button title="Try again" variant="secondary" onPress={onRefresh} />} />
            ) : (
                <FlatList
                    data={items}
                    keyExtractor={(item) => item.id}
                    renderItem={renderItem}
                    contentContainerStyle={{ paddingHorizontal: GUTTER, paddingBottom: insets.bottom + SPACE.xxl }}
                    showsVerticalScrollIndicator={false}
                    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={m.accent} colors={['#8B7CFF']} />}
                    ListEmptyComponent={<EmptyState icon="notifications-outline" title="You're all caught up" body="Ride updates, receipts and offers will show up here." />}
                />
            )}
        </View>
    );
}
