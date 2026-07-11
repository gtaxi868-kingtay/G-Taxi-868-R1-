import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { Inbox, Check, X, RefreshCw, DollarSign, Users, Megaphone, SlidersHorizontal, CircleDot, Clock } from 'lucide-react';

// G's approval inbox — every proposal the AI staff files lands here.
// Approve → g_decide_action RPC flips status → g_execute_action (edge fn /
// 5-min sweep) carries it out with reviewed code.

interface Proposal {
    id: string;
    department: string;
    action_type: string;
    title: string;
    reasoning: string;
    payload: Record<string, unknown>;
    category: 'money' | 'people' | 'public' | 'config' | 'other';
    amount_cents: number | null;
    status: string;
    created_at: string;
    expires_at: string;
    execution_result: Record<string, unknown> | null;
}

const C = {
    text:    '#F1F5F9',
    muted:   'rgba(255,255,255,0.4)',
    body:    'rgba(255,255,255,0.8)',
    surface: 'rgba(255,255,255,0.05)',
    accent:  '#A78BFA',
    green:   '#10B981',
    red:     '#EF4444',
};

const CATEGORY_META: Record<Proposal['category'], { label: string; color: string; icon: React.ReactNode }> = {
    money:  { label: 'Money',  color: '#F59E0B', icon: <DollarSign size={13} /> },
    people: { label: 'People', color: '#3B82F6', icon: <Users size={13} /> },
    public: { label: 'Public', color: '#EC4899', icon: <Megaphone size={13} /> },
    config: { label: 'Config', color: '#8B5CF6', icon: <SlidersHorizontal size={13} /> },
    other:  { label: 'Other',  color: '#6B7280', icon: <CircleDot size={13} /> },
};

function ttd(cents: number | null): string | null {
    if (cents == null) return null;
    return `TTD $${(cents / 100).toFixed(2)}`;
}

