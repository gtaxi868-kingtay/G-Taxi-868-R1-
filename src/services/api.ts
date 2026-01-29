// API Service - Uber Standard Pattern
// Token is fetched fresh from Supabase for each authenticated request

import { ENV } from '../config/env';
import { supabase } from './supabase';

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
    distance_km: number;
    duration_min: number;
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
}

interface CreateRideResponse {
    ride_id: string;
    status: string;
    distance_km: number;
    duration_min: number;
    total_fare_cents: number;
    existing_ride?: boolean;
}

interface MatchDriverResponse {
    ride_id: string;
    driver: {
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
}

// Edge Function base URL
const FUNCTIONS_URL = `${ENV.SUPABASE_URL}/functions/v1`;

// Get fresh auth token from Supabase session (Uber pattern)
async function getAuthToken(): Promise<string> {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token || ENV.SUPABASE_ANON_KEY;
}

// Get headers with fresh auth token
async function getAuthHeaders(): Promise<Record<string, string>> {
    const token = await getAuthToken();
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
    };
}

// Get headers with anon key only (for public endpoints)
function getAnonHeaders(): Record<string, string> {
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ENV.SUPABASE_ANON_KEY}`,
    };
}

// Fetch with retry (Uber pattern)
async function fetchWithRetry<T>(
    url: string,
    options: RequestInit,
    maxRetries = 3
): Promise<ApiResponse<T>> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const response = await fetch(url, options);
            const data = await response.json();
            return data as ApiResponse<T>;
        } catch (error) {
            lastError = error as Error;
            console.log('[API] Retry', attempt + 1, lastError.message);
            const delay = Math.pow(2, attempt) * 1000;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    return {
        success: false,
        data: null,
        error: lastError?.message || 'Network request failed',
    };
}

/**
 * Estimate fare (no auth required)
 */
export async function estimateFare(
    params: EstimateFareParams
): Promise<ApiResponse<FareEstimate>> {
    return fetchWithRetry<FareEstimate>(
        `${FUNCTIONS_URL}/estimate_fare`,
        {
            method: 'POST',
            headers: getAnonHeaders(),
            body: JSON.stringify(params),
        }
    );
}

/**
 * Create a ride (requires auth)
 */
export async function createRide(
    params: CreateRideParams
): Promise<ApiResponse<CreateRideResponse>> {
    const headers = await getAuthHeaders();
    return fetchWithRetry<CreateRideResponse>(
        `${FUNCTIONS_URL}/create_ride`,
        {
            method: 'POST',
            headers,
            body: JSON.stringify(params),
        }
    );
}

/**
 * Match a driver to a ride (requires auth)
 */
export async function matchDriver(
    rideId: string
): Promise<ApiResponse<MatchDriverResponse>> {
    const headers = await getAuthHeaders();
    return fetchWithRetry<MatchDriverResponse>(
        `${FUNCTIONS_URL}/match_driver`,
        {
            method: 'POST',
            headers,
            body: JSON.stringify({ ride_id: rideId }),
        }
    );
}

/**
 * Get current active ride (requires auth)
 */
export async function getActiveRide(): Promise<ApiResponse<ActiveRideResponse | null>> {
    const headers = await getAuthHeaders();
    return fetchWithRetry<ActiveRideResponse | null>(
        `${FUNCTIONS_URL}/get_active_ride`,
        {
            method: 'POST',
            headers,
            body: JSON.stringify({}),
        }
    );
}

/**
 * Complete a ride (requires auth)
 */
export async function completeRide(
    rideId: string
): Promise<ApiResponse<{ ride_id: string; status: string; total_fare_cents: number }>> {
    const headers = await getAuthHeaders();
    return fetchWithRetry<{ ride_id: string; status: string; total_fare_cents: number }>(
        `${FUNCTIONS_URL}/complete_ride`,
        {
            method: 'POST',
            headers,
            body: JSON.stringify({ ride_id: rideId }),
        }
    );
}

/**
 * Cancel a ride (requires auth)
 */
export async function cancelRide(
    rideId: string
): Promise<ApiResponse<{ ride_id: string; status: string }>> {
    const headers = await getAuthHeaders();
    return fetchWithRetry<{ ride_id: string; status: string }>(
        `${FUNCTIONS_URL}/cancel_ride`,
        {
            method: 'POST',
            headers,
            body: JSON.stringify({ ride_id: rideId }),
        }
    );
}

/**
 * DEV/DRIVER: Update location
 */
export async function updateDriverLocation(
    driverId: string,
    lat: number,
    lng: number,
    heading: number = 0
): Promise<ApiResponse<void>> {
    // For MVP/Sim, we use anon headers, assuming function is open or we are the rider
    const headers = getAnonHeaders();
    return fetchWithRetry<void>(
        `${FUNCTIONS_URL}/update_driver_location`,
        {
            method: 'POST',
            headers,
            body: JSON.stringify({ driver_id: driverId, lat, lng, heading }),
        }
    );
}

/**
 * DEV/DRIVER: Accept Ride
 */
export async function acceptRide(
    rideId: string,
    driverId: string
): Promise<ApiResponse<any>> {
    const headers = getAnonHeaders();
    return fetchWithRetry<any>(
        `${FUNCTIONS_URL}/accept_ride`,
        {
            method: 'POST',
            headers,
            body: JSON.stringify({ ride_id: rideId, driver_id: driverId }),
        }
    );
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
        .from('drivers')
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

    const { data, error } = await supabase
        .from('saved_places')
        .upsert({
            user_id: user.id,
            ...place
        }, { onConflict: 'user_id, label' }) // Updates existing label if present
        .select()
        .single();

    if (error) {
        console.error('Error saving place:', error);
        return null;
    }
    return data as SavedPlace;
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
