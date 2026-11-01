import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { Building2, RefreshCw, Loader2, Car, Users, Radio } from 'lucide-react';

// Business console v1, visibility only (Connection Map item 2): the business's
// own record, its touch points, the rides it booked, and the drivers it
// vouched for. Nothing on this page changes anything.
export type Dashboard = {
    success: boolean; error?: string;
    business: { name: string; category: string; address: string | null; has_location: boolean; status: string; is_active: boolean; area: string | null; billing: string; credit_limit_cents: number | null; current_debt_cents: number | null };
    touch_points: { name: string; pickup_spot: string | null; tag_ready: boolean; live: boolean; status: string | null }[];
    rides: { id: string; status: string; at: string; guest: string; to: string | null; from: string | null; fare_cents: number | null; billed_monthly: boolean; airport: boolean; flight: string | null }[];
    ride_counts: { last_30_days: number; completed: number };
    drivers: { first_name: string; verified: boolean; status: string; working_now: boolean; since: string | null }[];
};

const fmt = (c: number | null) => (c == null ? '—' : `TT$${(c / 100).toLocaleString('en-TT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const when = (iso: string) => new Date(iso).toLocaleString('en-TT', { timeZone: 'America/Port_of_Spain', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

export function rideStatus(s: string): string {
    if (s === 'scheduled') return 'Booked';
    if (s === 'searching') return 'Finding a driver';
    if (['assigned', 'arrived'].includes(s)) return 'Driver on the way';
    if (s === 'in_progress') return 'On the road';
    if (['completed', 'payment_confirmed', 'closed'].includes(s)) return 'Done';
    if (s === 'cancelled') return 'Cancelled';
    return s.replace(/_/g, ' ');
}

// What still stands between this business and taking real rides, in order.
export function nextSteps(d: Pick<Dashboard, 'business' | 'touch_points'>): string[] {
    const steps: string[] = [];
    if (d.business.status !== 'active' || !d.business.is_active) steps.push('G868 is reviewing your business. You can set things up, but guests can\'t be booked until it is active.');
    if (!d.business.has_location) steps.push('Your business has no map location yet, so rides can\'t start or end here. Ask G868 to set it.');
    if (d.touch_points.length === 0) steps.push('No G-Touch point yet. Ask G868 for a tap tag for your counter or lobby.');
    else if (d.touch_points.some((t) => !t.tag_ready)) steps.push('Your G-Touch point is set up, but its tag has not been programmed yet.');
    return steps;
}

export const MerchantOverview = () => {
    const [d, setD] = useState<Dashboard | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true); setError(null);
        try {
            const { data, error: err } = await supabase.rpc('merchant_dashboard');
            if (err) throw err;
            if (!data?.success) { setError(data?.error || 'Could not load your business.'); return; }
            setD(data as Dashboard);
        } catch {
            setError(navigator.onLine === false ? 'You are offline. Your business will load when you reconnect.' : 'Could not load your business. Check your connection and try again.');
        } finally { setLoading(false); }
    }, []);
    useEffect(() => { load(); }, [load]);

    if (loading) return <div className="py-24 text-center"><Loader2 className="animate-spin mx-auto text-white/30" size={28} /><p className="text-white/30 text-xs mt-3">Loading your business…</p></div>;
    if (error || !d) return (
        <div className="py-16 text-center bg-white/[0.02] rounded-3xl border border-dashed border-white/10">
            <p className="text-white/60 text-sm">{error}</p>
            <button onClick={load} className="mt-4 h-10 px-5 rounded-xl bg-white/10 text-white text-xs font-bold">Try again</button>
        </div>
    );

    const steps = nextSteps(d);
    return (
        <div className="space-y-6">
            <div className="flex justify-between items-start">
                <div>
                    <h2 className="text-xl font-black text-white flex items-center gap-2"><Building2 size={20} /> {d.business.name}</h2>
                    <p className="text-xs text-white/40 mt-1">{[d.business.category, d.business.area, d.business.address].filter(Boolean).join(' · ')}</p>
                </div>
                <button onClick={load} className="h-10 px-4 rounded-xl bg-white/5 border border-white/10 text-white/50 text-xs font-bold flex items-center gap-2"><RefreshCw size={14} /> Refresh</button>
            </div>

            {steps.length > 0 && (
                <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 space-y-1">
                    {steps.map((s) => <p key={s} className="text-xs text-amber-200">{s}</p>)}
                </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Stat label="Rides, last 30 days" value={String(d.ride_counts.last_30_days)} />
                <Stat label="Rides completed" value={String(d.ride_counts.completed)} />
                <Stat label="Drivers you vouched for" value={String(d.drivers.length)} />
                <Stat label="Billing" value={d.business.billing === 'net-30' ? `Monthly, ${fmt(d.business.current_debt_cents)} owed` : 'Guests pay the driver'} />
            </div>

            <Section icon={<Radio size={16} />} title="Your G-Touch points">
                {d.touch_points.length === 0 ? <Empty text="None yet." /> : d.touch_points.map((t, i) => (
                    <Row key={i} left={`${t.name}${t.pickup_spot ? ` · pickup: ${t.pickup_spot}` : ''}`} right={t.tag_ready && t.live ? 'Live' : t.tag_ready ? 'Tag ready, not live' : 'Tag not programmed'} />
                ))}
            </Section>

            <Section icon={<Car size={16} />} title="Rides you booked">
                {d.rides.length === 0 ? <Empty text="No rides yet. Book one from Airport Pickups or Send a ride." /> : d.rides.map((r) => (
                    <Row key={r.id}
                        left={`${when(r.at)} · ${r.guest}${r.airport && r.flight ? ` · flight ${r.flight}` : ''} → ${r.to ?? ''}`}
                        right={`${rideStatus(r.status)} · ${fmt(r.fare_cents)}${r.billed_monthly ? ' (invoice)' : ''}`} />
                ))}
            </Section>

            <Section icon={<Users size={16} />} title="Drivers you vouched for">
                {d.drivers.length === 0 ? <Empty text="None yet. Share your driver invite code from Earnings." /> : d.drivers.map((v, i) => (
                    <Row key={i} left={`${v.first_name}${v.since ? ` · since ${new Date(v.since).toLocaleDateString('en-TT', { month: 'short', year: 'numeric' })}` : ''}`}
                        right={`${v.status}${v.working_now ? ' · working now' : ''}`} />
                ))}
            </Section>
        </div>
    );
};

const Stat = ({ label, value }: { label: string; value: string }) => (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
        <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest">{label}</p>
        <p className="text-white text-base font-black mt-1">{value}</p>
    </div>
);
const Section = ({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) => (
    <div><h3 className="text-sm font-black text-white flex items-center gap-2 mb-2">{icon} {title}</h3><ul className="divide-y divide-white/5">{children}</ul></div>
);
const Row = ({ left, right }: { left: string; right: string }) => (
    <li className="py-2 flex justify-between gap-4 text-xs text-white/70"><span>{left}</span><span className="text-white/50 shrink-0 text-right">{right}</span></li>
);
const Empty = ({ text }: { text: string }) => <li className="py-2 text-xs text-white/40">{text}</li>;
