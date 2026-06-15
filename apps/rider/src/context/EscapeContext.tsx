import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { supabase } from '@gtaxi/core';

// Real-time context for the rider's active G-Escape trip.
// Drives the status-aware ActivePassScreen without prop drilling.
// Realtime subscription on package_reservations + itinerary_legs keeps
// the UI live across all trip phases without manual refresh.

export interface ItineraryLeg {
  id: string;
  leg_sequence: number;
  service_type: 'GROUND_TRANSIT' | 'AVIATION' | 'LODGING';
  status: 'scheduled' | 'driver_en_route' | 'in_transit' | 'completed' | 'delayed' | 'cancelled';
  scheduled_start: string | null;
  scheduled_end: string | null;
  actual_start: string | null;
  actual_end: string | null;
  operator_id: string | null;
  reference_code: string | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
}

export interface EscapeItinerary {
  id: string;
  status: string;
  qr_code_token: string;
  itinerary_legs: ItineraryLeg[];
}

export interface EscapeFlightBlock {
  departure_time: string;
  return_time: string | null;
  status: 'POOLING' | 'CONFIRMED' | 'CANCELLED';
  destination_name: string;
  destination_code: string;
  tipping_point_seats: number;
  allocated_seats: number;
  cancel_deadline: string | null;
  outbound_arrival_time: string | null;
}

export interface ActiveEscape {
  id: string;
  status: string;
  guest_count: number;
  total_price_cents: number;
  hold_expires_at: string | null;
  booking_ref: string | null;
  stripe_payment_intent_id: string | null;
  escape_packages: {
    id: string;
    package_name: string;
    cover_image_url: string | null;
    tagline: string | null;
    max_total_guests: number;
    allocated_guests: number;
    flight_blocks: EscapeFlightBlock;
    lodging_nodes: {
      name: string;
      destination_code: string;
      nights: number;
    };
  } | null;
  master_escape_itineraries: EscapeItinerary | null;
}

interface EscapeContextValue {
  activeTrip: ActiveEscape | null;
  loading: boolean;
  refreshTrip: () => Promise<void>;
}

const EscapeContext = createContext<EscapeContextValue>({
  activeTrip: null,
  loading: true,
  refreshTrip: async () => {},
});

const ACTIVE_STATUSES = [
  'ACTIVE_HOLD', 'CAPTURED', 'CONFIRMED',
  'EN_ROUTE_DEPART', 'ON_ISLAND', 'EN_ROUTE_RETURN',
];

export const EscapeTripProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeTrip, setActiveTrip] = useState<ActiveEscape | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchActiveTrip = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) { setLoading(false); return; }

      const { data } = await supabase
        .from('package_reservations')
        .select(`
          id,
          status,
          guest_count,
          total_price_cents,
          hold_expires_at,
          booking_ref,
          stripe_payment_intent_id,
          escape_packages (
            id,
            package_name,
            cover_image_url,
            tagline,
            max_total_guests,
            allocated_guests,
            flight_blocks (
              departure_time,
              return_time,
              status,
              destination_name,
              destination_code,
              tipping_point_seats,
              allocated_seats,
              cancel_deadline,
              outbound_arrival_time
            ),
            lodging_nodes ( name, destination_code, nights )
          ),
          master_escape_itineraries (
            id,
            status,
            qr_code_token,
            itinerary_legs (
              id,
              leg_sequence,
              service_type,
              status,
              scheduled_start,
              scheduled_end,
              actual_start,
              actual_end,
              operator_id,
              reference_code,
              pickup_lat,
              pickup_lng
            )
          )
        `)
        .eq('rider_id', session.user.id)
        .in('status', ACTIVE_STATUSES)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      // Normalize: master_escape_itineraries comes back as array from PostgREST
      let trip = data as any;
      if (trip?.master_escape_itineraries && Array.isArray(trip.master_escape_itineraries)) {
        trip = { ...trip, master_escape_itineraries: trip.master_escape_itineraries[0] ?? null };
      }
      if (trip?.master_escape_itineraries?.itinerary_legs) {
        const legs = trip.master_escape_itineraries.itinerary_legs;
        trip = {
          ...trip,
          master_escape_itineraries: {
            ...trip.master_escape_itineraries,
            itinerary_legs: [...legs].sort((a: any, b: any) => a.leg_sequence - b.leg_sequence),
          },
        };
      }

      setActiveTrip(trip as ActiveEscape | null);
    } catch (err) {
      console.error('EscapeContext fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchActiveTrip();

    const channel = supabase
      .channel('escape-trip-live')
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'package_reservations',
      }, fetchActiveTrip)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'itinerary_legs',
      }, fetchActiveTrip)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'master_escape_itineraries',
      }, fetchActiveTrip)
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [fetchActiveTrip]);

  return (
    <EscapeContext.Provider value={{ activeTrip, loading, refreshTrip: fetchActiveTrip }}>
      {children}
    </EscapeContext.Provider>
  );
};

export const useEscapeTrip = () => useContext(EscapeContext);
