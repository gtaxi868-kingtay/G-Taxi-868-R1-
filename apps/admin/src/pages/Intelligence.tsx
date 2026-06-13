import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { Bot, Zap, RefreshCw, TrendingUp, Package, Truck, AlertCircle } from 'lucide-react';

interface Decision {
    id: string;
    run_id: string;
    decision_type: string;
    reasoning: string;
    tool_used: string | null;
    payload: Record<string, unknown>;
    outcome: string | null;
    created_at: string;
}

interface Hotspot {
    area_hash: string;
    demand_score: number;
    active_drivers: number;
    actual_demand: number;
    hour_of_day: number;
}

interface PackageOpp {
    flight_number: string;
    destination_code: string;
    departure_at: string;
    seats_available: number;
    margin_per_seat: number;
}

const DECISION_META: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
    surge_activated:   { label: 'Surge Activated',   color: '#F59E0B', icon: <Zap size={14} /> },
    surge_deactivated: { label: 'Surge Off',          color: '#6B7280', icon: <Zap size={14} /> },
    order_dispatched:  { label: 'Order Dispatched',   color: '#3B82F6', icon: <Truck size={14} /> },
    package_created:   { label: 'Package Draft',      color: '#10B981', icon: <Package size={14} /> },
    demand_alert:      { label: 'Demand Alert',       color: '#EF4444', icon: <AlertCircle size={14} /> },
    no_action:         { label: 'No Action',          color: '#4B5563', icon: <Bot size={14} /> },
};

const fmt = (iso: string) => new Date(iso).toLocaleString('en-TT', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
});

const fmtTTD = (cents: number) => `$${(cents / 100).toLocaleString('en-TT', { minimumFractionDigits: 0 })} TTD`;

