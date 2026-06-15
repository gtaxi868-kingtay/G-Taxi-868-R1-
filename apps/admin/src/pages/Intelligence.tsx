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

// Structural color tokens — keeps magic strings in one place
const C = {
    text:        '#F1F5F9',
    muted:       'rgba(255,255,255,0.4)',
    faint:       'rgba(255,255,255,0.3)',
    dimmer:      'rgba(255,255,255,0.25)',
    body:        'rgba(255,255,255,0.8)',
    surface:     'rgba(255,255,255,0.05)',
    surfaceHigh: 'rgba(255,255,255,0.08)',
    accent:      '#A78BFA',
    accentBg:    'rgba(139,92,246,0.3)',
    accentBgOn:  'rgba(139,92,246,0.8)',
    accentFaint: 'rgba(139,92,246,0.15)',
    errorText:   '#EF4444',
    errorBg:     'rgba(239,68,68,0.15)',
    surgeColor:  '#F59E0B',
    dispatchColor: '#3B82F6',
    packageColor:  '#10B981',
};

// Semantic decision type metadata — colors are meaningful status signals, not decoration
const DECISION_META: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
    surge_activated:   { label: 'Surge Activated',   color: C.surgeColor,   icon: <Zap size={14} /> },
    surge_deactivated: { label: 'Surge Off',          color: '#6B7280',       icon: <Zap size={14} /> },
    order_dispatched:  { label: 'Order Dispatched',   color: C.dispatchColor, icon: <Truck size={14} /> },
    package_created:   { label: 'Package Draft',      color: C.packageColor,  icon: <Package size={14} /> },
    demand_alert:      { label: 'Demand Alert',       color: C.errorText,     icon: <AlertCircle size={14} /> },
    no_action:         { label: 'No Action',          color: '#4B5563',       icon: <Bot size={14} /> },
};

const fmt = (iso: string) => new Date(iso).toLocaleString('en-TT', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
});

const fmtTTD = (cents: number) => `$${(cents / 100).toLocaleString('en-TT', { minimumFractionDigits: 0 })} TTD`;

