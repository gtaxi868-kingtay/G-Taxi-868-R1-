import { useEffect, useState, useCallback } from 'react';
import { supabase, adminFetch } from '../lib/supabase';
import { TrendingUp, Lock, Unlock, RefreshCw, Settings, ChevronRight, Bot, Diamond } from 'lucide-react';

interface WaitlistEntry {
    id: string;
    user_id: string;
    created_at: string;
    payload: { level?: number; requested_at?: string };
    profile: { name: string | null; email: string | null } | null;
}

interface RiderRow {
    rider_id: string;
    name: string;
    email: string;
    level: number;
    level_label: string;
    total_rides: number;
    total_grocery_orders: number;
    total_laundry_orders: number;
    wallet_ever_funded: boolean;
    escape_ever_booked: boolean;
    unlocked_verticals: string[];
    next_unlock: { verticals: string[]; progress: number; required: number; label: string } | null;
}

interface ProgressionRule {
    level: number;
    threshold_type: string;
    threshold_value: number;
    unlock_verticals: string[];
    push_title: string;
}

interface AiSuggestion {
    id: string;
    created_at: string;
    decision_type: string;
    reasoning: string;
    payload: Record<string, any>;
    outcome: string;
}

const LEVEL_COLORS: Record<number, string> = {
    1: 'text-white/40',
    2: 'text-blue-400',
    3: 'text-purple-400',
    4: 'text-amber-400',
    5: 'text-emerald-400',
};

const LEVEL_LABELS: Record<number, string> = {
    1: 'New Rider',
    2: 'Regular',
    3: 'Power User',
    4: 'Loyalist',
    5: 'G-Escape',
};

