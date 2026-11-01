import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { RefreshCw, Loader2, Banknote, ScrollText } from 'lucide-react';

// Business (hotel) payouts: room money at the hotel's own rate + the 1% lobby
// tap share. Approval happens in G Approvals (approve_business_payout);
// this page is where the bank transfer is recorded once it has been sent,
// plus the audit trail of claims, rate changes and payouts.

type Payout = {
    id: string; status: 'requested' | 'approved' | 'paid' | 'rejected';
    room_cents: number; lobby_cents: number; total_cents: number;
    created_at: string; paid_at: string | null; paid_reference: string | null; reject_reason: string | null;
    merchant_id: string; merchants: { name: string } | null;
};
type Bank = { merchant_id: string; bank_name: string | null; account_holder: string | null; account_number: string | null; account_type: string | null };
type Audit = { id: number; action: string; detail: Record<string, unknown>; created_at: string; merchant_id: string | null; merchants: { name: string } | null };

const fmt = (c: number) => `TT$${(c / 100).toLocaleString('en-TT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const when = (iso: string) => new Date(iso).toLocaleString('en-TT', { timeZone: 'America/Port_of_Spain', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

export const STATUS_TEXT: Record<Payout['status'], string> = {
    requested: 'Waiting for approval in G Approvals',
    approved: 'Approved: send the bank transfer, then mark paid',
    paid: 'Paid',
    rejected: 'Rejected',
};

// Plain words for the audit trail.
export function auditLabel(a: Pick<Audit, 'action' | 'detail'>): string {
    const d = a.detail || {};
    const money = (k: string) => (typeof d[k] === 'number' ? fmt(d[k] as number) : '');
    switch (a.action) {
        case 'claim_link_created': return 'Claim link created';
        case 'claim_link_revoked': return 'Claim link revoked';
        case 'business_claimed': return 'Owner claimed the business';
        case 'rate_added': return `Rate added: ${money('rate_cents')} a night, ${d.from} to ${d.to}`;
        case 'rate_replaced': return 'Today\'s rate replaced';
        case 'rate_cancelled': return 'Rate cancelled by the business';
        case 'rate_cancelled_by_admin': return 'Rate cancelled by G868';
        case 'rate_source_set': return 'Rates page address saved';
        case 'website_read': return `Website read: ${d.found ?? 'no rate found'}`;
        case 'booking_com_read': return `Booking.com read: ${d.found ?? 'no rate found'}`;
        case 'suggestion_accepted': return `Suggested rate accepted: ${money('rate_cents')}`;
        case 'suggestion_rejected': return 'Suggested rate dismissed';
        case 'bank_details_set': return `Bank details saved (${d.bank ?? ''}, ending ${d.last4 ?? ''})`;
        case 'payout_requested': return `Payout requested: rooms ${money('room_cents')}, lobby ${money('lobby_cents')}`;
        case 'payout_approved': return `Payout approved: ${money('total_cents')}`;
        case 'payout_paid': return `Payout paid: ${money('total_cents')} (ref ${d.reference ?? ''})`;
        default: return a.action.replace(/_/g, ' ');
    }
}

export function BusinessPayouts() {
    const [payouts, setPayouts] = useState<Payout[]>([]);
    const [banks, setBanks] = useState<Record<string, Bank>>({});
    const [audit, setAudit] = useState<Audit[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [refs, setRefs] = useState<Record<string, string>>({});
    const [msg, setMsg] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true); setError(null);
        const [p, b, a] = await Promise.all([
            supabase.from('business_payouts').select('id, status, room_cents, lobby_cents, total_cents, created_at, paid_at, paid_reference, reject_reason, merchant_id, merchants(name)').order('created_at', { ascending: false }).limit(100),
            supabase.from('merchant_payout_accounts').select('merchant_id, bank_name, account_holder, account_number, account_type'),
            supabase.from('business_audit_log').select('id, action, detail, created_at, merchant_id, merchants(name)').order('created_at', { ascending: false }).limit(60),
        ]);
        if (p.error || a.error) setError('Could not load payouts. Check your connection and refresh.');
        setPayouts((p.data as unknown as Payout[]) || []);
        setBanks(Object.fromEntries(((b.data as Bank[]) || []).map((x) => [x.merchant_id, x])));
        setAudit((a.data as unknown as Audit[]) || []);
        setLoading(false);
    }, []);
    useEffect(() => { load(); }, [load]);

    const markPaid = async (p: Payout) => {
        const ref = (refs[p.id] || '').trim();
        if (!ref) { setMsg((m) => ({ ...m, [p.id]: 'Enter the bank transfer reference first.' })); return; }
        if (!window.confirm(`Mark ${fmt(p.total_cents)} to ${p.merchants?.name ?? 'this business'} as paid with reference ${ref}? Only do this after the transfer has gone out.`)) return;
        setBusy(p.id);
        const { data, error: err } = await supabase.rpc('admin_mark_business_payout_paid', { p_payout_id: p.id, p_reference: ref });
        setBusy(null);
        setMsg((m) => ({ ...m, [p.id]: err ? err.message : data?.success ? 'Marked paid.' : data?.error || 'Could not mark paid.' }));
        if (data?.success) load();
    };

    return (
        <div className="space-y-8">
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-xl font-black text-white">Business payouts</h2>
                    <p className="text-xs text-white/40 mt-1">Hotels' room money (their own rate) and 1% lobby tap share. Approve in G Approvals, send the bank transfer, then mark it paid here.</p>
                </div>
                <button onClick={load} className="h-10 px-4 rounded-xl bg-white/5 border border-white/10 text-white/50 text-xs font-bold flex items-center gap-2"><RefreshCw size={14} /> Refresh</button>
            </div>

            {loading ? (
                <div className="py-16 text-center"><Loader2 className="animate-spin mx-auto text-white/30" size={24} /></div>
            ) : error ? (
                <p className="text-sm text-red-400">{error}</p>
            ) : payouts.length === 0 ? (
                <div className="py-16 text-center bg-white/[0.02] rounded-3xl border border-dashed border-white/10">
                    <Banknote size={36} className="mx-auto mb-3 text-white/20" />
                    <p className="text-white/50 text-sm">No payout requests yet</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {payouts.map((p) => {
                        const bank = banks[p.merchant_id];
                        return (
                            <div key={p.id} className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 space-y-3">
                                <div className="flex justify-between items-start gap-4">
                                    <div>
                                        <p className="text-white font-bold text-sm">{p.merchants?.name ?? 'Business'} · {fmt(p.total_cents)}</p>
                                        <p className="text-[11px] text-white/40 mt-1">Rooms {fmt(p.room_cents)} · Lobby share {fmt(p.lobby_cents)} · asked {when(p.created_at)}</p>
                                    </div>
                                    <span className="text-[10px] font-black uppercase tracking-wider text-white/60 text-right max-w-[220px]">{STATUS_TEXT[p.status]}</span>
                                </div>
                                {p.status === 'approved' && (
                                    <>
                                        <p className="text-xs text-white/70">
                                            {bank?.account_number
                                                ? <>Pay to <span className="font-bold text-white">{bank.account_holder}</span>, {bank.bank_name}, account <span className="font-mono text-white">{bank.account_number}</span>{bank.account_type ? ` (${bank.account_type})` : ''}</>
                                                : 'No bank details on file: ask the business to add them before paying.'}
                                        </p>
                                        <div className="flex flex-wrap gap-3 items-center">
                                            <input aria-label="Bank transfer reference" placeholder="Bank transfer reference" value={refs[p.id] || ''}
                                                onChange={(e) => setRefs((r) => ({ ...r, [p.id]: e.target.value }))} className="admin-input max-w-xs" />
                                            <button onClick={() => markPaid(p)} disabled={busy === p.id} className="text-[10px] font-black text-emerald-400 uppercase disabled:opacity-40">
                                                {busy === p.id ? 'Saving…' : 'Mark paid'}
                                            </button>
                                        </div>
                                    </>
                                )}
                                {p.status === 'paid' && <p className="text-xs text-white/50">Paid {p.paid_at ? when(p.paid_at) : ''} · ref {p.paid_reference}</p>}
                                {p.status === 'rejected' && <p className="text-xs text-white/50">{p.reject_reason}</p>}
                                {msg[p.id] && <p className="text-xs text-white/70">{msg[p.id]}</p>}
                            </div>
                        );
                    })}
                </div>
            )}

            <div>
                <h3 className="text-sm font-black text-white flex items-center gap-2"><ScrollText size={16} /> Business activity (audit log)</h3>
                {audit.length === 0 ? (
                    <p className="text-xs text-white/40 mt-3">Nothing recorded yet.</p>
                ) : (
                    <ul className="mt-3 divide-y divide-white/5">
                        {audit.map((a) => (
                            <li key={a.id} className="py-2 text-xs text-white/70 flex justify-between gap-4">
                                <span><span className="text-white">{a.merchants?.name ?? '—'}</span> · {auditLabel(a)}</span>
                                <span className="text-white/30 shrink-0">{when(a.created_at)}</span>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}
