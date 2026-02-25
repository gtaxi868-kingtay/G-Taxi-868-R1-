import { supabase } from '../../../../shared/supabase';
import { ENV } from '../../../../shared/env';
import { fetchWithRetry } from '../../../../shared/retryWrapper';

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

export async function updateLocation(driverId: string, lat: number, lng: number, heading: number) {
    // Fire and forget - use Edge Function or direct insert if allowed
    // Using Edge Function for strict validation/history
    return fetch(`${FUNCTIONS_URL}/update_driver_location`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${ENV.SUPABASE_ANON_KEY}` // Or auth token if we update the function
        },
        body: JSON.stringify({ driver_id: driverId, lat, lng, heading })
    });
}

export async function updateRideStatus(
    rideId: string,
    status: 'arrived' | 'in_progress' | 'completed',
    driverLat?: number,
    driverLng?: number
) {
    if (status === 'completed') {
        return supabase.functions.invoke('complete_ride', {
            body: {
                ride_id: rideId,
                driver_lat: driverLat,
                driver_lng: driverLng
            }
        });
    }

    return supabase.functions.invoke('update_ride_status', {
        body: {
            ride_id: rideId,
            status: status,
            driver_lat: driverLat,
            driver_lng: driverLng
        }
    });
}
