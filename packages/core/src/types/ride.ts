// Ride types matching the database schema exactly
// Source of truth for the frontend — shared across rider, driver, admin apps.

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
    source?: string;
    source_metadata?: any;
    taxi_stand_id?: string;
    kiosk_id?: string;
    guest_name?: string;
    guest_phone?: string;
    payment_method?: string;
}

export interface FareEstimate {
    distance_meters: number;
    duration_seconds: number;
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
    label: string;
    address: string;
    lat: number;
    lng: number;
    icon?: string;
}
