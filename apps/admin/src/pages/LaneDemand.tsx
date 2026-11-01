import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { Loader2, Plane, Printer, RefreshCw } from 'lucide-react';

// The airline pitch: real riders who raised their hand for a route, by month.
// Counts only, no names, so this page can be printed and handed over.

export type Lane = {
    origin_code: string; destination_code: string; destination_name: string; travel_month: string;
    riders: number; seats: number; first_ask: string; latest_ask: string;
};

export function monthLabel(d: string) {
    return new Date(`${d.slice(0, 7)}-15T12:00:00Z`).toLocaleDateString('en-TT', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function LaneDemand() {
    const [rows, setRows] = useState<Lane[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true); setError(null);
        const { data, error: err } = await supabase.rpc('admin_lane_demand');
        if (err) setError('Could not load route demand. Refresh to try again.');
        setRows((data as Lane[]) || []);
        setLoading(false);
    }, []);
    useEffect(() => { load(); }, [load]);

    const totalSeats = rows.reduce((n, r) => n + Number(r.seats), 0);

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center print:hidden">
                <div>
                    <h2 className="text-xl font-black text-white">Route demand</h2>
                    <p className="text-xs text-white/40 mt-1">Real riders asking for a route. Print this for an airline.</p>
                </div>
                <div className="flex gap-3">
                    <button onClick={load} className="h-10 px-4 rounded-xl bg-white/5 border border-white/10 text-white/50 text-xs font-bold flex items-center gap-2"><RefreshCw size={14} /> Refresh</button>
                    <button onClick={() => window.print()} disabled={rows.length === 0} className="h-10 px-4 rounded-xl bg-violet-600 text-white text-xs font-black flex items-center gap-2 disabled:opacity-40"><Printer size={14} /> Print for an airline</button>
                </div>
            </div>

            {error && <p role="alert" className="text-sm text-red-400">{error}</p>}

            {loading ? (
                <div className="py-16 text-center"><Loader2 className="animate-spin mx-auto text-white/30" size={28} /></div>
            ) : rows.length === 0 ? (
                <div className="py-16 text-center rounded-3xl border border-dashed border-white/10">
                    <Plane size={36} className="mx-auto mb-3 text-white/20" />
                    <p className="text-white/50 text-sm">No riders have asked for a future route yet.</p>
                </div>
            ) : (
                <>
                    <p className="text-sm text-white/60 print:text-black">{totalSeats} seats requested across {rows.length} route-months. Every number is a real G 868 rider who asked.</p>
                    <div className="rounded-2xl border border-white/10 overflow-hidden print:border-black">
                        <table className="w-full text-sm text-white print:text-black">
                            <thead className="bg-white/5 text-[11px] uppercase tracking-wider text-white/50 print:text-black">
                                <tr><th className="text-left p-3">Route</th><th className="text-left p-3">Month</th><th className="text-right p-3">Riders</th><th className="text-right p-3">Seats wanted</th></tr>
                            </thead>
                            <tbody>
                                {rows.map((r) => (
                                    <tr key={`${r.origin_code}-${r.destination_code}-${r.travel_month}`} className="border-t border-white/10">
                                        <td className="p-3 font-bold">{r.origin_code} to {r.destination_name || r.destination_code}</td>
                                        <td className="p-3">{monthLabel(r.travel_month)}</td>
                                        <td className="p-3 text-right">{r.riders}</td>
                                        <td className="p-3 text-right font-black">{r.seats}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </>
            )}
        </div>
    );
}
