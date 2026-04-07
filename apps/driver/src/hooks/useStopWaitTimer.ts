import { useState, useEffect, useRef } from 'react';
import { supabase } from '../../../../shared/supabase';

/**
 * useStopWaitTimer - The "Truthful Heartbeat" for Multi-Stops.
 * This hook maintains a background-synced wait timer with Supabase.
 * It ensures that even if the app crashes, the wait time is persisted every 10 seconds.
 */
export function useStopWaitTimer(stopId: string | null, isActive: boolean) {
    const [seconds, setSeconds] = useState(0);
    const [feeCents, setFeeCents] = useState(0);
    const intervalRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        if (!stopId || !isActive) {
            if (intervalRef.current) clearInterval(intervalRef.current);
            return;
        }

        // 1. Initial Fetch
        const fetchInitial = async () => {
            const { data } = await supabase
                .from('ride_stops')
                .select('total_wait_seconds, wait_fee_cents')
                .eq('id', stopId)
                .single();
            if (data) {
                setSeconds(data.total_wait_seconds || 0);
                setFeeCents(data.wait_fee_cents || 0);
            }
        };
        fetchInitial();

        // 2. Start Heartbeat (Every 10 seconds)
        // This calls the RPC which performs the math check and persists to DB
        const ping = async () => {
            try {
                await supabase.rpc('increment_stop_wait_time', { p_stop_id: stopId });
            } catch (err) {
                console.warn('[WaitTimer] Heartbeat failed:', err);
            }
        };

        // Ping immediately on start
        ping();
        
        intervalRef.current = setInterval(ping, 10000);

        // 3. Subscribe to Realtime Updates
        // This ensures the UI stays "Truthful" by pulling from the DB source
        const sub = supabase.channel(`stop_wait_${stopId}`)
            .on('postgres_changes', {
                event: 'UPDATE',
                schema: 'public',
                table: 'ride_stops',
                filter: `id=eq.${stopId}`
            }, (payload) => {
                const updated = payload.new;
                setSeconds(updated.total_wait_seconds || 0);
                setFeeCents(updated.wait_fee_cents || 0);
            })
            .subscribe();

        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
            sub.unsubscribe();
        };
    }, [stopId, isActive]);

    return { seconds, feeCents };
}
