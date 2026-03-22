// API Service - Uber Standard Pattern
// Token is fetched fresh from Supabase for each authenticated request

import { ENV } from '../../../../shared/env';
import { supabase } from '../../../../shared/supabase';

interface ApiResponse<T> {
    success: boolean;
    data: T | null;
    error: string | null;
}

interface EstimateFareParams {
    pickup_lat: number;
    pickup_lng: number;
    dropoff_lat: number;
    dropoff_lng: number;
}

interface FareEstimate {
    distance_meters: number;
    duration_seconds: number;
    total_fare_cents: number;
    route_polyline: string;
}

interface CreateRideParams {
    pickup_lat: number;
    pickup_lng: number;
    pickup_address?: string;
    dropoff_lat: number;
    dropoff_lng: number;
    dropoff_address: string;
    vehicle_type?: 'Standard' | 'XL' | 'Premium';
    payment_method?: 'cash' | 'card' | 'wallet';
    stops?: Array<{
        stop_order: number;
        place_name: string;
        place_address: string;
        lat: number;
        lng: number;
        stop_type: string;
        estimated_wait_minutes: number;
    }>;
}

interface CreateRideResponse {
    ride_id: string;
    status: string;
    distance_km: number;
    duration_min: number;
    total_fare_cents: number;
    vehicle_type?: string;
    payment_method?: string;
    existing_ride?: boolean;
    route_polyline?: string;
    // New: driver info returned when synchronously matched
    driver?: {
        id: string;
        name: string;
        vehicle: string;
        plate: string;
        rating: number;
        location?: { lat: number; lng: number };
    } | null;
}

interface MatchDriverResponse {
    status?: string;
    ride_id: string;
    driver?: {
        id: string;
        name: string;
        vehicle: string;
        plate: string;
        rating: number;
    };
}

interface ActiveRideResponse {
    ride_id: string;
    status: string;
    pickup_lat: number;
    pickup_lng: number;
    pickup_address?: string;
    dropoff_lat: number;
    dropoff_lng: number;
    dropoff_address?: string;
    total_fare_cents: number;
    distance_meters: number;
    duration_seconds: number;
    created_at: string;
    updated_at?: string; // For TTL check
    driver: {
        id: string;
        name: string;
        vehicle: string;
        plate: string;
        rating: number;
        phone_number?: string;
        location?: { lat: number; lng: number };
    } | null;
}

// Edge Function base URL
const FUNCTIONS_URL = `${ENV.SUPABASE_URL}/functions/v1`;

// Get fresh auth token from Supabase session (Uber pattern)
// Returns the user's JWT token, or throws if not authenticated
async function getAuthToken(): Promise<string> {
    const { data: { session }, error } = await supabase.auth.getSession();

    if (error) {
        console.error('[API] Session error:', error.message);
        throw new Error('Authentication error');
    }

    if (!session?.access_token) {
        console.error('[API] No active session - user must log in');
        throw new Error('Not authenticated');
    }

    return session.access_token;
}

// Get headers with fresh auth token
async function getAuthHeaders(): Promise<Record<string, string>> {
    const token = await getAuthToken();
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
    };
}

// ApiResponse is now imported or compatible with shared
import { fetchWithRetry } from '../../../../shared/retryWrapper';

/**
 * Estimate fare (uses auth headers for consistency)
 */
export async function estimateFare(
    params: EstimateFareParams
): Promise<ApiResponse<FareEstimate>> {
    const headers = await getAuthHeaders();
    const response = await fetchWithRetry<{
        estimated_fare_cents: number;
        distance_meters: number;
        duration_seconds: number;
        vehicle_type: string;
        multiplier: number;
    }>(
        `${FUNCTIONS_URL}/estimate_fare`,
        {
            method: 'POST',
            headers,
            body: JSON.stringify(params),
        }
    );

    // Transform Edge Function response to expected format
    if (response.success && response.data) {
        return {
            success: true,
            error: null,
            data: {
                distance_meters: response.data.distance_meters,
                duration_seconds: response.data.duration_seconds,
                total_fare_cents: response.data.estimated_fare_cents,
                route_polyline: '', // Not returned by estimate_fare
            }
        };
    }

    return {
        success: false,
        error: response.error || 'Failed to estimate fare',
        data: null
    };
}

/**
 * Create a ride (requires auth)
 * Uses supabase.functions.invoke() for automatic auth handling
 */
