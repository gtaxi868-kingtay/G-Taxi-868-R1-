import { supabase } from '@gtaxi/core';
import { ENV } from '@g868/shared/env';
import { fetchWithRetry } from '@g868/shared/retryWrapper';
import { OutboxService } from '@g868/shared/OutboxService';
import { RideEngine } from '@g868/shared';

const FUNCTIONS_URL = `${ENV.SUPABASE_URL}/functions/v1`;

async function getAuthHeaders() {
    const { data: { session } } = await supabase.auth.getSession();
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.access_token}`,
    };
}

export async function acceptRide(rideId: string, driverId: string) {
    return RideEngine.acceptRide(rideId, () => _acceptRideInternal(rideId, driverId));
}

async function _acceptRideInternal(rideId: string, driverId: string) {
    // We use the Edge Function for safe assignment
    const { data, error } = await supabase.functions.invoke('accept_ride', {
        body: { ride_id: rideId, driver_id: driverId } // driver_id redundant if auth used, but good for check
    });
    if (!error && data?.success !== false) return { data, error: null, statusCode: 200, reason: null };
    // A refusal (4xx/5xx) arrives as a FunctionsHttpError whose body holds the
    // server's own reason. Read it, so the driver sees "offer expired" or
    // "your own ride" instead of a generic message.
    let reason: string | null = data?.error ?? null;
    let statusCode: number | undefined = (error as any)?.context?.status;
    try {
        const body = await (error as any)?.context?.json?.();
        reason = body?.error || body?.message || reason;
    } catch { /* body already read or not JSON */ }
    return { data, error: error ?? new Error(reason || 'Accept failed'), statusCode, reason: reason || (error as any)?.message || null };
}

export async function declineRide(offerId: string) {
    // Phase 7 Backend Authority: Must use Edge Function
    const { data, error } = await supabase.functions.invoke('decline_ride', {
        body: { offer_id: offerId }
    });
    return { data, error };
}

export async function getRide(rideId: string) {
    const { data, error } = await supabase
        .from('rides')
        .select('*')
        .eq('id', rideId)
        .single();
    return { data, error };
}

// Location cost control (Phase 4). The phone has two location sources (the
// background task and the on-screen tracker); both call this, so this is
// the single gate: at most one send every 5 s during a trip and every 20 s
// otherwise. It writes through the driver_location_ping database function
// (same checks the old edge function did: driver only, rate limit, GPS
// spoof rejection, detour alarm) -- database requests don't count against
// the Supabase function-call allowance; the old edge-function call did.
let trackingMode: 'idle' | 'trip' = 'idle';
let lastSentAt = 0;
const modeListeners = new Set<(mode: 'idle' | 'trip') => void>();

export function setLocationTrackingMode(mode: 'idle' | 'trip') {
    if (trackingMode === mode) return;
    trackingMode = mode;
    modeListeners.forEach((fn) => fn(mode));
}

export function getLocationTrackingMode() {
    return trackingMode;
}

// The location tracker re-tunes GPS when a job starts or ends.
export function onLocationTrackingModeChange(fn: (mode: 'idle' | 'trip') => void) {
    modeListeners.add(fn);
    return () => { modeListeners.delete(fn); };
}

export async function updateDriverLocation(
    _driverId: string,
    lat: number,
    lng: number,
    heading: number,
    speed?: number,
) {
    const minGapMs = trackingMode === 'trip' ? 5000 : 20000;
    const now = Date.now();
    if (now - lastSentAt < minGapMs) return null;
    lastSentAt = now;
    const { data, error } = await supabase.rpc('driver_location_ping', {
        p_lat: lat,
        p_lng: lng,
        p_heading: heading || 0,
        p_speed: speed || 0,
    });
    if (error || data?.success === false) {
        console.warn('[location] ping not saved:', error?.message || data?.error);
    }
    return data;
}

interface UpdateRideStatusResponse {
  data: {
    ride_id: string;
    status: string;
    driver_payout_cents?: number;
    total_fare_cents?: number;
  } | null;
  error: any;
}

export async function updateRideStatus(
    rideId: string,
    status: 'arrived' | 'in_progress' | 'completed',
    driverLat?: number,
    driverLng?: number,
    pin?: string
): Promise<UpdateRideStatusResponse> {
    if (status === 'completed') {
        return RideEngine.completeRide(rideId, () => _updateRideStatusInternal(rideId, status, driverLat, driverLng, pin));
    }
    return _updateRideStatusInternal(rideId, status, driverLat, driverLng, pin);
}

async function _updateRideStatusInternal(
    rideId: string,
    status: 'arrived' | 'in_progress' | 'completed',
    driverLat?: number,
    driverLng?: number,
    pin?: string
) {
    const payload = {
        ride_id: rideId,
        status: status,
        driver_lat: driverLat,
        driver_lng: driverLng,
        pin: pin
    };

    const functionName = status === 'completed' ? 'complete_ride' : 'update_ride_status';

    // 1. Attempt immediate sync
    const { data: rawData, error } = await supabase.functions.invoke(functionName, {
        body: payload
    });

    // 2. If the request never reached the server (no signal), enqueue it in
    //    the Outbox to retry later. A refusal from the server (wrong PIN,
    //    trip already cancelled, wrong state) must NOT be replayed later -- it
    //    used to be queued too, so old actions could fire again afterwards.
    const reachedServer = (error as any)?.name === 'FunctionsHttpError';
    if (error && !reachedServer) {
        console.warn(`[API] Immediate sync failed for ${status}. Enqueueing in Outbox...`);
        await OutboxService.getInstance().enqueue({
            type: 'FUNCTION_INVOKE',
            name: functionName,
            payload: payload
        });
    }

    // 3. Map response to guarantee type-safe payload with driver_payout_cents
    const data = rawData?.data ? {
        ride_id: rawData.data.ride_id,
        status: rawData.data.status,
        driver_payout_cents: rawData.data.driver_payout_cents,
        total_fare_cents: rawData.data.total_fare_cents,
    } : null;

    return { data, error };
}