export function Intelligence() {
    const [decisions, setDecisions] = useState<Decision[]>([]);
    const [hotspots, setHotspots] = useState<Hotspot[]>([]);
    const [packages, setPackages] = useState<PackageOpp[]>([]);
    const [loading, setLoading] = useState(true);
    const [triggering, setTriggering] = useState(false);
    const [triggerMsg, setTriggerMsg] = useState('');
    const [tab, setTab] = useState<'log' | 'demand' | 'packages'>('log');

    const load = useCallback(async () => {
        setLoading(true);
        const [dRes, hRes, pRes] = await Promise.all([
            supabase
                .from('agent_decision_log')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(50),
            supabase.rpc('get_demand_hotspots', { p_min_score: 1.0 }),
            supabase.rpc('get_package_opportunities'),
        ]);
        if (dRes.data) setDecisions(dRes.data as Decision[]);
        if (hRes.data) setHotspots(hRes.data as Hotspot[]);
        if (pRes.data) setPackages(pRes.data as PackageOpp[]);
        setLoading(false);
    }, []);

    useEffect(() => { load(); }, [load]);

    const triggerAgent = async () => {
        setTriggering(true);
        setTriggerMsg('');
        try {
            const { data: { session } } = await supabase.auth.getSession();
            const res = await fetch(
                `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/platform_intelligence`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${session?.access_token}`,
                    },
                    body: '{}',
                },
            );
            const json = await res.json();
            if (json.success) {
                setTriggerMsg(`Run complete — ${json.iterations} iteration(s). Run ID: ${json.run_id?.slice(0, 8)}`);
                await load();
            } else {
                setTriggerMsg(`Error: ${json.error}`);
            }
        } catch (e: unknown) {
            setTriggerMsg(`Error: ${e instanceof Error ? e.message : String(e)}`);
        } finally {
            setTriggering(false);
        }
    };

    // Stats
    const todayDecisions = decisions.filter(d => {
        const dt = new Date(d.created_at);
        const now = new Date();
        return dt.getFullYear() === now.getFullYear() &&
            dt.getMonth() === now.getMonth() &&
            dt.getDate() === now.getDate();
    });
    const surgeCount = todayDecisions.filter(d => d.decision_type === 'surge_activated').length;
    const dispatchCount = todayDecisions.filter(d => d.decision_type === 'order_dispatched').length;
    const pkgCount = todayDecisions.filter(d => d.decision_type === 'package_created').length;

    return (
        <div style={{ padding: 32, color: '#FFF', maxWidth: 1100, margin: '0 auto' }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 52, height: 52, borderRadius: 16, background: 'linear-gradient(135deg, rgba(139,92,246,0.3), rgba(59,130,246,0.3))', border: '1px solid rgba(139,92,246,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Bot size={26} color="#A78BFA" />
                    </div>
                    <div>
                        <h2 style={{ margin: 0, fontSize: 24, fontWeight: 800 }}>Platform Intelligence</h2>
                        <p style={{ margin: 0, color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>AI agent decisions · Demand heatmap · Package opportunities</p>
                    </div>
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                    <button
                        onClick={load}
                        style={{ background: 'rgba(255,255,255,0.08)', border: 'none', color: '#FFF', borderRadius: 12, padding: '10px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                    >
                        <RefreshCw size={16} /> Refresh
                    </button>
                    <button
                        onClick={triggerAgent}
                        disabled={triggering}
                        style={{ background: triggering ? 'rgba(139,92,246,0.3)' : 'rgba(139,92,246,0.8)', border: 'none', color: '#FFF', borderRadius: 12, padding: '10px 20px', cursor: triggering ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}
                    >
                        <Bot size={16} />
                        {triggering ? 'Running Agent...' : 'Run Agent Now'}
                    </button>
                </div>
            </div>

            {triggerMsg && (
                <div style={{ background: triggerMsg.startsWith('Error') ? 'rgba(239,68,68,0.15)' : 'rgba(139,92,246,0.15)', borderRadius: 12, padding: '12px 16px', marginBottom: 20, color: triggerMsg.startsWith('Error') ? '#EF4444' : '#A78BFA', fontSize: 14 }}>
                    {triggerMsg}
                </div>
            )}

            {/* Today stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 28 }}>
                {[
                    { label: 'Surges Today', value: surgeCount, color: '#F59E0B', icon: <Zap size={20} color="#F59E0B" /> },
                    { label: 'Dispatches Today', value: dispatchCount, color: '#3B82F6', icon: <Truck size={20} color="#3B82F6" /> },
                    { label: 'Pkg Drafts Today', value: pkgCount, color: '#10B981', icon: <Package size={20} color="#10B981" /> },
                ].map(({ label, value, color, icon }) => (
                    <div key={label} style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 20, padding: 24, borderLeft: `4px solid ${color}` }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>{icon}<span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span></div>
                        <div style={{ fontSize: 36, fontWeight: 800, color }}>{value}</div>
                    </div>
                ))}
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
                {([
                    { key: 'log', label: 'Decision Log' },
                    { key: 'demand', label: `Demand Hotspots (${hotspots.length})` },
                    { key: 'packages', label: `Package Opps (${packages.length})` },
                ] as const).map(({ key, label }) => (
                    <button
                        key={key}
                        onClick={() => setTab(key)}
                        style={{ padding: '10px 20px', borderRadius: 12, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, background: tab === key ? '#A78BFA' : 'rgba(255,255,255,0.08)', color: tab === key ? '#000' : 'rgba(255,255,255,0.6)' }}
                    >
                        {label}
                    </button>
                ))}
            </div>

            {loading ? (
                <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.4)', padding: 40 }}>Loading...</div>
            ) : tab === 'log' ? (
                <>
                    {decisions.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: 60 }}>
                            <Bot size={48} style={{ opacity: 0.2, marginBottom: 16 }} />
                            <p style={{ color: 'rgba(255,255,255,0.3)' }}>No decisions yet. Click "Run Agent Now" to trigger the first run.</p>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                            {decisions.map(d => {
                                const meta = DECISION_META[d.decision_type] ?? { label: d.decision_type, color: '#6B7280', icon: <Bot size={14} /> };
                                return (
                                    <div key={d.id} style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 16, padding: 18, borderLeft: `4px solid ${meta.color}` }}>
                                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
                                            <div style={{ flex: 1 }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                                                    <span style={{ background: meta.color + '22', color: meta.color, borderRadius: 99, padding: '3px 10px', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>
                                                        {meta.icon}{meta.label}
                                                    </span>
                                                    {d.tool_used && <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 11 }}>via {d.tool_used}</span>}
                                                </div>
                                                <p style={{ margin: 0, color: 'rgba(255,255,255,0.8)', fontSize: 14, lineHeight: 1.5 }}>{d.reasoning}</p>
                                                {d.outcome && <p style={{ margin: '6px 0 0', color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>→ {d.outcome}</p>}
                                            </div>
                                            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', whiteSpace: 'nowrap' }}>{fmt(d.created_at)}</div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </>
            ) : tab === 'demand' ? (
                <>
                    <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, marginBottom: 16 }}>
                        Demand hotspots for current hour. Score = demand/supply ratio. &gt;1.4 triggers auto-surge.
                    </p>
                    {hotspots.length === 0 ? (
                        <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.3)', padding: 60 }}>No demand data for this hour yet.</div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                            {hotspots.sort((a, b) => b.demand_score - a.demand_score).map(h => {
                                const isSurge = h.demand_score >= 1.4;
                                const color = isSurge ? '#F59E0B' : '#3B82F6';
                                return (
                                    <div key={h.area_hash} style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 16, padding: 18, display: 'flex', alignItems: 'center', gap: 16, borderLeft: `4px solid ${color}` }}>
                                        <TrendingUp size={20} color={color} />
                                        <div style={{ flex: 1 }}>
                                            <div style={{ fontWeight: 700, fontSize: 15, color: '#FFF' }}>Zone: {h.area_hash}</div>
                                            <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>
                                                {h.actual_demand} requests · {h.active_drivers} drivers · Hour {h.hour_of_day}:00
                                            </div>
                                        </div>
                                        <div style={{ textAlign: 'right' }}>
                                            <div style={{ fontSize: 24, fontWeight: 800, color }}>{h.demand_score.toFixed(2)}×</div>
                                            {isSurge && <div style={{ fontSize: 11, color: '#F59E0B', fontWeight: 700 }}>SURGE THRESHOLD</div>}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </>
            ) : (
                <>
                    <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, marginBottom: 16 }}>
                        Flights with available seats where the AI could auto-create a package draft. Margin must be &gt;TTD $500/seat.
                    </p>
                    {packages.length === 0 ? (
                        <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.3)', padding: 60 }}>No viable package opportunities right now.</div>
                    ) : (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
                            {packages.map(p => (
                                <div key={p.flight_number + p.departure_at} style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 20, padding: 24 }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                                        <span style={{ background: 'rgba(16,185,129,0.15)', color: '#10B981', borderRadius: 99, padding: '3px 10px', fontSize: 12, fontWeight: 700 }}>POS → {p.destination_code}</span>
                                        <span style={{ color: '#10B981', fontWeight: 800, fontSize: 16 }}>{fmtTTD(p.margin_per_seat)}/seat</span>
                                    </div>
                                    <div style={{ fontWeight: 700, fontSize: 17, color: '#FFF' }}>{p.flight_number}</div>
                                    <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, marginTop: 4 }}>
                                        {new Date(p.departure_at).toLocaleDateString('en-TT', { month: 'short', day: 'numeric', year: 'numeric' })}
                                    </div>
                                    <div style={{ marginTop: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>{p.seats_available} seats available</span>
                                        {p.margin_per_seat >= 50000 && (
                                            <span style={{ background: 'rgba(16,185,129,0.15)', color: '#10B981', borderRadius: 8, padding: '4px 10px', fontSize: 11, fontWeight: 700 }}>AI ELIGIBLE</span>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
