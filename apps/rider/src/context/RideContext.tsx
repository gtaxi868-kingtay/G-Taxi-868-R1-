import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { getActiveRide } from '../services/api';
import { useAuth } from './AuthContext';

interface ActiveRide {
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
    // Driver Details (Realtime)
    driver_id?: string;
    driver_name?: string;
    driver_vehicle?: string;
    driver_plate?: string;
    driver_rating?: number;
    driver_lat?: number;
    driver_lng?: number;
    estimated_arrival_min?: number;
}

interface RideContextType {
    activeRide: ActiveRide | null;
    loading: boolean;
    checkActiveRide: () => Promise<void>;
    clearActiveRide: () => void;
}

const RideContext = createContext<RideContextType | undefined>(undefined);

export function RideProvider({ children }: { children: ReactNode }) {
    const { user, session, loading: authLoading } = useAuth();
    const [activeRide, setActiveRide] = useState<ActiveRide | null>(null);
    const [loading, setLoading] = useState(true);

    const checkActiveRide = async () => {
        // Only check if we have a valid session (not just user)
        if (!session?.access_token) {
            setActiveRide(null);
            setLoading(false);
            return;
        }

        try {
            const response = await getActiveRide();
            if (response.success && response.data) {
                setActiveRide(response.data);
            } else {
                setActiveRide(null);
            }
        } catch (error) {
            console.log('Error checking active ride:', error);
            setActiveRide(null);
        } finally {
            setLoading(false);
        }
    };

    const clearActiveRide = () => {
        setActiveRide(null);
    };

    // Only check for active ride when auth is fully loaded AND we have a session
    useEffect(() => {
        if (authLoading) {
            // Still loading auth, wait
            return;
        }

        if (session?.access_token) {
            // Small delay to ensure session is fully propagated
            const timer = setTimeout(() => {
                checkActiveRide();
            }, 100);
            return () => clearTimeout(timer);
        } else {
            setActiveRide(null);
            setLoading(false);
        }
    }, [authLoading, session]);

    return (
        <RideContext.Provider value={{ activeRide, loading, checkActiveRide, clearActiveRide }}>
            {children}
        </RideContext.Provider>
    );
}

export function useRide() {
    const context = useContext(RideContext);
    if (context === undefined) {
        throw new Error('useRide must be used within a RideProvider');
    }
    return context;
}
