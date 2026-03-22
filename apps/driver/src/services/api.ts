import { supabase } from '../../../../shared/supabase';
import { ENV } from '../../../../shared/env';
import { fetchWithRetry } from '../../../../shared/retryWrapper';
import { OutboxService } from '../../../../shared/OutboxService';

const FUNCTIONS_URL = `${ENV.SUPABASE_URL}/functions/v1`;

async function getAuthHeaders() {
    const { data: { session } } = await supabase.auth.getSession();
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.access_token}`,
    };
}

export async function acceptRide(rideId: string, driverId: string) {
    // We use the Edge Function for safe assignment
    const { data, error } = await supabase.functions.invoke('accept_ride', {
        body: { ride_id: rideId, driver_id: driverId } // driver_id redundant if auth used, but good for check
    });
    return { data, error };
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

export async function updateDriverLocation(driverId: string, lat: number, lng: number, heading: number) {
    // Fire and forget — Edge Function validates auth + GPS spoof detection
    const headers = await getAuthHeaders();
    return fetch(`${FUNCTIONS_URL}/update_driver_location`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ lat, lng, heading })
    });
}

export async function updateRideStatus(
    rideId: string,
    status: 'arrived' | 'in_progress' | 'completed',
    driverLat?: number,
    driverLng?: number
) {
    const payload = {
        ride_id: rideId,
        status: status,
        driver_lat: driverLat,
        driver_lng: driverLng
    };

    const functionName = status === 'completed' ? 'complete_ride' : 'update_ride_status';

    // 1. Attempt immediate sync
    const { data, error } = await supabase.functions.invoke(functionName, {
        body: payload
    });

    // 2. If it fails, enqueue in Outbox for background persistence
    if (error) {
        console.warn(`[API] Immediate sync failed for ${status}. Enqueueing in Outbox...`);
        await OutboxService.getInstance().enqueue({
            type: 'FUNCTION_INVOKE',
            name: functionName,
            payload: payload
        });
    }

    return { data, error };
}
