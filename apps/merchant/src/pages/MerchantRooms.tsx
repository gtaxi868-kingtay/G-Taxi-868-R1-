import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { BedDouble, RefreshCw, Loader2, Check, Globe, X, Plus } from 'lucide-react';

// A hotel keeps its own nightly rates here (founder, 2026-10-26: our team must
// not be stuck copying rates off hotel websites). Rates are date ranges that
// can never overlap; the one covering today is what G's daily package builder
// uses. A rate read off the hotel's own website is only a suggestion until
// the hotel accepts it.
export type Period = { id: string; rate_cents: number; from: string; to: string; source: string };
export type Suggestion = { id: string; source: string; rate_cents: number | null; currency: string | null; amount_text: string | null; excerpt: string | null };
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
    rate_source_url?: string | null;
    periods?: Period[];
    pending_suggestion?: Suggestion | null;
}

function fmtTTD(cents: number) {
    return `TT$${(cents / 100).toLocaleString('en-TT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
const fmtDay = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-TT', { day: 'numeric', month: 'short', year: 'numeric' });
export const todayTT = (now = Date.now()) => new Date(now - 4 * 3_600_000).toISOString().slice(0, 10);
const plusDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export function rateStatus(row: LodgingRow, now = Date.now()): { label: string; tone: 'live' | 'soon' | 'none' } {
    if (!row.quoted_rate_per_night_cents || !row.quote_expires_at) return { label: 'No rate today', tone: 'none' };
    const left = new Date(row.quote_expires_at).getTime() - now;
    if (left <= 0) return { label: 'Rate expired', tone: 'none' };
    const days = Math.ceil(left / 86_400_000);
    // G only builds packages on rates good for 3+ more days.
    return days <= 3 ? { label: `Expires in ${days} day${days === 1 ? '' : 's'}`, tone: 'soon' } : { label: `Live for ${days} days`, tone: 'live' };
}

// What the hotel must type before accepting a suggestion: nothing for a TT$
// price, the TT$ amount for anything else (we never convert currency).
export function suggestionNeedsTTD(s: Suggestion): boolean {
    return s.currency !== 'TTD' || !s.rate_cents;
}

const TONE = {
    live: 'bg-green-500/10 text-green-400 border border-green-500/20',
    soon: 'bg-amber-500/10 text-amber-400 border border-amber-500/20',
    none: 'bg-white/5 text-white/40 border border-white/10',
};
const field = 'w-full mt-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm';
const label = 'text-[10px] font-bold text-white/30 uppercase tracking-widest';
const dollarsToCents = (v: string) => { const n = Number(v.replace(/[^0-9.]/g, '')); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null; };

type Msg = { ok: boolean; text: string };

export const MerchantRooms = () => {
    const [rows, setRows] = useState<LodgingRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const [msg, setMsg] = useState<Record<string, Msg>>({});
    const [form, setForm] = useState<Record<string, { rate: string; from: string; to: string; url: string; accept: string }>>({});

    const load = useCallback(async () => {
        setLoading(true);
        setLoadError(null);
        try {
            const { data, error } = await supabase.rpc('merchant_my_lodging');
            if (error) throw error;
            setRows((data as LodgingRow[]) || []);
        } catch {
            setLoadError(navigator.onLine === false
                ? 'You are offline. Your rooms will load when you reconnect.'
                : 'Could not load your rooms. Check your connection and try again.');
        } finally {
            setLoading(false);
        }
    }, []);
    useEffect(() => { load(); }, [load]);
    useEffect(() => {
        const back = () => load();
        window.addEventListener('online', back);
        return () => window.removeEventListener('online', back);
    }, [load]);

    const f = (row: LodgingRow) => form[row.id] || { rate: '', from: todayTT(), to: plusDays(todayTT(), 29), url: row.rate_source_url || '', accept: '' };
    const setF = (row: LodgingRow, patch: Partial<ReturnType<typeof f>>) => setForm((x) => ({ ...x, [row.id]: { ...f(row), ...patch } }));
    const say = (id: string, m: Msg) => setMsg((x) => ({ ...x, [id]: m }));

    // Every write: plain-English result, never a silent failure.
    const run = async (row: LodgingRow, key: string, call: () => Promise<{ data: any; error: any }>, okText: string) => {
        if (navigator.onLine === false) { say(row.id, { ok: false, text: 'You are offline. Nothing was saved.' }); return null; }
        setBusy(`${row.id}:${key}`);
        try {
            const { data, error } = await call();
            if (error && !data) throw error;
            if (data?.success === false) { say(row.id, { ok: false, text: data.error || 'That did not work. Try again.' }); return null; }
            say(row.id, { ok: true, text: data?.message || okText });
            await load();
            return data;
        } catch {
            say(row.id, { ok: false, text: 'No connection. Nothing was saved.' });
            return null;
        } finally {
            setBusy(null);
        }
    };

    const addRate = (row: LodgingRow) => {
        const v = f(row); const cents = dollarsToCents(v.rate);
        if (!cents) { say(row.id, { ok: false, text: 'Enter your nightly rate in TT dollars.' }); return; }
        run(row, 'add', async () => await supabase.rpc('merchant_add_lodging_rate', { p_lodging_id: row.id, p_rate_cents: cents, p_from: v.from, p_to: v.to }),
            'Saved. G will build packages with this rate.').then((d) => d && setF(row, { rate: '' }));
    };
    const cancelRate = (row: LodgingRow, p: Period) => {
        if (!window.confirm(`Cancel your TT$ rate for ${fmtDay(p.from)} to ${fmtDay(p.to)}? G stops using it straight away.`)) return;
        run(row, `cancel:${p.id}`, async () => await supabase.rpc('merchant_cancel_lodging_rate', { p_period_id: p.id }), 'Rate cancelled.');
    };
    const saveUrl = (row: LodgingRow) =>
        run(row, 'url', async () => await supabase.rpc('merchant_set_rate_source', { p_lodging_id: row.id, p_url: f(row).url.trim() || null }), 'Website saved.');
    const readSite = (row: LodgingRow) =>
        run(row, 'read', async () => await supabase.functions.invoke('merchant', { body: { action: 'read_hotel_rate', lodging_id: row.id } }),
            'We found a rate on your website. Check it below.');
    const decide = (row: LodgingRow, s: Suggestion, accept: boolean) => {
        const v = f(row);
        const cents = suggestionNeedsTTD(s) ? dollarsToCents(v.accept) : null;
        if (accept && suggestionNeedsTTD(s) && !cents) { say(row.id, { ok: false, text: 'Type the TT$ nightly rate to accept this.' }); return; }
        run(row, 'decide', async () => await supabase.rpc('merchant_decide_rate_suggestion', {
            p_suggestion_id: s.id, p_accept: accept, p_from: v.from, p_to: v.to, p_rate_cents: cents,
        }), accept ? 'Accepted. This rate is now live for those dates.' : 'Dismissed.');
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-xl font-black text-white">Rooms &amp; rates</h2>
                    <p className="text-xs text-white/40 mt-1">Your nightly rates for G-Escape trips. G builds packages with the rate that covers today.</p>
                </div>
                <button onClick={load} className="h-10 px-4 rounded-xl bg-white/5 border border-white/10 text-white/50 text-xs font-bold flex items-center gap-2">
                    <RefreshCw size={14} /> Refresh
                </button>
            </div>

            {loading ? (
                <div className="py-24 text-center"><Loader2 className="animate-spin mx-auto text-white/30" size={28} /><p className="text-white/30 text-xs mt-3">Loading your rooms…</p></div>
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
            ) : rows.map((row) => {
                const st = rateStatus(row);
                const v = f(row);
                const m = msg[row.id];
                const s = row.pending_suggestion;
                const isBusy = (k: string) => busy === `${row.id}:${k}`;
                return (
                    <div key={row.id} className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 space-y-5">
                        <div className="flex justify-between items-start">
                            <div>
                                <h3 className="text-white font-bold text-sm">{row.name}</h3>
                                <p className="text-[11px] text-white/40 mt-0.5">
                                    {[row.location_zone, row.max_guests ? `up to ${row.max_guests} guests` : null, row.nights ? `${row.nights}-night stays` : null].filter(Boolean).join(' · ')}
                                </p>
                            </div>
                            <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${TONE[st.tone]}`}>{st.label}</span>
                        </div>

                        {/* Current and upcoming rates */}
                        <div>
                            <p className={label}>Your rates</p>
                            {(row.periods || []).length === 0 ? (
                                <p className="text-white/40 text-xs mt-2">No rates yet. Add one below{row.quoted_rate_per_night_cents && !row.rate_set_by_hotel ? ` (G868 entered ${fmtTTD(row.quoted_rate_per_night_cents)} for you earlier)` : ''}.</p>
                            ) : (
                                <ul className="mt-2 divide-y divide-white/5">
                                    {row.periods!.map((p) => (
                                        <li key={p.id} className="flex items-center justify-between py-2 text-sm">
                                            <span className="text-white/80"><span className="font-bold text-white">{fmtTTD(p.rate_cents)}</span> a night · {fmtDay(p.from)} to {fmtDay(p.to)}
                                                {p.source !== 'hotel' ? <span className="text-white/30 text-xs"> · from {p.source === 'website' ? 'your website' : p.source === 'booking_com' ? 'Booking.com' : 'G868'}</span> : null}</span>
                                            <button onClick={() => cancelRate(row, p)} disabled={isBusy(`cancel:${p.id}`)} className="text-[10px] font-black text-red-400 uppercase flex items-center gap-1 disabled:opacity-40">
                                                {isBusy(`cancel:${p.id}`) ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />} Cancel
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>

                        {/* Add a rate for a date range */}
                        <div className="grid grid-cols-1 sm:grid-cols-[1fr_150px_150px_auto] gap-3 items-end">
                            <div><label htmlFor={`rate-${row.id}`} className={label}>Nightly rate (TT$)</label>
                                <input id={`rate-${row.id}`} inputMode="decimal" placeholder="e.g. 1200" value={v.rate} onChange={(e) => setF(row, { rate: e.target.value })} className={field} /></div>
                            <div><label htmlFor={`from-${row.id}`} className={label}>From</label>
                                <input id={`from-${row.id}`} type="date" min={todayTT()} value={v.from} onChange={(e) => setF(row, { from: e.target.value })} className={field} /></div>
                            <div><label htmlFor={`to-${row.id}`} className={label}>To</label>
                                <input id={`to-${row.id}`} type="date" min={v.from} value={v.to} onChange={(e) => setF(row, { to: e.target.value })} className={field} /></div>
                            <button onClick={() => addRate(row)} disabled={isBusy('add')}
                                className="h-12 px-5 rounded-xl bg-[#0D9488] text-black font-bold text-sm disabled:opacity-40 flex items-center justify-center gap-2">
                                {isBusy('add') ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} Add rate
                            </button>
                        </div>

                        {/* Your website */}
                        <div className="rounded-xl bg-white/[0.03] border border-white/5 p-4 space-y-3">
                            <p className="text-white/70 text-xs">Have a rates page? We can read your price from it. Nothing changes until you accept it.</p>
                            <div className="flex flex-col sm:flex-row gap-3">
                                <input aria-label="Your rates page address" placeholder="https://yourhotel.com/rates" value={v.url} onChange={(e) => setF(row, { url: e.target.value })} className={`${field} mt-0 flex-1`} />
                                <button onClick={() => saveUrl(row)} disabled={isBusy('url')} className="h-12 px-4 rounded-xl bg-white/10 text-white text-xs font-bold disabled:opacity-40">Save address</button>
                                <button onClick={() => readSite(row)} disabled={isBusy('read') || !row.rate_source_url}
                                    className="h-12 px-4 rounded-xl bg-white/10 text-white text-xs font-bold flex items-center gap-2 disabled:opacity-40">
                                    {isBusy('read') ? <Loader2 size={14} className="animate-spin" /> : <Globe size={14} />} Read my website
                                </button>
                            </div>
                            {s && (
                                <div className="rounded-xl bg-emerald-500/5 border border-emerald-500/20 p-4 text-sm text-white/80 space-y-3">
                                    <p>We found <span className="font-bold text-white">{s.amount_text}</span>{s.source === 'booking_com' ? ' on Booking.com' : ' on your website'}.
                                        {s.currency === 'USD' ? ' That price is in US dollars: type your TT$ rate to use it.' : s.currency !== 'TTD' ? ' We could not tell the currency: type your TT$ rate to use it.' : ''}</p>
                                    {s.excerpt ? <p className="text-white/40 text-xs italic">“…{s.excerpt}…”</p> : null}
                                    <p className="text-white/50 text-xs">Accepting uses the From and To dates above.</p>
                                    <div className="flex flex-wrap gap-3 items-end">
                                        {suggestionNeedsTTD(s) && (
                                            <div><label htmlFor={`acc-${row.id}`} className={label}>Your TT$ rate</label>
                                                <input id={`acc-${row.id}`} inputMode="decimal" value={v.accept} onChange={(e) => setF(row, { accept: e.target.value })} className={field} /></div>
                                        )}
                                        <button onClick={() => decide(row, s, true)} disabled={isBusy('decide')} className="h-11 px-4 rounded-xl bg-[#0D9488] text-black text-xs font-bold disabled:opacity-40">Use this rate</button>
                                        <button onClick={() => decide(row, s, false)} disabled={isBusy('decide')} className="h-11 px-4 rounded-xl bg-white/10 text-white text-xs font-bold disabled:opacity-40">Dismiss</button>
                                    </div>
                                </div>
                            )}
                        </div>

                        {m ? <p role="status" className={`text-xs ${m.ok ? 'text-green-400' : 'text-red-400'}`}>{m.text}</p> : null}
                    </div>
                );
            })}
        </div>
    );
};