export async function createRide(
    params: CreateRideParams
): Promise<ApiResponse<CreateRideResponse>> {
    try {
        console.log('[createRide] Invoking Edge Function with params:', params);

        const { data, error } = await supabase.functions.invoke('create_ride', {
            body: params,
        });

        console.log('[createRide] Raw response - data:', JSON.stringify(data), 'error:', error);

        if (error) {
            // Try to get more details from the error
            const errorDetails = {
                message: error.message,
                name: error.name,
                context: (error as any).context,
            };
            console.error('[createRide] Edge Function error details:', JSON.stringify(errorDetails));
            return {
                success: false,
                data: null,
                error: error.message || 'Edge Function failed',
            };
        }

        // Check if response contains an error
        if (data && !data.success && data.error) {
            console.error('[createRide] Response error:', data.error);
            return data as ApiResponse<CreateRideResponse>;
        }

        console.log('[createRide] Success:', data);
        return data as ApiResponse<CreateRideResponse>;
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to create ride';
        console.error('[createRide] Exception:', message, error);
        return {
            success: false,
            data: null,
            error: message,
        };
    }
}

/**
 * Match a driver to a ride (requires auth)
 * Uses supabase.functions.invoke() for auto auth handling
 */
export async function matchDriver(
    rideId: string
): Promise<ApiResponse<MatchDriverResponse>> {
    try {
        const { data, error } = await supabase.functions.invoke('match_driver', {
            body: { ride_id: rideId },
        });

        if (error) {
            console.error('[matchDriver] Error:', error.message);
            return { success: false, data: null, error: error.message };
        }

        return data as ApiResponse<MatchDriverResponse>;
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to match driver';
        console.error('[matchDriver] Exception:', message);
        return { success: false, data: null, error: message };
    }
}

/**
 * Get current active ride (requires auth)
 * Uses supabase.functions.invoke() for auto auth handling
 */
export async function getActiveRide(): Promise<ApiResponse<ActiveRideResponse | null>> {
    try {
        const { data, error } = await supabase.functions.invoke('get_active_ride', {
            body: {},
        });

        if (error) {
            console.error('[getActiveRide] Error:', error.message);
            return { success: false, data: null, error: error.message };
        }

        return data as ApiResponse<ActiveRideResponse | null>;
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to get active ride';
        console.error('[getActiveRide] Exception:', message);
        return { success: false, data: null, error: message };
    }
}

/**
 * Complete a ride (requires auth)
 */
export async function completeRide(
    rideId: string
): Promise<ApiResponse<{ ride_id: string; status: string; total_fare_cents: number }>> {
    try {
        const { data, error } = await supabase.functions.invoke('complete_ride', {
            body: { ride_id: rideId },
        });

        if (error) {
            console.error('[completeRide] Error:', error.message);
            return { success: false, data: null, error: error.message };
        }

        return data as ApiResponse<{ ride_id: string; status: string; total_fare_cents: number }>;
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to complete ride';
        console.error('[completeRide] Exception:', message);
        return { success: false, data: null, error: message };
    }
}

/**
 * Cancel a ride (requires auth)
 */
export async function cancelRide(
    rideId: string
): Promise<ApiResponse<{ ride_id: string; status: string }>> {
    try {
        const { data, error } = await supabase.functions.invoke('cancel_ride', {
            body: { ride_id: rideId },
        });

        if (error) {
            console.error('[cancelRide] Error:', error.message);
            return { success: false, data: null, error: error.message };
        }

        return data as ApiResponse<{ ride_id: string; status: string }>;
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to cancel ride';
        console.error('[cancelRide] Exception:', message);
        return { success: false, data: null, error: message };
    }
}

/**
 * Expire a ride offer that a driver ignored
 */
export async function expireOffer(
    offerId: string
): Promise<ApiResponse<{ message: string }>> {
    try {
        const { data, error } = await supabase.functions.invoke('expire_offer', {
            body: { offer_id: offerId },
        });

        if (error) {
            console.error('[expireOffer] Error:', error.message);
            return { success: false, data: null, error: error.message };
        }

        return data as ApiResponse<{ message: string }>;
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to expire';
        console.error('[expireOffer] Exception:', message);
        return { success: false, data: null, error: message };
    }
}

/**
 * Format cents to TTD currency string
 */
export function formatCurrency(cents: number): string {
    return `$${(cents / 100).toFixed(2)} TTD`;
}

/**
 * Get online drivers for map (Ghost Cars)
 * Returns a list of drivers with their locations
 */
