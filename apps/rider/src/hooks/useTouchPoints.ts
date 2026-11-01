import { useEffect, useState } from 'react';
import { supabase } from '@gtaxi/core';

export type TouchPoint = { id: string; name: string; lat: number; lng: number };

// G-Touch Points (kiosk_nodes) a rider may see on the map.
//
// Read access proven live 2026-10-25: RLS policy "Kiosk nodes public read
// active" lets any signed-in user SELECT rows whose lifecycle_status is 'live'
// or 'activated', and `authenticated` has the SELECT grant. Riders see only
// those rows; pending/draft nodes stay admin/commander-only.
// Today 0 such rows have a location, so this layer is empty until real points
// are switched on; it never shows placeholder data.
export function useTouchPoints() {
    const [points, setPoints] = useState<TouchPoint[]>([]);
    useEffect(() => {
        let cancelled = false;
        supabase
            .from('kiosk_nodes')
            .select('id, location_name, lat, lng')
            .in('lifecycle_status', ['live', 'activated'])
            .not('lat', 'is', null)
            .not('lng', 'is', null)
            .limit(100)
            .then(({ data, error }: any) => {
                if (cancelled) return;
                if (error) { console.warn('[useTouchPoints]', error.message); return; }
                setPoints((data || [])
                    .filter((n: any) => Number.isFinite(n.lat) && Number.isFinite(n.lng))
                    .map((n: any) => ({ id: n.id, name: n.location_name || 'G-Touch Point', lat: n.lat, lng: n.lng })));
            }, (err: unknown) => console.warn('[useTouchPoints]', err));
        return () => { cancelled = true; };
    }, []);
    return points;
}