export function Progression() {
    const [riders, setRiders] = useState<RiderRow[]>([]);
    const [rules, setRules] = useState<ProgressionRule[]>([]);
    const [aiSuggestions, setAiSuggestions] = useState<AiSuggestion[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [editingRule, setEditingRule] = useState<ProgressionRule | null>(null);
    const [overrideRiderId, setOverrideRiderId] = useState<string | null>(null);
    const [overrideVertical, setOverrideVertical] = useState('');
    const [overrideLevel, setOverrideLevel] = useState(1);
    const [overrideLoading, setOverrideLoading] = useState(false);
    const [ruleLoading, setRuleLoading] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [waitlist, setWaitlist] = useState<WaitlistEntry[]>([]);

    const fetchAll = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const [ridersRes, rulesRes, aiRes, waitlistRes] = await Promise.all([
                adminFetch('admin', { action: 'get_rider_progression' }),
                supabase.from('progression_config').select('*').order('level', { ascending: true }),
                supabase
                    .from('agent_decision_log')
                    .select('id, created_at, decision_type, reasoning, payload, outcome')
                    .eq('decision_type', 'progression_unlock')
                    .order('created_at', { ascending: false })
                    .limit(20),
                // user_events RLS is own-rows only — this event has been written
                // since the G-Member giveaway-hole fix but nothing ever read it
                // back for ops until now.
                adminFetch('admin', { action: 'list_g_member_waitlist' }),
            ]);

            setRiders(ridersRes?.data || []);
            setRules(rulesRes.data || []);
            setAiSuggestions(aiRes.data || []);
            setWaitlist(waitlistRes?.waitlist || []);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            setError(msg);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchAll(); }, [fetchAll]);

    const handleManualUnlock = async (riderId: string, vertical: string, newLevel: number) => {
        setOverrideLoading(true);
        try {
            const { data: existing } = await supabase
                .from('rider_progression')
                .select('unlocked_verticals')
                .eq('rider_id', riderId)
                .single();

            const current = existing?.unlocked_verticals || [];
            const updated = current.includes(vertical) ? current : [...current, vertical];

            const { error } = await supabase
                .from('rider_progression')
                .update({ level: newLevel, unlocked_verticals: updated, updated_at: new Date().toISOString() })
                .eq('rider_id', riderId);

            if (error) throw error;

            await supabase.from('agent_decision_log').insert({
                decision_type: 'admin_progression_override',
                reasoning: `Admin manually unlocked ${vertical} for rider ${riderId}`,
                tool_used: 'admin_manual_override',
                payload: { rider_id: riderId, vertical, new_level: newLevel },
                outcome: `Unlocked ${vertical}`,
            });

            setOverrideRiderId(null);
            setOverrideVertical('');
            await fetchAll();
        } catch (err) {
            alert(err instanceof Error ? err.message : 'Override failed');
        } finally {
            setOverrideLoading(false);
        }
    };

    const handleSaveRule = async () => {
        if (!editingRule) return;
        setRuleLoading(true);
        try {
            const { error } = await supabase
                .from('progression_config')
                .update({
                    threshold_type: editingRule.threshold_type,
                    threshold_value: editingRule.threshold_value,
                    unlock_verticals: editingRule.unlock_verticals,
                    push_title: editingRule.push_title,
                })
                .eq('level', editingRule.level);

            if (error) throw error;
            setEditingRule(null);
            await fetchAll();
        } catch (err) {
            alert(err instanceof Error ? err.message : 'Save failed');
        } finally {
            setRuleLoading(false);
        }
    };

    const filteredRiders = riders.filter(r =>
        !searchQuery || r.name?.toLowerCase().includes(searchQuery.toLowerCase()) || r.email?.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const stats = {
        total: riders.length,
        level1: riders.filter(r => r.level === 1).length,
        level2plus: riders.filter(r => r.level >= 2).length,
        level5: riders.filter(r => r.level === 5).length,
    };

    return (
        <div className="space-y-8">
            {/* Header stats */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                    { label: 'Total Riders', value: stats.total, color: 'text-white' },
                    { label: 'New (Level 1)', value: stats.level1, color: 'text-white/40' },
                    { label: 'Unlocked (L2+)', value: stats.level2plus, color: 'text-blue-400' },
                    { label: 'G-Escape (L5)', value: stats.level5, color: 'text-emerald-400' },
                ].map(s => (
                    <div key={s.label} className="bg-white/5 border border-white/10 rounded-2xl p-6">
                        <p className="text-xs font-black text-white/40 uppercase tracking-widest mb-2">{s.label}</p>
                        <p className={`text-3xl font-black ${s.color}`}>{s.value}</p>
                    </div>
                ))}
            </div>

            {error && (
                <div className="p-4 bg-red-900/30 border border-red-500/40 rounded-xl text-red-300 text-sm font-mono flex items-center justify-between">
                    <span>{error}</span>
                    <button onClick={fetchAll} className="px-3 py-1 bg-red-500/20 border border-red-500/40 rounded-lg text-xs font-black uppercase tracking-widest">Retry</button>
                </div>
            )}

            {/* Progression rules */}
            <div className="bg-white/3 border border-white/8 rounded-2xl overflow-hidden">
                <div className="px-6 py-4 border-b border-white/8 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <Settings size={16} className="text-cyan-400" />
                        <h3 className="text-sm font-black text-white uppercase tracking-widest">Unlock Rules</h3>
                    </div>
                    <p className="text-xs text-white/30">Edit thresholds — AI respects these on every cron tick</p>
                </div>
                <div className="divide-y divide-white/5">
                    {rules.map(rule => (
                        <div key={rule.level} className="px-6 py-4 flex items-center justify-between gap-4">
                            {editingRule?.level === rule.level ? (
                                <div className="flex-1 grid grid-cols-2 lg:grid-cols-4 gap-3">
                                    <div>
                                        <label className="text-[10px] text-white/40 block mb-1">Threshold type</label>
                                        <select
                                            value={editingRule.threshold_type}
                                            onChange={e => setEditingRule({ ...editingRule, threshold_type: e.target.value })}
                                            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
                                        >
                                            <option value="rides">Rides</option>
                                            <option value="grocery_orders">Grocery Orders</option>
                                            <option value="laundry_orders">Laundry Orders</option>
                                            <option value="wallet_funded">Wallet Funded</option>
                                            <option value="escape_booked">Escape Booked</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-[10px] text-white/40 block mb-1">Required count</label>
                                        <input
                                            type="number"
                                            value={editingRule.threshold_value}
                                            onChange={e => setEditingRule({ ...editingRule, threshold_value: parseInt(e.target.value) || 1 })}
                                            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-[10px] text-white/40 block mb-1">Unlock verticals (comma-separated)</label>
                                        <input
                                            value={editingRule.unlock_verticals.join(',')}
                                            onChange={e => setEditingRule({ ...editingRule, unlock_verticals: e.target.value.split(',').map(v => v.trim()).filter(Boolean) })}
                                            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white font-mono"
                                        />
                                    </div>
                                    <div className="flex items-end gap-2">
                                        <button
                                            onClick={handleSaveRule}
                                            disabled={ruleLoading}
                                            className="flex-1 py-2 bg-cyan-500/20 border border-cyan-500/40 rounded-lg text-cyan-300 text-xs font-black uppercase tracking-widest disabled:opacity-40"
                                        >
                                            {ruleLoading ? '...' : 'Save'}
                                        </button>
                                        <button
                                            onClick={() => setEditingRule(null)}
                                            className="flex-1 py-2 bg-white/5 border border-white/10 rounded-lg text-white/40 text-xs font-black uppercase tracking-widest"
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <>
                                    <div className="flex items-center gap-4 flex-1">
                                        <div className={`text-xs font-black uppercase tracking-widest w-16 ${LEVEL_COLORS[rule.level]}`}>
                                            L{rule.level}
                                        </div>
                                        <ChevronRight size={14} className="text-white/20" />
                                        <div>
                                            <p className="text-sm font-bold text-white">{rule.unlock_verticals.map(v => v.replace(/_/g, ' ')).join(' + ')}</p>
                                            <p className="text-xs text-white/40">{rule.threshold_value} {rule.threshold_type.replace(/_/g, ' ')} required</p>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => setEditingRule(rule)}
                                        className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-white/40 text-xs font-black uppercase tracking-widest hover:bg-white/10 hover:text-white transition-all"
                                    >
                                        Edit
                                    </button>
                                </>
                            )}
                        </div>
                    ))}
                </div>
            </div>

            {/* Rider table */}
            <div className="bg-white/3 border border-white/8 rounded-2xl overflow-hidden">
                <div className="px-6 py-4 border-b border-white/8 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <TrendingUp size={16} className="text-cyan-400" />
                        <h3 className="text-sm font-black text-white uppercase tracking-widest">Rider Progression</h3>
                    </div>
                    <div className="flex items-center gap-3">
                        <input
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            placeholder="Search rider..."
                            className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder:text-white/20 w-48"
                        />
                        <button
                            onClick={fetchAll}
                            className="p-2 rounded-lg border border-white/10 text-white/40 hover:text-white hover:bg-white/5 transition-all"
                            aria-label="Refresh progression data"
                        >
                            <RefreshCw size={14} />
                        </button>
                    </div>
                </div>

                {loading ? (
                    <div className="px-6 py-12 text-center text-white/30 text-sm">Loading...</div>
                ) : (
                    <div className="divide-y divide-white/5">
                        {filteredRiders.map(rider => (
                            <div key={rider.rider_id} className="px-6 py-4">
                                <div className="flex items-start justify-between gap-4">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-3 mb-1">
                                            <span className={`text-xs font-black uppercase tracking-widest ${LEVEL_COLORS[rider.level]}`}>
                                                {LEVEL_LABELS[rider.level] || `L${rider.level}`}
                                            </span>
                                            <span className="text-white/20 text-xs">•</span>
                                            <span className="text-white text-sm font-bold truncate">{rider.name || '—'}</span>
                                            <span className="text-white/30 text-xs truncate hidden lg:block">{rider.email}</span>
                                        </div>

                                        <div className="flex items-center gap-4 text-xs text-white/40 mb-2">
                                            <span>{rider.total_rides} rides</span>
                                            {rider.total_grocery_orders > 0 && <span>{rider.total_grocery_orders} grocery</span>}
                                            {rider.total_laundry_orders > 0 && <span>{rider.total_laundry_orders} laundry</span>}
                                            {rider.wallet_ever_funded && <span className="text-green-400">wallet funded</span>}
                                        </div>

                                        <div className="flex flex-wrap gap-1.5 mb-2">
                                            {rider.unlocked_verticals.map(v => (
                                                <span key={v} className="flex items-center gap-1 px-2 py-0.5 bg-white/8 border border-white/10 rounded-full text-[10px] font-bold text-white/60 uppercase tracking-wider">
                                                    <Unlock size={9} />
                                                    {v.replace(/_/g, ' ')}
                                                </span>
                                            ))}
                                        </div>

                                        {rider.next_unlock && (
                                            <div className="max-w-xs">
                                                <div className="flex items-center justify-between mb-1">
                                                    <span className="text-[10px] text-white/30 flex items-center gap-1">
                                                        <Lock size={9} />
                                                        Next: {rider.next_unlock.label}
                                                    </span>
                                                    <span className="text-[10px] text-white/30">
                                                        {rider.next_unlock.progress}/{rider.next_unlock.required}
                                                    </span>
                                                </div>
                                                <div className="h-1 bg-white/8 rounded-full overflow-hidden">
                                                    <div
                                                        className="h-full bg-cyan-400/60 rounded-full transition-all"
                                                        style={{ width: `${Math.min(100, (rider.next_unlock.progress / rider.next_unlock.required) * 100)}%` }}
                                                    />
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    <div className="shrink-0">
                                        {overrideRiderId === rider.rider_id ? (
                                            <div className="flex flex-col gap-2 w-48">
                                                <input
                                                    value={overrideVertical}
                                                    onChange={e => setOverrideVertical(e.target.value)}
                                                    placeholder="vertical (e.g. grocery)"
                                                    className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white font-mono"
                                                />
                                                <input
                                                    type="number"
                                                    value={overrideLevel}
                                                    onChange={e => setOverrideLevel(parseInt(e.target.value) || 1)}
                                                    min={1}
                                                    max={5}
                                                    placeholder="new level"
                                                    className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white"
                                                />
                                                <div className="flex gap-2">
                                                    <button
                                                        onClick={() => handleManualUnlock(rider.rider_id, overrideVertical, overrideLevel)}
                                                        disabled={overrideLoading || !overrideVertical}
                                                        className="flex-1 py-1.5 bg-cyan-500/20 border border-cyan-500/40 rounded-lg text-cyan-300 text-[10px] font-black uppercase tracking-widest disabled:opacity-40"
                                                    >
                                                        {overrideLoading ? '...' : 'Apply'}
                                                    </button>
                                                    <button
                                                        onClick={() => { setOverrideRiderId(null); setOverrideVertical(''); }}
                                                        className="flex-1 py-1.5 bg-white/5 border border-white/10 rounded-lg text-white/40 text-[10px] font-black uppercase tracking-widest"
                                                    >
                                                        Cancel
                                                    </button>
                                                </div>
                                            </div>
                                        ) : (
                                            <button
                                                onClick={() => { setOverrideRiderId(rider.rider_id); setOverrideLevel(Math.min(5, rider.level + 1)); }}
                                                className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-white/40 text-[10px] font-black uppercase tracking-widest hover:bg-white/10 hover:text-white transition-all"
                                                aria-label={`Manual override for ${rider.name}`}
                                            >
                                                Override
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}

                        {filteredRiders.length === 0 && !loading && (
                            <div className="px-6 py-12 text-center text-white/30 text-sm">
                                {searchQuery ? 'No riders match that search.' : 'No rider progression data yet.'}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* G-Member waitlist — real signal, no billing turned on by viewing this */}
            <div className="bg-white/3 border border-white/8 rounded-2xl overflow-hidden">
                <div className="px-6 py-4 border-b border-white/8 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <Diamond size={16} className="text-amber-400" />
                        <h3 className="text-sm font-black text-white uppercase tracking-widest">G-Member Waitlist</h3>
                    </div>
                    <span className="text-xs text-white/30">{waitlist.length} reserved · TT$60/mo when billing goes live</span>
                </div>
                {waitlist.length === 0 ? (
                    <div className="px-6 py-12 text-center text-white/30 text-sm">No one on the waitlist yet.</div>
                ) : (
                    <div className="divide-y divide-white/5">
                        {waitlist.map((w) => (
                            <div key={w.id} className="px-6 py-3 flex items-center justify-between gap-4">
                                <div>
                                    <p className="text-sm font-bold text-white">{w.profile?.name || '—'}</p>
                                    <p className="text-xs text-white/40">{w.profile?.email || w.user_id}</p>
                                </div>
                                <span className="text-[10px] text-white/30 font-mono">
                                    {new Date(w.created_at).toLocaleDateString('en-TT', { day: 'numeric', month: 'short', year: 'numeric' })}
                                </span>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* AI suggestion feed */}
            {aiSuggestions.length > 0 && (
                <div className="bg-white/3 border border-white/8 rounded-2xl overflow-hidden">
                    <div className="px-6 py-4 border-b border-white/8 flex items-center gap-3">
                        <Bot size={16} className="text-purple-400" />
                        <h3 className="text-sm font-black text-white uppercase tracking-widest">AI Unlock Log</h3>
                        <span className="text-xs text-white/30">Recent automatic unlocks from platform_intelligence</span>
                    </div>
                    <div className="divide-y divide-white/5">
                        {aiSuggestions.map(s => (
                            <div key={s.id} className="px-6 py-3 flex items-start gap-4">
                                <div className="text-[10px] text-white/30 font-mono w-32 shrink-0 pt-0.5">
                                    {new Date(s.created_at).toLocaleString('en-TT', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-xs text-white/70 leading-relaxed">{s.reasoning}</p>
                                    <p className="text-[10px] text-white/30 mt-0.5">{s.outcome}</p>
                                </div>
                                {s.payload?.vertical && (
                                    <span className="shrink-0 px-2 py-0.5 bg-purple-500/10 border border-purple-500/20 rounded-full text-[10px] font-bold text-purple-300 uppercase tracking-wider">
                                        {s.payload.vertical.replace(/_/g, ' ')}
                                    </span>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
