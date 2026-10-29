import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
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
    created_at?: string;
    updated_at?: string;
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

    const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    // The server is the source of truth for whether a ride exists. Only a
    // successful answer may set or clear the ride: a FAILED check (signal,
    // server hiccup) is not the same as "no ride" and must never drop a
    // rider mid-trip. Failed checks keep the last known ride and retry a
    // few times with growing gaps.
    const checkActiveRide = async (attempt = 0) => {
        // Only check if we have a valid session (not just user)
        if (!session?.access_token) {
            setActiveRide(null);
            setLoading(false);
            return;
        }

        if (attempt === 0 && retryTimer.current) {
            clearTimeout(retryTimer.current);
            retryTimer.current = null;
        }

        const retryLater = () => {
            if (attempt >= 3) return;
            const delays = [5000, 15000, 30000];
            retryTimer.current = setTimeout(() => {
                retryTimer.current = null;
                checkActiveRide(attempt + 1);
            }, delays[attempt]);
        };

        try {
            console.log('[RideContext] Checking for active ride session...');
            const response = await getActiveRide();
            if (response.success) {
                if (response.data) {
                    console.log('[RideContext] Active ride found:', response.data.ride_id);
                    setActiveRide(response.data);
                } else {
                    console.log('[RideContext] No active ride session found.');
                    setActiveRide(null);
                }
            } else {
                console.error('[RideContext] Active ride check failed:', response.error);
                retryLater();
            }
        } catch (error) {
            console.error('[RideContext] Critical recovery error:', error);
            retryLater();
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => () => {
        if (retryTimer.current) clearTimeout(retryTimer.current);
    }, []);

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
            checkActiveRide();
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
