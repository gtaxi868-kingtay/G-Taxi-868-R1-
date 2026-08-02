import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { Megaphone, Plus, X, RefreshCw, Loader2, Pause } from 'lucide-react';

interface Promotion {
    id: string;
    promotion_type: 'map_pin' | 'suggested_stop' | 'search_boost' | 'home_featured';
    budget_cents: number;
    spent_cents: number;
    cost_per_impression_cents: number;
    cost_per_tap_cents: number;
    start_date: string;
    end_date: string;
    target_radius_km: number;
    is_active: boolean;
    created_at: string;
}

const TYPE_LABELS: Record<string, string> = {
    map_pin: 'Map Pin',
    suggested_stop: 'Suggested Stop',
    search_boost: 'Search Boost',
    home_featured: 'Home Featured',
};

function fmtTTD(cents: number) {
    return `TTD $${(cents / 100).toLocaleString('en-TT', { minimumFractionDigits: 2 })}`;
}

const emptyForm = {
    promotion_type: 'suggested_stop' as Promotion['promotion_type'],
    budget_cents: 500000, // TTD $5,000 default — editable
    start_date: new Date().toISOString().slice(0, 10),
    end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    target_radius_km: 3,
};

export const MerchantPromotions = ({ merchantId: _merchantId }: { merchantId?: string }) => {
    const [promotions, setPromotions] = useState<Promotion[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState(emptyForm);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase.functions.invoke('merchant', { body: { action: 'list_promotions' } });
            if (!error && data?.success) setPromotions(data.promotions || []);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const create = async () => {
        setSaving(true);
        try {
            const { data, error } = await supabase.functions.invoke('merchant', {
                body: { action: 'create_promotion', ...form },
            });
            if (error || !data?.success) throw new Error(data?.error || error?.message || 'Failed to create promotion');
            setShowForm(false);
            setForm(emptyForm);
            await load();
        } catch (err: any) {
            alert(err.message || 'Failed to create promotion');
        } finally {
            setSaving(false);
        }
    };

    const pause = async (id: string) => {
        if (!window.confirm('Pause this promotion? It stops spending immediately.')) return;
        const { error } = await supabase.functions.invoke('merchant', { body: { action: 'pause_promotion', promotion_id: id } });
        if (error) { alert('Could not pause promotion'); return; }
        await load();
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-xl font-black text-white">Promotions</h2>
                    <p className="text-xs text-white/40 mt-1">Boost your placement to riders — a new promotion is reviewed before it goes live.</p>
                </div>
                <div className="flex gap-3">
                    <button onClick={load} className="h-10 px-4 rounded-xl bg-white/5 border border-white/10 text-white/50 text-xs font-bold flex items-center gap-2">
                        <RefreshCw size={14} /> Refresh
                    </button>
                    <button onClick={() => setShowForm(true)} className="h-10 px-4 rounded-xl bg-[#0D9488]/20 border border-[#0D9488]/30 text-[#0D9488] text-xs font-bold flex items-center gap-2">
                        <Plus size={14} /> New Promotion
                    </button>
                </div>
            </div>

            {loading ? (
                <div className="py-24 text-center"><Loader2 className="animate-spin mx-auto text-white/30" size={28} /></div>
            ) : promotions.length === 0 ? (
                <div className="py-24 text-center bg-white/[0.02] rounded-3xl border border-dashed border-white/10">
                    <Megaphone size={40} className="mx-auto mb-3 text-white/20" />
                    <p className="text-white/50 text-sm">No promotions yet</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {promotions.map((p) => (
                        <div key={p.id} className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
                            <div className="flex justify-between items-start mb-3">
                                <div>
                                    <h3 className="text-white font-bold text-sm">{TYPE_LABELS[p.promotion_type]}</h3>
                                    <p className="text-[11px] text-white/40 mt-0.5">{p.start_date} → {p.end_date}</p>
                                </div>
                                <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${
                                    p.is_active ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                                    : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                }`}>
                                    {p.is_active ? 'Live' : 'Pending Review'}
                                </span>
                            </div>
                            <div className="grid grid-cols-3 gap-3 text-xs mb-3">
                                <div className="bg-white/5 rounded-lg p-2.5">
                                    <p className="text-[9px] text-white/20 uppercase font-black mb-1">Budget</p>
                                    <p className="text-white/70 font-bold">{fmtTTD(p.budget_cents)}</p>
                                </div>
                                <div className="bg-white/5 rounded-lg p-2.5">
                                    <p className="text-[9px] text-white/20 uppercase font-black mb-1">Spent</p>
                                    <p className="text-white/70 font-bold">{fmtTTD(p.spent_cents)}</p>
                                </div>
                                <div className="bg-white/5 rounded-lg p-2.5">
                                    <p className="text-[9px] text-white/20 uppercase font-black mb-1">Radius</p>
                                    <p className="text-white/70 font-bold">{p.target_radius_km}km</p>
                                </div>
                            </div>
                            {p.is_active && (
                                <button onClick={() => pause(p.id)} className="text-[10px] font-bold text-red-400 flex items-center gap-1.5">
                                    <Pause size={12} /> Pause promotion
                                </button>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {showForm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setShowForm(false)}>
                    <div className="bg-[#0B0E12] border border-white/10 rounded-3xl p-8 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-white font-bold text-lg">New Promotion</h3>
                            <button onClick={() => setShowForm(false)} className="text-white/40"><X size={20} /></button>
                        </div>
                        <div className="space-y-4">
                            <div>
                                <label className="text-[10px] font-bold text-white/30 uppercase tracking-widest">Type</label>
                                <select value={form.promotion_type} onChange={(e) => setForm({ ...form, promotion_type: e.target.value as Promotion['promotion_type'] })}
                                    className="w-full mt-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm">
                                    {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-white/30 uppercase tracking-widest">Budget (cents)</label>
                                <input type="number" value={form.budget_cents} onChange={(e) => setForm({ ...form, budget_cents: Number(e.target.value) })}
                                    className="w-full mt-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm" />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-[10px] font-bold text-white/30 uppercase tracking-widest">Start</label>
                                    <input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                                        className="w-full mt-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-white/30 uppercase tracking-widest">End</label>
                                    <input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                                        className="w-full mt-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm" />
                                </div>
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-white/30 uppercase tracking-widest">Target radius (km)</label>
                                <input type="number" value={form.target_radius_km} onChange={(e) => setForm({ ...form, target_radius_km: Number(e.target.value) })}
                                    className="w-full mt-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm" />
                            </div>
                        </div>
                        <button onClick={create} disabled={saving}
                            className="w-full mt-6 h-12 rounded-xl bg-[#0D9488] text-black font-bold text-sm disabled:opacity-40 flex items-center justify-center gap-2">
                            {saving ? <Loader2 size={16} className="animate-spin" /> : null} Submit for Review
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};