import { Driver } from '../types/ride';
export async function getOnlineDrivers(): Promise<Driver[]> {
    const { data, error } = await supabase
        .from('drivers_map_view')
        .select('*')
        .eq('is_online', true);

    if (error) {
        console.error('Error fetching drivers:', error);
        return [];
    }

    return data as Driver[];
}

// Legacy export for AuthContext compatibility
export function setAuthToken(_token: string) {
    // No longer needed - we get fresh token from Supabase each time
}

/**
 * Saved Places API
 */
import { SavedPlace, Location } from '../types/ride';

export async function getSavedPlaces(): Promise<SavedPlace[]> {
    const { data, error } = await supabase
        .from('saved_places')
        .select('*')
        .order('created_at', { ascending: false }); // Show newest first? Or maybe specific order.

    if (error) {
        console.error('Error fetching saved places:', error);
        return [];
    }
    return data as SavedPlace[];
}

export async function savePlace(place: Omit<SavedPlace, 'id' | 'created_at' | 'updated_at'>): Promise<SavedPlace | null> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    try {
        const { data, error } = await supabase
            .from('saved_places')
            .upsert({
                user_id: user.id,
                ...place
            }, { onConflict: 'user_id, label' })
            .select()
            .single();

        if (error) {
            // If icon column missing, retry without it
            if (error.message.includes('icon')) {
                const { icon, ...placeWithoutIcon } = place as any;
                const { data: retryData, error: retryError } = await supabase
                    .from('saved_places')
                    .upsert({
                        user_id: user.id,
                        ...placeWithoutIcon
                    }, { onConflict: 'user_id, label' })
                    .select()
                    .single();

                if (retryError) throw retryError;
                return retryData as SavedPlace;
            }
            throw error;
        }
        return data as SavedPlace;
    } catch (error) {
        console.error('Error saving place:', error);
        return null;
    }
}

export async function deletePlace(id: string): Promise<boolean> {
    const { error } = await supabase
        .from('saved_places')
        .delete()
        .eq('id', id);

    if (error) {
        console.error('Error deleting place:', error);
        return false;
    }
    return true;
}

/**
 * Recent Rides API
 * Fetches unique recent destinations from ride history
 */
export async function getRecentRides(): Promise<Location[]> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];

    // Fetch last 20 completed rides
    const { data, error } = await supabase
        .from('rides')
        .select('dropoff_lat, dropoff_lng, dropoff_address, created_at')
        .eq('rider_id', user.id)
        .eq('status', 'completed')
        .order('created_at', { ascending: false })
        .limit(20);

    if (error) {
        console.error('Error fetching recent rides:', error);
        return [];
    }

    // Dedup by address
    const uniqueDestinations: Location[] = [];
    const seenAddresses = new Set<string>();

    data?.forEach((ride: any) => {
        if (ride.dropoff_address && !seenAddresses.has(ride.dropoff_address)) {
            seenAddresses.add(ride.dropoff_address);
            uniqueDestinations.push({
                latitude: ride.dropoff_lat,
                longitude: ride.dropoff_lng,
                address: ride.dropoff_address,
            });
        }
    });

    return uniqueDestinations.slice(0, 5); // Return top 5
}

/**
 * Get Ride History (Full List)
 */
export async function getRideHistory() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];

    const { data, error } = await supabase
        .from('rides')
        .select('*')
        .eq('rider_id', user.id)
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Error fetching ride history:', error);
        return [];
    }
    return data;
}

/**
 * Get Wallet Balance
 */
export async function getWalletBalance(): Promise<ApiResponse<number>> {
    try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return { success: false, data: null, error: 'Not authenticated' };

        const { data, error } = await supabase.rpc('get_wallet_balance', {
            p_user_id: user.id
        });

        if (error) {
            console.error('[getWalletBalance] Error:', error.message);
            return { success: false, data: null, error: error.message };
        }

        return { success: true, data: data as number, error: null };
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to get balance';
        console.error('[getWalletBalance] Exception:', message);
        return { success: false, data: null, error: message };
    }
}

/**
 * Process Tip
 */
export async function processTip(rideId: string, amountCents: number): Promise<ApiResponse<boolean>> {
    try {
        const { data, error } = await supabase.rpc('process_tip', {
            p_ride_id: rideId,
            p_amount: amountCents
        });

        if (error) {
            console.error('[processTip] Error:', error.message);
            return { success: false, data: null, error: error.message };
        }

        return { success: true, data: data as boolean, error: null };
    } catch (error) {
        return { success: false, data: null, error: 'Failed to process tip' };
    }
}
