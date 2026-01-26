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
 * Format cents to TTD currency string
 */
export function formatCurrency(cents: number): string {
    return `$${(cents / 100).toFixed(2)} TTD`;
}

// Legacy export for AuthContext compatibility
export function setAuthToken(_token: string) {
    // No longer needed - we get fresh token from Supabase each time
}
