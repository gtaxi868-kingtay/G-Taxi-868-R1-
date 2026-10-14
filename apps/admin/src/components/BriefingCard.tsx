import { useEffect, useState } from 'react';
import { Sparkles, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabase';

// "Today's Briefing" — surfaces the existing g_briefing edge function (plain-
// English digest computed with pure SQL, LLM only narrates numbers already in
// the JSON) on the first screen an admin sees. g_briefing itself was already
// live and correct; it was just never called from apps/admin/src.

interface Brief {
    attention: {
        pending_proposals: unknown[];
        failing_cron_jobs: unknown[];
        open_alerts: unknown[];
        open_support_tickets: number;
        drivers_awaiting_approval: number;
        nodes_awaiting_review: number;
    };
    money: { gross_fares_today_cents: number; platform_take_today_cents: number };
}

export function BriefingCard() {
    const [collapsed, setCollapsed] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [brief, setBrief] = useState<Brief | null>(null);
    const [prose, setProse] = useState<string | null>(null);

    const load = async () => {
        setLoading(true);
        setError(null);
        try {
            const { data, error: fnErr } = await supabase.functions.invoke('g_briefing?prose=true');
            if (fnErr) throw fnErr;
            if (data?.error) throw new Error(data.error);
            setBrief(data.brief);
            setProse(data.prose ?? null);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'G is unreachable right now.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const attentionCount = brief
        ? brief.attention.pending_proposals.length +
          brief.attention.failing_cron_jobs.length +
          brief.attention.open_alerts.length +
          brief.attention.open_support_tickets +
          brief.attention.drivers_awaiting_approval +
          brief.attention.nodes_awaiting_review
        : 0;

    const money = (cents: number) => `TT$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

    return (
        <div className="bg-black/65 backdrop-blur-2xl border border-white/10 rounded-2xl overflow-hidden" style={{ width: '100%', maxWidth: 420 }}>
            <button
                onClick={() => setCollapsed(c => !c)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left"
            >
                <Sparkles size={15} style={{ color: '#A78BFA' }} className="shrink-0" />
                <span className="text-[10px] font-black text-white uppercase tracking-widest">Today's Briefing</span>
                {!loading && attentionCount > 0 && (
                    <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(248,113,113,0.2)', color: '#F87171' }}>
                        {attentionCount} need attention
                    </span>
                )}
                <span className="ml-auto flex items-center gap-2">
                    <RefreshCw
                        size={12}
                        className="text-white/30 hover:text-white/60"
                        onClick={(e) => { e.stopPropagation(); load(); }}
                    />
                    {collapsed ? <ChevronDown size={14} className="text-white/40" /> : <ChevronUp size={14} className="text-white/40" />}
                </span>
            </button>

            {!collapsed && (
                <div className="px-4 pb-4 border-t border-white/10 pt-3">
                    {loading && <p className="text-xs text-white/30 font-medium">Reading the numbers…</p>}
                    {error && <p className="text-xs" style={{ color: '#F87171' }}>{error}</p>}
                    {!loading && !error && brief && (
                        <>
                            {prose ? (
                                <p className="text-[12px] leading-relaxed text-white/75 whitespace-pre-wrap mb-3">{prose}</p>
                            ) : (
                                <p className="text-[11px] text-white/40 mb-3">
                                    G's narration is unavailable right now (budget or provider issue) — raw numbers below.
                                </p>
                            )}
                            <div className="grid grid-cols-2 gap-2 text-[10px] font-bold text-white/50">
                                <span>Gross fares today: <span className="text-white">{money(brief.money.gross_fares_today_cents)}</span></span>
                                <span>Platform take: <span className="text-white">{money(brief.money.platform_take_today_cents)}</span></span>
                                <span>Pending G proposals: <span className="text-white">{brief.attention.pending_proposals.length}</span></span>
                                <span>Drivers awaiting approval: <span className="text-white">{brief.attention.drivers_awaiting_approval}</span></span>
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
