import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@gtaxi/core';

export interface GSpotVenue {
    id: string;
    name: string;
    address: string;
    monthly_rent_cents: number;
    membership_price_cents: number;
    drink_subsidy_cap_cents: number;
}

export interface GSpotMembership {
    id: string;
    venue_id: string;
    monthly_price_cents: number;
    drink_subsidy_cap_cents: number;
    drink_subsidy_used_cents: number;
    cycle_start: string;
    status: 'active' | 'paused' | 'cancelled';
    venue: { name: string; address: string } | null;
}

export interface GSpotRedeemCode {
    code: string;
    expires_at: string;
}

// Encapsulates the g_spot edge-function contract (list_venues/get_memberships/
// join/cancel/generate_redeem_code) — screens only ever deal with plain
// state + functions, no Supabase knowledge required.
export function useGSpot() {
    const [venues, setVenues] = useState<GSpotVenue[]>([]);
    const [memberships, setMemberships] = useState<GSpotMembership[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [busy, setBusy] = useState(false);

    const refresh = useCallback(async () => {
        try {
            const [venuesRes, membershipsRes] = await Promise.all([
                supabase.functions.invoke('g_spot', { body: { action: 'list_venues' } }),
                supabase.functions.invoke('g_spot', { body: { action: 'get_memberships' } }),
            ]);
            if (venuesRes.data?.success) setVenues(venuesRes.data.venues || []);
            if (membershipsRes.data?.success) setMemberships(membershipsRes.data.memberships || []);
        } catch (err) {
            console.warn('[useGSpot] refresh failed:', err);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    useEffect(() => { refresh(); }, [refresh]);

    const pullToRefresh = useCallback(() => {
        setRefreshing(true);
        refresh();
    }, [refresh]);

    const join = useCallback(async (venueId: string): Promise<{ success: boolean; error?: string }> => {
        setBusy(true);
        try {
            const { data, error } = await supabase.functions.invoke('g_spot', { body: { action: 'join', venue_id: venueId } });
            if (error || !data?.success) return { success: false, error: data?.error || error?.message || 'Join failed' };
            await refresh();
            return { success: true };
        } catch (err: any) {
            return { success: false, error: err.message || 'Join failed' };
        } finally {
            setBusy(false);
        }
    }, [refresh]);

    const cancel = useCallback(async (membershipId: string): Promise<{ success: boolean; error?: string }> => {
        setBusy(true);
        try {
            const { data, error } = await supabase.functions.invoke('g_spot', { body: { action: 'cancel', membership_id: membershipId } });
            if (error || !data?.success) return { success: false, error: data?.error || error?.message || 'Cancel failed' };
            await refresh();
            return { success: true };
        } catch (err: any) {
            return { success: false, error: err.message || 'Cancel failed' };
        } finally {
            setBusy(false);
        }
    }, [refresh]);

    const generateRedeemCode = useCallback(async (membershipId: string): Promise<{ success: boolean; code?: GSpotRedeemCode; error?: string }> => {
        setBusy(true);
        try {
            const { data, error } = await supabase.functions.invoke('g_spot', { body: { action: 'generate_redeem_code', membership_id: membershipId } });
            if (error || !data?.success) return { success: false, error: data?.error || error?.message || 'Could not generate code' };
            return { success: true, code: data.code };
        } catch (err: any) {
            return { success: false, error: err.message || 'Could not generate code' };
        } finally {
            setBusy(false);
        }
    }, []);

    return {
        venues, memberships, loading, refreshing, busy,
        refresh: pullToRefresh, join, cancel, generateRedeemCode,
    };
}
