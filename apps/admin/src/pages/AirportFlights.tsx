import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { RefreshCw, Loader2, PlaneLanding } from 'lucide-react';

// Tracked flights and what happened to each airport pickup: did the pickup
// follow the flight, was the data fresh, did the guest come.
type PickupRide = {
    id: string; status: string; scheduled_for: string | null; created_at: string; cancellation_reason: string | null;
    total_fare_cents: number | null; payment_method: string; metadata: Record<string, any>;
};
type Flight = { flight_number: string; flight_date: string; origin: string | null; destination: string | null; status: string | null; scheduled_in: string | null; estimated_in: string | null; actual_in: string | null; cancelled: boolean; diverted: boolean; fetched_at: string | null };

const tt = (iso: string | null | undefined) => iso
    ? new Date(iso).toLocaleString('en-TT', { timeZone: 'America/Port_of_Spain', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—';
const fmt = (c: number | null) => (c == null ? '—' : `TT$${(c / 100).toFixed(2)}`);

// One outcome word per pickup, worst news first.
export function pickupOutcome(r: Pick<PickupRide, 'status' | 'metadata' | 'cancellation_reason'>): string {
    const m = r.metadata || {};
    if (r.status === 'cancelled') return /no-show/i.test(r.cancellation_reason || '') ? 'Guest no-show' : 'Cancelled';
    if (m.flight_problem === 'cancelled') return 'Flight cancelled: hotel must act';
    if (m.flight_problem === 'diverted') return 'Flight diverted: hotel must act';
    if (m.flight_problem === 'stale') return 'Flight data stale';
    if (['completed', 'payment_confirmed', 'closed'].includes(r.status)) return 'Completed';
    if (['searching', 'assigned', 'arrived', 'in_progress'].includes(r.status)) return 'In progress';
    if (r.status === 'scheduled') return m.flight_tracked ? (m.pickup_moved_from ? 'Booked · moved with flight' : 'Booked · tracking') : 'Booked · not tracked';
    return r.status;
}

export function AirportFlights() {
    const [rides, setRides] = useState<PickupRide[]>([]);
    const [flights, setFlights] = useState<Flight[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true); setError(null);
        const [r, f] = await Promise.all([
            supabase.from('rides').select('id, status, scheduled_for, created_at, cancellation_reason, total_fare_cents, payment_method, metadata')
                .eq('metadata->>is_airport_pickup', 'true').order('created_at', { ascending: false }).limit(100),
            supabase.from('airline_flights').select('flight_number, flight_date, origin, destination, status, scheduled_in, estimated_in, actual_in, cancelled, diverted, fetched_at')
                .order('flight_date', { ascending: false }).limit(100),
        ]);
        if (r.error || f.error) setError('Could not load airport pickups. Refresh to try again.');
        setRides((r.data as PickupRide[]) || []);
        setFlights((f.data as Flight[]) || []);
        setLoading(false);
    }, []);
    useEffect(() => { load(); }, [load]);

    return (
        <div className="space-y-8">
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-xl font-black text-white">Airport pickups &amp; tracked flights</h2>
                    <p className="text-xs text-white/40 mt-1">Hotel-booked pickups at Piarco and Tobago. Flights refresh every 10 minutes near pickup time, hourly before that, and stop once landed.</p>
                </div>
                <button onClick={load} className="h-10 px-4 rounded-xl bg-white/5 border border-white/10 text-white/50 text-xs font-bold flex items-center gap-2"><RefreshCw size={14} /> Refresh</button>
            </div>
            {loading ? <div className="py-16 text-center"><Loader2 className="animate-spin mx-auto text-white/30" size={24} /></div>
            : error ? <p className="text-sm text-red-400">{error}</p> : (
                <>
                    <div>
                        <h3 className="text-sm font-black text-white flex items-center gap-2 mb-2"><PlaneLanding size={16} /> Pickups</h3>
                        {rides.length === 0 ? <p className="text-xs text-white/40">No airport pickups booked yet.</p> : (
                            <ul className="divide-y divide-white/5">
                                {rides.map((r) => (
                                    <li key={r.id} className="py-2 flex justify-between gap-4 text-xs text-white/70">
                                        <span>
                                            <span className="text-white">{r.metadata?.merchant_name ?? 'Hotel'}</span> · {r.metadata?.client_name} · {r.metadata?.flight_number} ({r.metadata?.airport})
                                            · pickup {tt(r.scheduled_for)}{r.metadata?.pickup_moved_from ? ` (was ${tt(r.metadata.pickup_moved_from)})` : ''}
                                            {r.metadata?.flight_checked_at ? ` · checked ${tt(r.metadata.flight_checked_at)}` : ''} · {fmt(r.total_fare_cents)}
                                            {r.metadata?.child_seat ? ' · child seat' : ''}{r.metadata?.wheelchair ? ' · wheelchair' : ''}
                                        </span>
                                        <span className="text-white/60 shrink-0 text-right">{pickupOutcome(r)}</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                    <div>
                        <h3 className="text-sm font-black text-white mb-2">Tracked flights (FlightAware cache)</h3>
                        {flights.length === 0 ? <p className="text-xs text-white/40">No flights tracked yet. Live tracking starts once the FlightAware key is set.</p> : (
                            <ul className="divide-y divide-white/5">
                                {flights.map((f) => (
                                    <li key={`${f.flight_number}-${f.flight_date}`} className="py-2 flex justify-between gap-4 text-xs text-white/70">
                                        <span><span className="text-white">{f.flight_number}</span> {f.origin}→{f.destination} · {f.status}{f.cancelled ? ' · CANCELLED' : ''}{f.diverted ? ' · DIVERTED' : ''}</span>
                                        <span className="text-white/50 shrink-0">lands {tt(f.actual_in || f.estimated_in || f.scheduled_in)} · fetched {tt(f.fetched_at)}</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}
