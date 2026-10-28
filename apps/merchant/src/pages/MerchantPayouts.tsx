import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { Banknote, RefreshCw, Loader2, Check } from 'lucide-react';

// What G868 owes this business and how to get paid: room money at the
// hotel's own rate (completed stays) plus the 1% lobby tap share. A request
// goes to G868 for approval, then a bank transfer. No money moves from here.
export type Earnings = {
    success: boolean; error?: string;
    owed_room_cents: number; owed_lobby_cents: number; lobby_held_back_cents: number;
    items: { type: 'room' | 'lobby'; amount_cents: number; label: string; at: string }[];
    payouts: { id: string; status: 'requested' | 'approved' | 'paid' | 'rejected'; total_cents: number; room_cents: number; lobby_cents: number; created_at: string; paid_at: string | null; reject_reason: string | null }[];
    has_bank_details: boolean;
};

const fmt = (c: number) => `TT$${(c / 100).toLocaleString('en-TT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (iso: string) => new Date(iso).toLocaleDateString('en-TT', { day: 'numeric', month: 'short', year: 'numeric' });
const field = 'w-full mt-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm';
const label = 'text-[10px] font-bold text-white/30 uppercase tracking-widest';

export const PAYOUT_STATUS: Record<Earnings['payouts'][number]['status'], string> = {
    requested: 'With G868 for approval',
    approved: 'Approved: bank transfer on its way',
    paid: 'Paid',
    rejected: 'Not approved',
};

// One plain sentence on what the button will do.
export function payoutSummary(e: Pick<Earnings, 'owed_room_cents' | 'owed_lobby_cents' | 'payouts' | 'has_bank_details'>): { canRequest: boolean; text: string } {
    const open = e.payouts.find((p) => p.status === 'requested' || p.status === 'approved');
    const total = e.owed_room_cents + e.owed_lobby_cents;
    if (open) return { canRequest: false, text: `Your payout of ${fmt(open.total_cents)} is ${open.status === 'requested' ? 'waiting for approval' : 'approved and on its way'}.` };
    if (total <= 0) return { canRequest: false, text: 'Nothing to pay out yet. Room money appears after a guest checks out; lobby share after a ride starts at your tap point.' };
    if (!e.has_bank_details) return { canRequest: false, text: `You have ${fmt(total)} to collect. Add your bank details below to request it.` };
    return { canRequest: true, text: `You have ${fmt(total)} to collect.` };
}

export const MerchantPayouts = () => {
    const [data, setData] = useState<Earnings | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [bank, setBank] = useState({ bank: '', holder: '', number: '', type: 'Chequing' });
    const [busy, setBusy] = useState<string | null>(null);
    const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

    const load = useCallback(async () => {
        setLoading(true); setLoadError(null);
        try {
            const { data: d, error } = await supabase.rpc('merchant_earnings');
            if (error) throw error;
            if (!d?.success) { setLoadError(d?.error || 'Could not load your earnings.'); return; }
            setData(d as Earnings);
        } catch {
            setLoadError(navigator.onLine === false ? 'You are offline. Your earnings will load when you reconnect.' : 'Could not load your earnings. Check your connection and try again.');
        } finally { setLoading(false); }
    }, []);
    useEffect(() => { load(); }, [load]);

    const act = async (key: string, call: () => Promise<{ data: any; error: any }>, ok: string) => {
        if (navigator.onLine === false) { setMsg({ ok: false, text: 'You are offline. Nothing was sent.' }); return; }
        setBusy(key); setMsg(null);
        try {
            const { data: d, error } = await call();
            if (error && !d) throw error;
            if (d?.success === false) { setMsg({ ok: false, text: d.error || 'That did not work.' }); return; }
            setMsg({ ok: true, text: ok });
            await load();
        } catch { setMsg({ ok: false, text: 'No connection. Nothing was sent.' }); }
        finally { setBusy(null); }
    };

    const summary = data ? payoutSummary(data) : null;

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-xl font-black text-white">Earnings &amp; payouts</h2>
                    <p className="text-xs text-white/40 mt-1">Room money at your own rates, plus your 1% share of rides that start at your tap point.</p>
                </div>
                <button onClick={load} className="h-10 px-4 rounded-xl bg-white/5 border border-white/10 text-white/50 text-xs font-bold flex items-center gap-2"><RefreshCw size={14} /> Refresh</button>
            </div>

            {loading ? (
                <div className="py-24 text-center"><Loader2 className="animate-spin mx-auto text-white/30" size={28} /><p className="text-white/30 text-xs mt-3">Loading your earnings…</p></div>
            ) : loadError ? (
                <div className="py-16 text-center bg-white/[0.02] rounded-3xl border border-dashed border-white/10">
                    <p className="text-white/60 text-sm">{loadError}</p>
                    <button onClick={load} className="mt-4 h-10 px-5 rounded-xl bg-white/10 text-white text-xs font-bold">Try again</button>
                </div>
            ) : data && summary && (
                <>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4"><p className={label}>Room money owed</p><p className="text-white text-lg font-black mt-1">{fmt(data.owed_room_cents)}</p></div>
                        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4"><p className={label}>Lobby share owed</p><p className="text-white text-lg font-black mt-1">{fmt(data.owed_lobby_cents)}</p>
                            {data.lobby_held_back_cents > 0 && <p className="text-[11px] text-amber-300 mt-1">{fmt(data.lobby_held_back_cents)} is covering your subscription or fees.</p>}</div>
                        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 flex flex-col justify-between">
                            <p className="text-xs text-white/70">{summary.text}</p>
                            <button onClick={() => act('request', async () => await supabase.rpc('merchant_request_payout'), 'Requested. G868 will review it and send the bank transfer.')}
                                disabled={!summary.canRequest || busy === 'request'}
                                className="mt-3 h-11 rounded-xl bg-[#0D9488] text-black font-bold text-sm disabled:opacity-30 flex items-center justify-center gap-2">
                                {busy === 'request' ? <Loader2 size={16} className="animate-spin" /> : <Banknote size={16} />} Request payout
                            </button>
                        </div>
                    </div>
                    {msg && <p role="status" className={`text-xs ${msg.ok ? 'text-green-400' : 'text-red-400'}`}>{msg.text}</p>}

                    {data.items.length > 0 && (
                        <div>
                            <p className={label}>What makes up your balance</p>
                            <ul className="mt-2 divide-y divide-white/5">
                                {data.items.map((it, i) => (
                                    <li key={i} className="py-2 flex justify-between text-sm text-white/70">
                                        <span>{it.type === 'room' ? 'Room: ' : 'Lobby share: '}{it.label}</span>
                                        <span className="text-white">{fmt(it.amount_cents)}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 space-y-3">
                        <p className="text-white font-bold text-sm">Bank details {data.has_bank_details ? <span className="text-green-400 text-xs font-normal">· on file</span> : null}</p>
                        <p className="text-xs text-white/40">Where G868 sends your payouts. {data.has_bank_details ? 'Enter them again to change them.' : ''}</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div><label htmlFor="pb-bank" className={label}>Bank</label><input id="pb-bank" className={field} placeholder="e.g. Republic Bank" value={bank.bank} onChange={(e) => setBank({ ...bank, bank: e.target.value })} /></div>
                            <div><label htmlFor="pb-holder" className={label}>Account holder</label><input id="pb-holder" className={field} value={bank.holder} onChange={(e) => setBank({ ...bank, holder: e.target.value })} /></div>
                            <div><label htmlFor="pb-number" className={label}>Account number</label><input id="pb-number" className={field} inputMode="numeric" autoComplete="off" value={bank.number} onChange={(e) => setBank({ ...bank, number: e.target.value })} /></div>
                            <div><label htmlFor="pb-type" className={label}>Account type</label>
                                <select id="pb-type" className={field} value={bank.type} onChange={(e) => setBank({ ...bank, type: e.target.value })}><option>Chequing</option><option>Savings</option></select></div>
                        </div>
                        <button onClick={() => act('bank', async () => await supabase.rpc('merchant_set_payout_account', { p_bank_name: bank.bank, p_account_holder: bank.holder, p_account_number: bank.number, p_account_type: bank.type }), 'Bank details saved.').then(() => setBank({ bank: '', holder: '', number: '', type: 'Chequing' }))}
                            disabled={busy === 'bank'} className="h-11 px-5 rounded-xl bg-white/10 text-white text-xs font-bold flex items-center gap-2 disabled:opacity-40">
                            {busy === 'bank' ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Save bank details
                        </button>
                    </div>

                    <div>
                        <p className={label}>Payout history</p>
                        {data.payouts.length === 0 ? <p className="text-xs text-white/40 mt-2">No payouts yet.</p> : (
                            <ul className="mt-2 divide-y divide-white/5">
                                {data.payouts.map((p) => (
                                    <li key={p.id} className="py-2 flex justify-between text-sm text-white/70">
                                        <span>{day(p.created_at)} · {fmt(p.total_cents)}{p.reject_reason ? ` · ${p.reject_reason}` : ''}</span>
                                        <span className="text-white/60 text-xs">{PAYOUT_STATUS[p.status]}</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </>
            )}
        </div>
    );
};