export function Approvals() {
    const [pending, setPending] = useState<Proposal[]>([]);
    const [recent, setRecent] = useState<Proposal[]>([]);
    const [loading, setLoading] = useState(true);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [expanded, setExpanded] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        const [p, r] = await Promise.all([
            supabase.from('g_proposed_actions').select('*')
                .eq('status', 'pending').order('created_at', { ascending: false }).limit(50),
            supabase.from('g_proposed_actions').select('*')
                .neq('status', 'pending').order('decided_at', { ascending: false, nullsFirst: false }).limit(20),
        ]);
        if (p.error) setError(p.error.message);
        setPending((p.data as Proposal[]) ?? []);
        setRecent((r.data as Proposal[]) ?? []);
        setLoading(false);
    }, []);

    useEffect(() => { load(); }, [load]);

    const decide = async (id: string, decision: 'approved' | 'rejected') => {
        setBusyId(id);
        setError(null);
        try {
            const { error: rpcErr } = await supabase.rpc('g_decide_action', { p_id: id, p_decision: decision });
            if (rpcErr) throw rpcErr;
            if (decision === 'approved') {
                // Fire the executor immediately; the 5-min sweep is the fallback.
                supabase.functions.invoke('g_execute_action', { body: { proposal_id: id } })
                    .then(null, () => null);
            }
            await load();
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setBusyId(null);
        }
    };

    const grouped = pending.reduce<Record<string, Proposal[]>>((acc, p) => {
        (acc[p.category] ??= []).push(p);
        return acc;
    }, {});

    return (
        <div className="space-y-8">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <Inbox size={20} style={{ color: C.accent }} />
                    <span className="text-sm font-bold" style={{ color: C.text }}>
                        {pending.length} awaiting your decision
                    </span>
                </div>
                <button onClick={load} className="glass-btn glass-btn-ghost h-9 px-4 flex items-center gap-2">
                    <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
                </button>
            </div>

            {error && (
                <div className="error-banner"><span>{error}</span></div>
            )}

            {!loading && pending.length === 0 && (
                <div className="glass-card p-10 text-center">
                    <p className="text-sm font-bold" style={{ color: C.body }}>Inbox zero — G has nothing waiting on you.</p>
                    <p className="text-xs mt-2" style={{ color: C.muted }}>Departments run each morning; proposals appear here and push to your phone.</p>
                </div>
            )}

            {(Object.keys(CATEGORY_META) as Proposal['category'][]).map((cat) => {
                const items = grouped[cat];
                if (!items?.length) return null;
                const meta = CATEGORY_META[cat];
                return (
                    <section key={cat}>
                        <div className="flex items-center gap-2 mb-3">
                            <span style={{ color: meta.color }}>{meta.icon}</span>
                            <h3 className="text-[11px] font-black uppercase tracking-widest" style={{ color: meta.color }}>
                                {meta.label} · {items.length}
                            </h3>
                        </div>
                        <div className="space-y-3">
                            {items.map((p) => (
                                <div key={p.id} className="glass-card p-5">
                                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full"
                                                    style={{ background: C.surface, color: C.muted }}>
                                                    {p.department}
                                                </span>
                                                <span className="text-[10px] font-bold" style={{ color: C.muted }}>{p.action_type}</span>
                                                {p.amount_cents != null && (
                                                    <span className="text-[11px] font-black" style={{ color: CATEGORY_META.money.color }}>
                                                        {ttd(p.amount_cents)}
                                                    </span>
                                                )}
                                            </div>
                                            <p className="text-sm font-bold mt-2" style={{ color: C.text }}>{p.title}</p>
                                            <p className="text-xs mt-1 leading-relaxed" style={{ color: C.body }}>{p.reasoning}</p>
                                            <button
                                                onClick={() => setExpanded(expanded === p.id ? null : p.id)}
                                                className="text-[10px] font-bold uppercase tracking-widest mt-2"
                                                style={{ color: C.accent }}
                                            >
                                                {expanded === p.id ? 'Hide payload' : 'View payload'}
                                            </button>
                                            {expanded === p.id && (
                                                <pre className="text-[10px] mt-2 p-3 rounded-xl overflow-x-auto"
                                                    style={{ background: 'rgba(0,0,0,0.35)', color: C.body }}>
                                                    {JSON.stringify(p.payload, null, 2)}
                                                </pre>
                                            )}
                                            <div className="flex items-center gap-1 mt-2" style={{ color: C.muted }}>
                                                <Clock size={11} />
                                                <span className="text-[10px]">
                                                    filed {new Date(p.created_at).toLocaleString()} · expires {new Date(p.expires_at).toLocaleDateString()}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="flex gap-2 shrink-0">
                                            <button
                                                disabled={busyId === p.id}
                                                onClick={() => decide(p.id, 'approved')}
                                                className="glass-btn h-10 px-4 flex items-center gap-2 font-bold"
                                                style={{ background: 'rgba(16,185,129,0.2)', color: C.green }}
                                            >
                                                <Check size={15} /> Approve
                                            </button>
                                            <button
                                                disabled={busyId === p.id}
                                                onClick={() => decide(p.id, 'rejected')}
                                                className="glass-btn glass-btn-ghost h-10 px-4 flex items-center gap-2 font-bold"
                                                style={{ color: C.red }}
                                            >
                                                <X size={15} /> Reject
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>
                );
            })}

            {recent.length > 0 && (
                <section>
                    <h3 className="text-[11px] font-black uppercase tracking-widest mb-3" style={{ color: C.muted }}>
                        Recently decided
                    </h3>
                    <div className="space-y-2">
                        {recent.map((p) => (
                            <div key={p.id} className="glass-card p-4 flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                    <p className="text-xs font-bold truncate" style={{ color: C.body }}>{p.title}</p>
                                    <p className="text-[10px] mt-0.5" style={{ color: C.muted }}>
                                        {p.department} · {p.action_type}
                                        {p.execution_result?.error ? ` — ${String(p.execution_result.error)}` : ''}
                                        {p.execution_result?.manual ? ' — manual step: post/send it yourself' : ''}
                                    </p>
                                </div>
                                <span className="text-[10px] font-black uppercase tracking-widest shrink-0" style={{
                                    color: p.status === 'executed' ? C.green
                                        : p.status === 'failed' ? C.red
                                        : p.status === 'rejected' ? C.muted
                                        : C.accent,
                                }}>
                                    {p.status}
                                </span>
                            </div>
                        ))}
                    </div>
                </section>
            )}
        </div>
    );
}
