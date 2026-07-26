import { useMemo, useState } from 'react';
import { DriverMap, type DriverLocation } from '../components/DriverMap';
import { Activity, Radio, Search, TrendingUp, TrendingDown, Zap, CheckCircle2 } from 'lucide-react';

const ACTIVE_STATUSES = new Set(['searching', 'waiting_queue', 'scheduled', 'assigned', 'arrived', 'in_progress']);
const COMPLETED_STATUSES = new Set(['completed', 'payment_confirmed', 'closed']);
const CANCELLED_STATUSES = new Set(['cancelled', 'expired']);

const GROUP_COLOR: Record<'active' | 'completed' | 'cancelled' | 'none', string> = {
    active: 'var(--accent)',
    completed: 'var(--green)',
    cancelled: '#F87171',
    none: 'rgba(255,255,255,0.07)',
};

const STATUS_COLOR: Record<string, string> = {
    searching: 'var(--cyan)', waiting_queue: 'var(--cyan)', scheduled: 'var(--cyan)',
    assigned: 'var(--accent)', arrived: 'var(--accent)', in_progress: 'var(--green)',
    completed: 'var(--green)', payment_confirmed: 'var(--green)', closed: 'var(--ink-dim)',
    cancelled: '#F87171', expired: '#F87171',
};

type Tab = 'live' | 'activity' | 'fleet';

