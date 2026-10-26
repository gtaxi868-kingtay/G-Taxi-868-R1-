import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { PlaneLanding, RefreshCw, Loader2, Search, Check } from 'lucide-react';

// A hotel books its guest's airport pickup by flight number. When live flight
// tracking (FlightAware) is on, the pickup follows the real arrival; when it
// is off, the hotel types the landing time and we say so plainly.
type Flight = { ident: string; origin: string | null; status: string; scheduled_in: string | null; estimated_in: string | null; actual_in: string | null; gate: string | null; cancelled: boolean };
type Pickup = { id: string; status: string; scheduled_for: string | null; total_fare_cents: number | null; payment_method: string; ride_pin: string | null; metadata: Record<string, any>; cancellation_reason?: string | null };

const tt = (iso: string | null | undefined) => iso
    ? new Date(iso).toLocaleString('en-TT', { timeZone: 'America/Port_of_Spain', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
    : '—';
const fmtTTD = (cents: number | null) => cents == null ? '—' : `TT$${(cents / 100).toFixed(2)}`;
const todayTT = () => new Date(Date.now() - 4 * 3_600_000).toISOString().slice(0, 10);

export function pickupLabel(p: Pickup): string {
    if (p.metadata?.flight_problem === 'cancelled') return 'Flight cancelled: call your guest';
    if (p.metadata?.flight_problem === 'diverted') return 'Flight diverted: call your guest';
    if (p.metadata?.flight_problem === 'stale' && p.status === 'scheduled') return 'Flight data out of date: check the arrivals board';
    if (p.status === 'scheduled') return p.metadata?.flight_tracked ? 'Booked · following the flight' : 'Booked · not tracked';
    if (p.status === 'searching') return 'Finding a driver';
    if (['assigned', 'arrived', 'in_progress'].includes(p.status)) return 'Driver on the way';
    if (['completed', 'payment_confirmed', 'closed'].includes(p.status)) return 'Done';
    if (p.status === 'cancelled') return /no-show/i.test(p.cancellation_reason || '') ? 'Guest didn\'t come (driver waited)' : 'Cancelled';
    return p.status;
}

const empty = { guest_name: '', guest_phone: '', flight_number: '', flight_date: todayTT(), airport: 'POS', arrival_time: '', child_seat: false, wheelchair: false, note: '' };
const field = 'w-full mt-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm';
const label = 'text-[10px] font-bold text-white/30 uppercase tracking-widest';

export const MerchantAirport = () => {
    const [form, setForm] = useState(empty);
    const [checking, setChecking] = useState(false);
    const [flight, setFlight] = useState<Flight | null>(null);
    const [tracked, setTracked] = useState<boolean | null>(null);
    const [pickupAt, setPickupAt] = useState<string | null>(null);
    const [booking, setBooking] = useState(false);
    const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
    const [pickups, setPickups] = useState<Pickup[]>([]);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        setLoading(true);
        const { data } = await supabase.functions.invoke('merchant', { body: { action: 'list_airport_pickups' } });
        setPickups(data?.success ? data.pickups : []);
        setLoading(false);
    }, []);
    useEffect(() => { load(); }, [load]);

    const set = (k: keyof typeof empty, v: any) => { setForm((f) => ({ ...f, [k]: v })); if (k === 'flight_number' || k === 'flight_date' || k === 'airport') { setFlight(null); setTracked(null); } };

    const checkFlight = async () => {
        setChecking(true); setNotice(null);
        try {
            const { data, error } = await supabase.functions.invoke('merchant', { body: { action: 'flight_status', flight_number: form.flight_number, flight_date: form.flight_date, airport: form.airport } });
            if (error && !data) throw error;
            setTracked(data?.tracked ?? false);
            setFlight(data?.flight ?? null);
            setPickupAt(data?.pickup_at ?? null);
            if (!data?.success) setNotice({ ok: false, text: data?.error || 'Could not find that flight.' });
            else if (!data.tracked) setNotice({ ok: false, text: data.message });
        } catch {
            setNotice({ ok: false, text: 'No connection. Try again.' });
        } finally { setChecking(false); }
    };

    const book = async () => {
        setBooking(true); setNotice(null);
        try {
            const { data, error } = await supabase.functions.invoke('merchant', { body: { action: 'book_airport_pickup', ...form } });
            if (error && !data) throw error;
            if (!data?.success) { setNotice({ ok: false, text: data?.error || 'Could not book the pickup.' }); return; }
            setNotice({ ok: true, text: `${data.message} PIN ${data.ride_pin}. Fare about ${fmtTTD(data.fare_cents)}${data.billed_monthly ? ', on your monthly invoice' : ', paid to the driver'}.` });
            setForm({ ...empty, flight_date: form.flight_date, airport: form.airport });
            setFlight(null); setTracked(null);
            load();
        } catch {
            setNotice({ ok: false, text: 'No connection. The pickup was not booked.' });
        } finally { setBooking(false); }
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-xl font-black text-white">Airport pickups</h2>
                    <p className="text-xs text-white/40 mt-1">Book your guest's ride from Piarco or Tobago. The driver waits with a name sign and follows the flight.</p>
                </div>
                <button onClick={load} className="h-10 px-4 rounded-xl bg-white/5 border border-white/10 text-white/50 text-xs font-bold flex items-center gap-2"><RefreshCw size={14} /> Refresh</button>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div><label htmlFor="ap-name" className={label}>Guest name (for the sign)</label><input id="ap-name" className={field} value={form.guest_name} onChange={(e) => set('guest_name', e.target.value)} /></div>
                    <div><label htmlFor="ap-phone" className={label}>Guest phone / WhatsApp</label><input id="ap-phone" className={field} inputMode="tel" placeholder="+1 868 ..." value={form.guest_phone} onChange={(e) => set('guest_phone', e.target.value)} /></div>
                    <div><label htmlFor="ap-flight" className={label}>Flight number</label><input id="ap-flight" className={field} placeholder="e.g. BW484" value={form.flight_number} onChange={(e) => set('flight_number', e.target.value)} /></div>
                    <div className="grid grid-cols-2 gap-3">
                        <div><label htmlFor="ap-date" className={label}>Arrival date</label><input id="ap-date" type="date" className={field} value={form.flight_date} onChange={(e) => set('flight_date', e.target.value)} /></div>
                        <div><label htmlFor="ap-airport" className={label}>Airport</label>
                            <select id="ap-airport" className={field} value={form.airport} onChange={(e) => set('airport', e.target.value)}>
                                <option value="POS">Piarco (POS)</option><option value="TAB">Tobago (TAB)</option>
                            </select></div>
                    </div>
                </div>

                <button onClick={checkFlight} disabled={checking || !form.flight_number}
                    className="h-10 px-4 rounded-xl bg-white/10 text-white text-xs font-bold flex items-center gap-2 disabled:opacity-40">
                    {checking ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />} Check flight
                </button>

                {flight && (
                    <div className="rounded-xl bg-emerald-500/5 border border-emerald-500/20 p-4 text-sm text-white/80">
                        <p className="font-bold text-white">{flight.ident}{flight.origin ? ` from ${flight.origin}` : ''} · {flight.status}</p>
                        <p className="mt-1">Lands {tt(flight.actual_in || flight.estimated_in || flight.scheduled_in)}{flight.gate ? ` · gate ${flight.gate}` : ''}</p>
                        <p className="mt-1 text-emerald-300">Driver meets your guest around {tt(pickupAt)}, and moves with the flight.</p>
                    </div>
                )}
                {tracked === false && (
                    <div><label htmlFor="ap-time" className={label}>Landing time (Trinidad time)</label><input id="ap-time" type="time" className={field} value={form.arrival_time} onChange={(e) => set('arrival_time', e.target.value)} /></div>
                )}

                <div className="flex flex-wrap gap-5 text-sm text-white/70">
                    <label className="flex items-center gap-2"><input type="checkbox" checked={form.child_seat} onChange={(e) => set('child_seat', e.target.checked)} /> Child seat</label>
                    <label className="flex items-center gap-2"><input type="checkbox" checked={form.wheelchair} onChange={(e) => set('wheelchair', e.target.checked)} /> Wheelchair access</label>
                </div>
                <div><label htmlFor="ap-note" className={label}>Note for the driver (optional)</label><input id="ap-note" className={field} maxLength={200} value={form.note} onChange={(e) => set('note', e.target.value)} /></div>

                <button onClick={book} disabled={booking || !form.guest_name || !form.guest_phone || !form.flight_number || (tracked === false && !form.arrival_time)}
                    className="w-full h-12 rounded-xl bg-[#0D9488] text-black font-bold text-sm disabled:opacity-40 flex items-center justify-center gap-2">
                    {booking ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Book pickup
                </button>
                {notice && <p role="status" className={`text-xs ${notice.ok ? 'text-emerald-400' : 'text-amber-300'}`}>{notice.text}</p>}
            </div>

            {loading ? (
                <div className="py-16 text-center"><Loader2 className="animate-spin mx-auto text-white/30" size={24} /></div>
            ) : pickups.length === 0 ? (
                <div className="py-16 text-center bg-white/[0.02] rounded-3xl border border-dashed border-white/10">
                    <PlaneLanding size={36} className="mx-auto mb-3 text-white/20" />
                    <p className="text-white/50 text-sm">No airport pickups yet</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {pickups.map((p) => (
                        <div key={p.id} className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 flex justify-between items-start gap-4">
                            <div>
                                <p className="text-white font-bold text-sm">{p.metadata?.client_name} · {p.metadata?.flight_number} ({p.metadata?.airport})</p>
                                <p className="text-[11px] text-white/40 mt-1">Pickup {tt(p.scheduled_for)}{p.metadata?.flight_eta ? ` · lands ${tt(p.metadata.flight_eta)}` : ''} · PIN {p.ride_pin}</p>
                            </div>
                            <span className="text-[10px] font-black uppercase tracking-wider text-white/60 text-right">{pickupLabel(p)}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};
