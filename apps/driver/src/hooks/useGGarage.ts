import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@gtaxi/core';

export interface VehicleClass {
    key: string;
    label: string;
    description: string | null;
    category: string;
}

export interface GarageEligibility {
    eligible: boolean;
    reason?: string;
    days_with_earnings?: number;
    days_required?: number;
    floor_daily_earnings_cents?: number;
    ceiling_daily_earnings_cents?: number;
    min_daily_contribution_cents?: number;
    max_daily_contribution_cents?: number;
}

export interface GarageRequest {
    id: string;
    vehicle_class_key: string;
    source: 'local_dealer' | 'platform_import';
    requested_daily_contribution_cents: number;
    status: string;
    created_at: string;
    decision_reason: string | null;
}

export type GarageTier = 'entry' | 'proven' | 'elite';

interface GarageStatus {
    tier: GarageTier;
    registrationClass: string;
    eligibility: GarageEligibility | null;
    vehicleClasses: VehicleClass[];
    requests: GarageRequest[];
}

interface SubmitRequestInput {
    vehicleClassKey: string;
    source: 'local_dealer' | 'platform_import';
    requestedDailyContributionCents: number;
    hRegistrationOptIn: boolean;
}

const EMPTY_STATUS: GarageStatus = {
    tier: 'entry',
    registrationClass: 'unverified',
    eligibility: null,
    vehicleClasses: [],
    requests: [],
};

// Encapsulates the entire g_garage edge-function contract (get_status /
// submit_request) so screens only ever deal with plain state + two
// functions — no Supabase/edge-function knowledge required to build or
// restyle the UI on top of this.
export function useGGarage() {
    const [status, setStatus] = useState<GarageStatus>(EMPTY_STATUS);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    const refresh = useCallback(async () => {
        try {
            const { data: result, error } = await supabase.functions.invoke('g_garage', {
                body: { action: 'get_status' },
            });
            if (!error && result?.success) {
                setStatus({
                    tier: result.tier,
                    registrationClass: result.registration_class,
                    eligibility: result.eligibility,
                    vehicleClasses: result.vehicle_classes || [],
                    requests: result.requests || [],
                });
            } else if (error) {
                console.warn('[useGGarage] get_status failed:', error);
            }
        } catch (err) {
            console.warn('[useGGarage] get_status failed:', err);
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

    const submitRequest = useCallback(async (input: SubmitRequestInput): Promise<{ success: boolean; error?: string }> => {
        setSubmitting(true);
        try {
            const { data: result, error } = await supabase.functions.invoke('g_garage', {
                body: {
                    action: 'submit_request',
                    vehicle_class_key: input.vehicleClassKey,
                    source: input.source,
                    requested_daily_contribution_cents: Math.round(input.requestedDailyContributionCents),
                    h_registration_opt_in: input.hRegistrationOptIn,
                },
            });
            if (error || !result?.success) {
                return { success: false, error: result?.error || error?.message || 'Request failed' };
            }
            await refresh();
            return { success: true };
        } catch (err: any) {
            return { success: false, error: err.message || 'Request failed' };
        } finally {
            setSubmitting(false);
        }
    }, [refresh]);

    const openRequest = status.requests.find((r) => ['pending', 'approved', 'active'].includes(r.status)) ?? null;

    return {
        ...status,
        openRequest,
        loading,
        refreshing,
        submitting,
        refresh: pullToRefresh,
        submitRequest,
    };
}
