// Ride types matching the database schema exactly
// These types are the source of truth for the frontend

export type RideStatus =
    | 'requested'
    | 'searching'
    | 'assigned'
    | 'arrived'
    | 'in_progress'
    | 'completed'
    | 'cancelled'
    | 'expired'
    | 'blocked';

export interface Ride {
    id: string;
    rider_id: string;
    pickup_lat: number;
    pickup_lng: number;
    dropoff_lat: number;
    dropoff_lng: number;
    status: RideStatus;
    total_fare_cents: number | null;
    distance_meters: number | null;
    duration_seconds: number | null;
    created_at: string;
}

export interface FareEstimate {
    distance_km: number;
    duration_min: number;
    total_fare_cents: number;
    route_polyline?: string;
}

export interface Location {
    latitude: number;
    longitude: number;
    address?: string;
}

export interface Driver {
    id: string;
    lat: number;
    lng: number;
    heading: number;
    name: string;
    vehicle_model: string;
    plate_number: string;
}

export interface SavedPlace {
    id: string;
    label: string; // 'Home', 'Work', etc.
    address: string;
    lat: number;
    lng: number;
    icon?: string;
}