export const Dashboard = ({ rides }: { rides: any[] }) => {
    const [tab, setTab] = useState<Tab>('live');
    const [driverCount, setDriverCount] = useState<number | null>(null);
    const [search, setSearch] = useState('');

    const stats = useMemo(() => {
        const total = rides.length;
        const active = rides.filter(r => ACTIVE_STATUSES.has(r.status)).length;
        const completed = rides.filter(r => COMPLETED_STATUSES.has(r.status)).length;
        const cancelled = rides.filter(r => CANCELLED_STATUSES.has(r.status)).length;
        const revenueCents = rides.reduce((sum, r) => sum + (COMPLETED_STATUSES.has(r.status) ? (r.total_fare_cents || 0) : 0), 0);

        const waits = rides.map(r => r.pickup_wait_seconds).filter((v): v is number => typeof v === 'number' && v > 0);
        const avgWaitSec = waits.length ? waits.reduce((a, b) => a + b, 0) / waits.length : null;
        const completionRate = total ? Math.round((completed / total) * 100) : 0;
        const cancelRate = total ? Math.round((cancelled / total) * 100) : 0;

        // Hourly buckets, last 24h — dominant status group per hour drives the
        // segmented timeline color, same idea as Arkline's job/PTO/rest bar.
        const now = Date.now();
        const buckets: { count: number; group: 'active' | 'completed' | 'cancelled' | 'none' }[] =
            Array.from({ length: 24 }, () => ({ count: 0, group: 'none' as const }));
        const bucketGroupCounts: Record<'active' | 'completed' | 'cancelled', number>[] =
            Array.from({ length: 24 }, () => ({ active: 0, completed: 0, cancelled: 0 }));
        for (const r of rides) {
            if (!r.created_at) continue;
            const ageMs = now - new Date(r.created_at).getTime();
            const hourBucket = 23 - Math.floor(ageMs / (60 * 60 * 1000));
            if (hourBucket < 0 || hourBucket >= 24) continue;
            buckets[hourBucket].count++;
            const g = ACTIVE_STATUSES.has(r.status) ? 'active' : COMPLETED_STATUSES.has(r.status) ? 'completed' : CANCELLED_STATUSES.has(r.status) ? 'cancelled' : null;
            if (g) bucketGroupCounts[hourBucket][g]++;
        }
        buckets.forEach((b, i) => {
            const g = bucketGroupCounts[i];
            if (b.count === 0) { b.group = 'none'; return; }
            b.group = (Object.entries(g).sort((a, b2) => b2[1] - a[1])[0][0]) as 'active' | 'completed' | 'cancelled';
        });
        const maxBucket = Math.max(1, ...buckets.map(b => b.count));

        // Busiest pickup zone — first comma-segment of pickup_address, real
        // frequency count across loaded rides. No fabricated location data.
        const zoneCounts = new Map<string, number>();
        for (const r of rides) {
            const zone = r.pickup_address?.split(',')[0]?.trim();
            if (!zone) continue;
            zoneCounts.set(zone, (zoneCounts.get(zone) || 0) + 1);
        }
        const topZone = [...zoneCounts.entries()].sort((a, b) => b[1] - a[1])[0] || null;

        return { total, active, completed, cancelled, revenueCents, avgWaitSec, completionRate, cancelRate, buckets, maxBucket, topZone };
    }, [rides]);

    const money = (cents: number) => `TT$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
    const waitLabel = stats.avgWaitSec === null ? '—' : `${Math.round(stats.avgWaitSec / 60)}m`;
    const spotlight = rides[0] || null;
    const filteredFeed = search.trim()
        ? rides.filter(r => (r.pickup_address || '').toLowerCase().includes(search.trim().toLowerCase()))
        : rides;

    const meterTicks = 20;
    const litTicks = Math.round((stats.completionRate / 100) * meterTicks);

    return (
        <div className="relative rounded-[1.75rem] overflow-hidden border border-white/10 shadow-2xl animate-in fade-in duration-700" style={{ height: 'calc(100vh - 200px)', minHeight: 620 }}>
            <div className="absolute inset-0">
                <DriverMap onLocationsChange={(locs: DriverLocation[]) => setDriverCount(locs.length)} />
            </div>

            {/* TOP OVERLAY BAR */}
            <div className="absolute top-4 left-4 right-4 z-20 flex flex-wrap items-center gap-3">
                <div className="bg-black/60 backdrop-blur-xl border border-white/10 rounded-2xl px-4 py-2.5 flex items-center gap-3">
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--cyan)', boxShadow: '0 0 10px var(--cyan-glow)' }} className="animate-pulse" />
                    <span className="text-[10px] font-black text-white uppercase tracking-widest">Live</span>
                    <div className="w-px h-4 bg-white/15" />
                    <span className="text-[10px] font-bold text-white/50 uppercase tracking-widest">
                        {driverCount === null ? '…' : driverCount} driver{driverCount === 1 ? '' : 's'} nearby
                    </span>
                </div>

                <div className="flex-1 min-w-[160px] max-w-sm bg-black/50 backdrop-blur-xl border border-white/10 rounded-2xl px-4 py-2.5 flex items-center gap-2">
                    <Search size={13} className="text-white/30 shrink-0" />
                    <input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Search rides by pickup…"
                        className="bg-transparent outline-none text-[11px] font-medium text-white placeholder:text-white/25 w-full"
                    />
                </div>
            </div>

            {/* BOTTOM-LEFT: busiest zone */}
            {stats.topZone && (
                <div className="absolute bottom-4 left-4 z-20 bg-black/60 backdrop-blur-xl border border-white/10 rounded-2xl px-5 py-4 max-w-[260px]">
                    <p className="text-[8px] font-black text-white/30 uppercase tracking-widest mb-1">Busiest Pickup Zone</p>
                    <p className="text-sm font-black text-white truncate">{stats.topZone[0]}</p>
                    <p className="text-[10px] font-bold text-white/40 mt-0.5">{stats.topZone[1]} ride{stats.topZone[1] === 1 ? '' : 's'} loaded</p>
                </div>
            )}

            {/* RIGHT SIDEBAR */}
            <div className="absolute top-4 right-4 bottom-4 z-20 w-[92vw] sm:w-[340px] bg-black/65 backdrop-blur-2xl border border-white/10 rounded-[1.5rem] flex flex-col overflow-hidden">
                <div className="p-5 border-b border-white/10">
                    <div className="flex items-center justify-between mb-4">
                        <span className="text-[9px] font-black text-white/40 uppercase tracking-[0.2em]">Live Ops</span>
                        <Radio size={14} style={{ color: 'var(--cyan)' }} />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div className="bg-white/[0.03] border border-white/5 rounded-xl p-3">
                            <p className="text-[8px] font-black text-white/30 uppercase tracking-widest mb-1">Rides Today</p>
                            <p className="text-lg font-black text-white mb-1.5">{stats.total}</p>
                            <div className="flex items-end gap-[2px] h-5">
                                {stats.buckets.map((b, i) => (
                                    <div key={i} style={{ flex: 1, height: `${Math.max(10, (b.count / stats.maxBucket) * 100)}%`, background: b.count > 0 ? 'var(--cyan)' : 'rgba(255,255,255,0.08)', borderRadius: 1 }} />
                                ))}
                            </div>
                        </div>
                        <div className="bg-white/[0.03] border border-white/5 rounded-xl p-3">
                            <p className="text-[8px] font-black text-white/30 uppercase tracking-widest mb-1">Completion</p>
                            <p className="text-lg font-black text-white mb-1.5">{stats.completionRate}%</p>
                            <div className="flex gap-[2px] h-5 items-end">
                                {Array.from({ length: meterTicks }).map((_, i) => (
                                    <div key={i} style={{ flex: 1, height: '100%', background: i < litTicks ? 'var(--green)' : 'rgba(255,255,255,0.08)', borderRadius: 1 }} />
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex px-5 pt-3 gap-1 border-b border-white/10">
                    {(['live', 'activity', 'fleet'] as Tab[]).map(t => (
                        <button
                            key={t}
                            onClick={() => setTab(t)}
                            className="px-3 pb-2.5 text-[10px] font-black uppercase tracking-widest transition-colors"
                            style={{
                                color: tab === t ? 'var(--cyan)' : 'rgba(255,255,255,0.35)',
                                borderBottom: tab === t ? '2px solid var(--cyan)' : '2px solid transparent',
                            }}
                        >
                            {t}
                        </button>
                    ))}
                </div>

                <div className="flex-1 overflow-y-auto p-5">
                    {tab === 'live' && (
                        <>
                            {spotlight ? (
                                <div className="bg-white/[0.03] border border-white/5 rounded-2xl p-4 mb-5">
                                    <div className="flex items-center gap-3 mb-3">
                                        <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'rgba(139,92,246,0.15)' }}>
                                            <Zap size={18} style={{ color: 'var(--accent)' }} />
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-xs font-black text-white truncate">{spotlight.pickup_address?.split(',')[0] || 'Unknown pickup'}</p>
                                            <p className="text-[9px] text-white/30 font-bold uppercase tracking-tighter">Ride #{spotlight.id.slice(0, 6)}</p>
                                        </div>
                                        <span className="ml-auto text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-full shrink-0" style={{ color: STATUS_COLOR[spotlight.status] || 'var(--ink-dim)', background: 'rgba(255,255,255,0.05)' }}>
                                            {spotlight.status}
                                        </span>
                                    </div>
                                    <div className="flex justify-between text-[10px] font-bold text-white/40">
                                        <span>{spotlight.total_fare_cents ? money(spotlight.total_fare_cents) : '—'}</span>
                                        <span>{new Date(spotlight.created_at).toLocaleTimeString()}</span>
                                    </div>
                                </div>
                            ) : (
                                <p className="text-xs text-white/30 font-medium text-center py-6">No rides recorded yet.</p>
                            )}

                            <p className="text-[9px] font-black text-white/30 uppercase tracking-widest mb-2">Activity Timeline · 24h</p>
                            <div className="flex gap-[2px] h-6 mb-1">
                                {stats.buckets.map((b, i) => (
                                    <div key={i} title={`${b.count} ride${b.count === 1 ? '' : 's'}`} style={{ flex: 1, background: GROUP_COLOR[b.group], borderRadius: 2 }} />
                                ))}
                            </div>
                            <div className="flex justify-between text-[8px] font-bold text-white/20 uppercase tracking-widest">
                                <span>24h ago</span><span>now</span>
                            </div>
                        </>
                    )}

                    {tab === 'activity' && (
                        <div className="space-y-2">
                            {filteredFeed.length === 0 && <p className="text-xs text-white/30 font-medium text-center py-6">No matching rides.</p>}
                            {filteredFeed.slice(0, 12).map((ride: any) => (
                                <div key={ride.id} className="flex items-center gap-3 p-3 bg-white/[0.02] border border-white/5 rounded-xl">
                                    <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-white/5">
                                        <Activity size={13} className="text-white/40" />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <p className="text-[11px] font-black text-white truncate">{ride.pickup_address?.split(',')[0] || 'Unknown'}</p>
                                        <p className="text-[9px] font-bold" style={{ color: STATUS_COLOR[ride.status] || 'var(--ink-dim)' }}>{ride.status} · {new Date(ride.created_at).toLocaleTimeString()}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {tab === 'fleet' && (
                        <div className="space-y-4">
                            <FleetRow icon={<TrendingUp size={13} style={{ color: 'var(--green)' }} />} label="Completion Rate" value={`${stats.completionRate}%`} />
                            <FleetRow icon={<TrendingDown size={13} style={{ color: '#F87171' }} />} label="Cancellation Rate" value={`${stats.cancelRate}%`} />
                            <FleetRow icon={<CheckCircle2 size={13} style={{ color: 'var(--green)' }} />} label="Completed" value={String(stats.completed)} />
                            <FleetRow icon={<Zap size={13} style={{ color: 'var(--cyan)' }} />} label="Active Now" value={String(stats.active)} />
                            <FleetRow icon={<Zap size={13} style={{ color: 'var(--accent)' }} />} label="Fleet Revenue" value={money(stats.revenueCents)} />
                            <FleetRow icon={<Zap size={13} style={{ color: 'var(--accent)' }} />} label="Avg. Pickup Wait" value={waitLabel} />
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

const FleetRow = ({ icon, label, value }: any) => (
    <div className="flex justify-between items-center border-b border-white/10 pb-3">
        <span className="text-[10px] font-black text-white/40 uppercase flex items-center gap-2">{icon}{label}</span>
        <span className="text-sm font-black text-white">{value}</span>
    </div>
);