function SkeletonRow() {
    return (
        <div style={{ background: C.surface, borderRadius: 16, padding: 18, display: 'flex', gap: 12, alignItems: 'center' }}>
            <div style={{ width: 80, height: 24, background: C.surfaceHigh, borderRadius: 99, flexShrink: 0 }} className="animate-pulse" />
            <div style={{ flex: 1 }}>
                <div style={{ height: 14, background: C.surfaceHigh, borderRadius: 6, marginBottom: 8, width: '70%' }} className="animate-pulse" />
                <div style={{ height: 12, background: C.surfaceHigh, borderRadius: 6, width: '45%' }} className="animate-pulse" />
            </div>
            <div style={{ width: 60, height: 12, background: C.surfaceHigh, borderRadius: 6, flexShrink: 0 }} className="animate-pulse" />
        </div>
    );
}

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
            const { data, error } = await supabase.functions.invoke('platform_intelligence', { body: {} });
            if (error) {
                setTriggerMsg(`Error: ${error.message}`);
            } else if (data?.success) {
                setTriggerMsg(`Run complete — ${data.iterations} iteration(s). Run ID: ${data.run_id?.slice(0, 8)}`);
                await load();
            } else {
                setTriggerMsg(`Error: ${data?.error || 'Unknown error'}`);
            }
        } catch (e: unknown) {
            setTriggerMsg(`Error: ${e instanceof Error ? e.message : String(e)}`);
        } finally {
            setTriggering(false);
        }
    };

    const todayDecisions = decisions.filter(d => {
        const dt = new Date(d.created_at);
        const now = new Date();
        return dt.getFullYear() === now.getFullYear() &&
            dt.getMonth() === now.getMonth() &&
            dt.getDate() === now.getDate();
    });
    const surgeCount    = todayDecisions.filter(d => d.decision_type === 'surge_activated').length;
    const dispatchCount = todayDecisions.filter(d => d.decision_type === 'order_dispatched').length;
    const pkgCount      = todayDecisions.filter(d => d.decision_type === 'package_created').length;

    return (
        <div style={{ padding: 32, color: C.text, maxWidth: 1100, margin: '0 auto' }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 52, height: 52, borderRadius: 16, background: 'linear-gradient(135deg, rgba(139,92,246,0.3), rgba(59,130,246,0.3))', border: '1px solid rgba(139,92,246,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Bot size={26} color={C.accent} />
                    </div>
                    <div>
                        <h2 style={{ margin: 0, fontSize: 24, fontWeight: 800 }}>Platform Intelligence</h2>
                        <p style={{ margin: 0, color: C.muted, fontSize: 13 }}>AI agent decisions · Demand heatmap · Package opportunities</p>
                    </div>
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                    <button
                        onClick={load}
                        style={{ background: C.surfaceHigh, border: 'none', color: C.text, borderRadius: 12, padding: '10px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                    >
                        <RefreshCw size={16} /> Refresh
                    </button>
                    <button
                        onClick={triggerAgent}
                        disabled={triggering}
                        style={{ background: triggering ? C.accentBg : C.accentBgOn, border: 'none', color: C.text, borderRadius: 12, padding: '10px 20px', cursor: triggering ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}
                    >
                        <Bot size={16} />
                        {triggering ? 'Running agent...' : 'Run agent now'}
                    </button>
                </div>
            </div>

            {triggerMsg && (
                <div style={{ background: triggerMsg.startsWith('Error') ? C.errorBg : C.accentFaint, borderRadius: 12, padding: '12px 16px', marginBottom: 20, color: triggerMsg.startsWith('Error') ? C.errorText : C.accent, fontSize: 14 }}>
                    {triggerMsg}
                </div>
            )}

            {/* Today stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 28 }}>
                {[
                    { label: 'Surges today',    value: surgeCount,    color: C.surgeColor,    icon: <Zap size={20} color={C.surgeColor} /> },
                    { label: 'Dispatches today', value: dispatchCount, color: C.dispatchColor, icon: <Truck size={20} color={C.dispatchColor} /> },
                    { label: 'Package drafts',   value: pkgCount,      color: C.packageColor,  icon: <Package size={20} color={C.packageColor} /> },
                ].map(({ label, value, color, icon }) => (
                    <div key={label} style={{ background: C.surface, borderRadius: 20, padding: 24, borderTop: `3px solid ${color}` }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>{icon}<span style={{ fontSize: 12, color: C.muted }}>{label}</span></div>
                        <div style={{ fontSize: 36, fontWeight: 800, color }}>{value}</div>
                    </div>
                ))}
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
                {([
                    { key: 'log',      label: 'Decision log' },
                    { key: 'demand',   label: `Demand hotspots (${hotspots.length})` },
                    { key: 'packages', label: `Package opportunities (${packages.length})` },
                ] as const).map(({ key, label }) => (
                    <button
                        key={key}
                        onClick={() => setTab(key)}
                        style={{ padding: '10px 20px', borderRadius: 12, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, background: tab === key ? C.accent : C.surfaceHigh, color: tab === key ? '#000' : C.muted }}
                    >
                        {label}
                    </button>
                ))}
            </div>

            {loading ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {[0, 1, 2, 3, 4].map(i => <SkeletonRow key={i} />)}
                </div>
            ) : tab === 'log' ? (
                <>
                    {decisions.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: 60 }}>
                            <Bot size={48} style={{ opacity: 0.2, marginBottom: 16 }} />
                            <p style={{ color: C.faint }}>No decisions yet. Click "Run agent now" to trigger the first run.</p>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                            {decisions.map(d => {
                                const meta = DECISION_META[d.decision_type] ?? { label: d.decision_type, color: '#6B7280', icon: <Bot size={14} /> };
                                return (
                                    <div key={d.id} style={{ background: C.surface, borderRadius: 16, padding: 18 }}>
                                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
                                            <div style={{ flex: 1 }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                                                    <span style={{ background: meta.color + '22', color: meta.color, borderRadius: 99, padding: '3px 10px', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>
                                                        {meta.icon}{meta.label}
                                                    </span>
                                                    {d.tool_used && <span style={{ color: C.dimmer, fontSize: 11 }}>via {d.tool_used}</span>}
                                                </div>
                                                <p style={{ margin: 0, color: C.body, fontSize: 14, lineHeight: 1.5 }}>{d.reasoning}</p>
                                                {d.outcome && <p style={{ margin: '6px 0 0', color: C.muted, fontSize: 12 }}>{d.outcome}</p>}
                                            </div>
                                            <div style={{ fontSize: 11, color: C.dimmer, whiteSpace: 'nowrap' }}>{fmt(d.created_at)}</div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </>
            ) : tab === 'demand' ? (
                <>
                    <p style={{ color: C.muted, fontSize: 13, marginBottom: 16 }}>
                        Demand hotspots for current hour. Score = demand/supply ratio. Above 1.4 triggers auto-surge.
                    </p>
                    {hotspots.length === 0 ? (
                        <div style={{ textAlign: 'center', color: C.faint, padding: 60 }}>No demand data for this hour yet.</div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                            {hotspots.sort((a, b) => b.demand_score - a.demand_score).map(h => {
                                const isSurge = h.demand_score >= 1.4;
                                const color = isSurge ? C.surgeColor : C.dispatchColor;
                                return (
                                    <div key={h.area_hash} style={{ background: C.surface, borderRadius: 16, padding: 18, display: 'flex', alignItems: 'center', gap: 16 }}>
                                        <TrendingUp size={20} color={color} />
                                        <div style={{ flex: 1 }}>
                                            <div style={{ fontWeight: 700, fontSize: 15, color: C.text }}>Zone: {h.area_hash}</div>
                                            <div style={{ color: C.muted, fontSize: 13 }}>
                                                {h.actual_demand} requests · {h.active_drivers} drivers · Hour {h.hour_of_day}:00
                                            </div>
                                        </div>
                                        <div style={{ textAlign: 'right' }}>
                                            <div style={{ fontSize: 24, fontWeight: 800, color }}>{h.demand_score.toFixed(2)}×</div>
                                            {isSurge && <div style={{ fontSize: 11, color: C.surgeColor, fontWeight: 700 }}>Surge threshold</div>}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </>
            ) : (
                <>
                    <p style={{ color: C.muted, fontSize: 13, marginBottom: 16 }}>
                        Flights with available seats where the AI can auto-create a package draft. Margin must be above TTD $500/seat.
                    </p>
                    {packages.length === 0 ? (
                        <div style={{ textAlign: 'center', color: C.faint, padding: 60 }}>No viable package opportunities right now.</div>
                    ) : (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
                            {packages.map(p => (
                                <div key={p.flight_number + p.departure_at} style={{ background: C.surface, borderRadius: 20, padding: 24 }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                                        <span style={{ background: 'rgba(16,185,129,0.15)', color: C.packageColor, borderRadius: 99, padding: '3px 10px', fontSize: 12, fontWeight: 700 }}>POS → {p.destination_code}</span>
                                        <span style={{ color: C.packageColor, fontWeight: 800, fontSize: 16 }}>{fmtTTD(p.margin_per_seat)}/seat</span>
                                    </div>
                                    <div style={{ fontWeight: 700, fontSize: 17, color: C.text }}>{p.flight_number}</div>
                                    <div style={{ color: C.muted, fontSize: 13, marginTop: 4 }}>
                                        {new Date(p.departure_at).toLocaleDateString('en-TT', { month: 'short', day: 'numeric', year: 'numeric' })}
                                    </div>
                                    <div style={{ marginTop: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>{p.seats_available} seats available</span>
                                        {p.margin_per_seat >= 50000 && (
                                            <span style={{ background: 'rgba(16,185,129,0.15)', color: C.packageColor, borderRadius: 8, padding: '4px 10px', fontSize: 11, fontWeight: 700 }}>AI eligible</span>
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
