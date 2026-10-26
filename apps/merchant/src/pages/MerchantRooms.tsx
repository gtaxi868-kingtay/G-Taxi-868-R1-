import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { BedDouble, RefreshCw, Loader2, Check } from 'lucide-react';

// A hotel keeps its own nightly rate here (founder, 2026-10-26: our team must
// not be stuck copying rates off hotel websites). The rate lands in the same
// quote fields admin used to type in, so G's daily package builder picks it up
// on its own and admin only approves the finished package.
export interface LodgingRow {
    id: string;
    name: string;
    destination_code: string | null;
    location_zone: string | null;
    min_guests: number | null;
    max_guests: number | null;
    nights: number | null;
    is_active: boolean;
    quoted_rate_per_night_cents: number | null;
    quoted_at: string | null;
    quote_expires_at: string | null;
    rate_set_by_hotel: boolean;
}

function fmtTTD(cents: number) {
    return `TT$${(cents / 100).toLocaleString('en-TT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function rateStatus(row: LodgingRow, now = Date.now()): { label: string; tone: 'live' | 'soon' | 'none' } {
    if (!row.quoted_rate_per_night_cents || !row.quote_expires_at) return { label: 'No rate yet', tone: 'none' };
    const left = new Date(row.quote_expires_at).getTime() - now;
    if (left <= 0) return { label: 'Rate expired', tone: 'none' };
    const days = Math.ceil(left / 86_400_000);
    // G only builds packages on rates good for 3+ more days.
    return days <= 3 ? { label: `Expires in ${days} day${days === 1 ? '' : 's'}`, tone: 'soon' } : { label: `Live for ${days} days`, tone: 'live' };
}

const TONE = {
    live: 'bg-green-500/10 text-green-400 border border-green-500/20',
    soon: 'bg-amber-500/10 text-amber-400 border border-amber-500/20',
    none: 'bg-white/5 text-white/40 border border-white/10',
};

export const MerchantRooms = () => {
    const [rows, setRows] = useState<LodgingRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [drafts, setDrafts] = useState<Record<string, { rate: string; days: string }>>({});
    const [savingId, setSavingId] = useState<string | null>(null);
    const [message, setMessage] = useState<Record<string, { ok: boolean; text: string }>>({});

    const load = useCallback(async () => {
        setLoading(true);
        setLoadError(null);
        try {
            const { data, error } = await supabase.rpc('merchant_my_lodging');
            if (error) throw error;
            setRows((data as LodgingRow[]) || []);
        } catch {
            setLoadError('Could not load your rooms. Check your connection and try again.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const save = async (row: LodgingRow) => {
        const d = drafts[row.id] || { rate: '', days: '30' };
        const dollars = Number(d.rate.replace(/[^0-9.]/g, ''));
        if (!Number.isFinite(dollars) || dollars <= 0) {
            setMessage((m) => ({ ...m, [row.id]: { ok: false, text: 'Enter your nightly rate in TT dollars.' } }));
            return;
        }
        setSavingId(row.id);
        try {
            const { data, error } = await supabase.rpc('merchant_set_lodging_rate', {
                p_lodging_id: row.id,
                p_rate_cents: Math.round(dollars * 100),
                p_valid_days: Number(d.days) || 30,
            });
            if (error) throw error;
            if (!data?.success) {
                setMessage((m) => ({ ...m, [row.id]: { ok: false, text: data?.error || 'Could not save the rate.' } }));
                return;
            }
            setMessage((m) => ({ ...m, [row.id]: { ok: true, text: 'Saved. G will build packages with this rate.' } }));
            setDrafts((x) => { const n = { ...x }; delete n[row.id]; return n; });
            await load();
        } catch {
            setMessage((m) => ({ ...m, [row.id]: { ok: false, text: 'No connection. Your rate was not saved.' } }));
        } finally {
            setSavingId(null);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-xl font-black text-white">Rooms &amp; rates</h2>
                    <p className="text-xs text-white/40 mt-1">Your nightly rate for G-Escape trips. Keep it current and G builds the packages for you.</p>
                </div>
                <button onClick={load} className="h-10 px-4 rounded-xl bg-white/5 border border-white/10 text-white/50 text-xs font-bold flex items-center gap-2">
                    <RefreshCw size={14} /> Refresh
                </button>
            </div>

            {loading ? (
                <div className="py-24 text-center"><Loader2 className="animate-spin mx-auto text-white/30" size={28} /></div>
            ) : loadError ? (
                <div className="py-16 text-center bg-white/[0.02] rounded-3xl border border-dashed border-white/10">
                    <p className="text-white/60 text-sm">{loadError}</p>
                    <button onClick={load} className="mt-4 h-10 px-5 rounded-xl bg-white/10 text-white text-xs font-bold">Try again</button>
                </div>
            ) : rows.length === 0 ? (
                <div className="py-24 text-center bg-white/[0.02] rounded-3xl border border-dashed border-white/10">
                    <BedDouble size={40} className="mx-auto mb-3 text-white/20" />
                    <p className="text-white/60 text-sm">No rooms on your account yet</p>
                    <p className="text-white/30 text-xs mt-1 max-w-sm mx-auto">If you run a hotel or guesthouse, ask G868 for your claim link. It connects your property to this account.</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {rows.map((row) => {
                        const st = rateStatus(row);
                        const d = drafts[row.id] || { rate: '', days: '30' };
                        const msg = message[row.id];
                        return (
                            <div key={row.id} className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
                                <div className="flex justify-between items-start mb-4">
                                    <div>
                                        <h3 className="text-white font-bold text-sm">{row.name}</h3>
                                        <p className="text-[11px] text-white/40 mt-0.5">
                                            {[row.location_zone, row.max_guests ? `up to ${row.max_guests} guests` : null, row.nights ? `${row.nights}-night stays` : null].filter(Boolean).join(' · ')}
                                        </p>
                                    </div>
                                    <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${TONE[st.tone]}`}>{st.label}</span>
                                </div>
                                {row.quoted_rate_per_night_cents ? (
                                    <p className="text-white/70 text-sm mb-4">
                                        Current rate <span className="font-bold text-white">{fmtTTD(row.quoted_rate_per_night_cents)}</span> a night
                                        {row.rate_set_by_hotel ? '' : ' (entered by G868)'}
                                    </p>
                                ) : null}
                                <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px_auto] gap-3 items-end">
                                    <div>
                                        <label htmlFor={`rate-${row.id}`} className="text-[10px] font-bold text-white/30 uppercase tracking-widest">New nightly rate (TT$)</label>
                                        <input id={`rate-${row.id}`} inputMode="decimal" placeholder="e.g. 1200" value={d.rate}
                                            onChange={(e) => setDrafts((x) => ({ ...x, [row.id]: { ...d, rate: e.target.value } }))}
                                            className="w-full mt-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm" />
                                    </div>
                                    <div>
                                        <label htmlFor={`days-${row.id}`} className="text-[10px] font-bold text-white/30 uppercase tracking-widest">Good for</label>
                                        <select id={`days-${row.id}`} value={d.days}
                                            onChange={(e) => setDrafts((x) => ({ ...x, [row.id]: { ...d, days: e.target.value } }))}
                                            className="w-full mt-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm">
                                            <option value="14">2 weeks</option>
                                            <option value="30">30 days</option>
                                            <option value="60">60 days</option>
                                            <option value="90">90 days</option>
                                        </select>
                                    </div>
                                    <button onClick={() => save(row)} disabled={savingId === row.id}
                                        className="h-12 px-6 rounded-xl bg-[#0D9488] text-black font-bold text-sm disabled:opacity-40 flex items-center justify-center gap-2">
                                        {savingId === row.id ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Save rate
                                    </button>
                                </div>
                                {msg ? <p role="status" className={`text-xs mt-3 ${msg.ok ? 'text-green-400' : 'text-red-400'}`}>{msg.text}</p> : null}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};
