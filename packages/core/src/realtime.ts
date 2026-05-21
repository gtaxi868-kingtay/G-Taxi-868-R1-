import { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';

export type ToggleChangeType = 'vertical_settings' | 'system_feature_flags';
export type ToggleChangeEvent = 'INSERT' | 'UPDATE' | 'DELETE';

export interface ToggleChangePayload {
    table: ToggleChangeType;
    event: ToggleChangeEvent;
    new: Record<string, unknown> | null;
    old: Record<string, unknown> | null;
}

export type OnToggleChangeCallback = (payload: ToggleChangePayload) => void;

/**
 * Subscribes to realtime changes on vertical_settings and system_feature_flags
 * tables. Calls onToggleChange for every INSERT/UPDATE/DELETE event so that
 * web and mobile views stay in sync without polling.
 *
 * Returns an unsubscribe function that removes all channels.
 */
export function subscribeToSystemSettings(
    supabase: SupabaseClient,
    onToggleChange: OnToggleChangeCallback
): () => void {
    const tables: ToggleChangeType[] = ['vertical_settings', 'system_feature_flags'];

    const channels: RealtimeChannel[] = tables.map((table) => {
        return supabase
            .channel(`system-settings-${table}`)
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table },
                (payload: any) => {
                    onToggleChange({
                        table,
                        event: payload.event_type as ToggleChangeEvent,
                        new: payload.new as Record<string, unknown> | null,
                        old: payload.old as Record<string, unknown> | null,
                    });
                }
            )
            .subscribe();
    });

    return () => {
        channels.forEach((ch) => supabase.removeChannel(ch));
    };
}
