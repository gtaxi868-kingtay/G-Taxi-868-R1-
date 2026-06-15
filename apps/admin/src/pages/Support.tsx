import { useEffect, useState } from 'react';
import { adminFetch } from '../lib/supabase';
import { Flag, CreditCard, CheckCircle, XCircle, Clock, AlertTriangle, RefreshCw } from 'lucide-react';

interface Ticket {
    id: string;
    user_id: string;
    ride_id: string | null;
    category: string;
    description: string;
    status: 'open' | 'in_review' | 'resolved' | 'rejected';
    resolution_note: string | null;
    refund_amount_cents: number | null;
    created_at: string;
    profiles?: { full_name: string; email: string };
    rides?: { pickup_address: string; dropoff_address: string; total_fare_cents: number } | null;
}

interface PayoutRequest {
    id: string;
    driver_id: string;
    amount_cents: number;
    status: 'pending' | 'processing' | 'completed' | 'rejected';
    bank_details: { bank_name?: string; account_holder?: string; account_number?: string } | null;
    rejection_reason: string | null;
    created_at: string;
    drivers?: { name: string; phone_number: string };
}

const STATUS_COLORS: Record<string, string> = {
    open: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
    in_review: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20',
    resolved: 'text-green-400 bg-green-500/10 border-green-500/20',
    rejected: 'text-red-400 bg-red-500/10 border-red-500/20',
    pending: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
    completed: 'text-green-400 bg-green-500/10 border-green-500/20',
    processing: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20',
};

const CATEGORY_LABELS: Record<string, string> = {
    refund_request: 'Refund Request',
    overcharge: 'Overcharge',
    driver_behavior: 'Driver Behavior',
    rider_behavior: 'Rider Behavior',
    lost_item: 'Lost Item',
    safety: 'Safety',
    app_issue: 'App Issue',
    other: 'Other',
};

export const Support = () => {
    const [tickets, setTickets] = useState<Ticket[]>([]);
    const [payouts, setPayouts] = useState<PayoutRequest[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeSection, setActiveSection] = useState<'tickets' | 'payouts'>('tickets');
    const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
    const [resolutionNote, setResolutionNote] = useState('');
    const [refundAmount, setRefundAmount] = useState('');
    const [processing, setProcessing] = useState(false);

    const load = async () => {
        setLoading(true);
        try {
            const { supabase } = await import('../lib/supabase');
            const [ticketRes, payoutRes] = await Promise.all([
                supabase
                    .from('support_tickets')
                    .select('*, profiles:user_id(full_name, email), rides:ride_id(pickup_address, dropoff_address, total_fare_cents)')
                    .order('created_at', { ascending: false })
                    .limit(100),
                supabase
                    .from('payout_requests')
                    .select('*, drivers:driver_id(name, phone_number)')
                    .order('created_at', { ascending: false })
                    .limit(100),
            ]);
            setTickets(ticketRes.data || []);
            setPayouts(payoutRes.data || []);
        } catch (err) {
            console.error('Support load error:', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const resolveTicket = async (ticket: Ticket, action: 'resolved' | 'rejected') => {
        if (!resolutionNote.trim()) {
            alert('Add a resolution note first.');
            return;
        }
        setProcessing(true);
        try {
            const { supabase } = await import('../lib/supabase');

            if (action === 'resolved' && ticket.category === 'refund_request' && refundAmount) {
                const cents = Math.round(parseFloat(refundAmount) * 100);
                await adminFetch('admin_refund', { ride_id: ticket.ride_id, reason: resolutionNote });
                await supabase.from('support_tickets').update({
                    status: action,
                    resolution_note: resolutionNote,
                    refund_amount_cents: cents,
                    resolved_at: new Date().toISOString(),
                }).eq('id', ticket.id);
            } else {
                await supabase.from('support_tickets').update({
                    status: action,
                    resolution_note: resolutionNote,
                    resolved_at: new Date().toISOString(),
                }).eq('id', ticket.id);
            }

            setSelectedTicket(null);
            setResolutionNote('');
            setRefundAmount('');
            load();
        } catch (err) {
            alert('Action failed. Check console.');
            console.error(err);
        } finally {
            setProcessing(false);
        }
    };

    const processPayout = async (request: PayoutRequest, action: 'approve' | 'reject') => {
        setProcessing(true);
        const reason = action === 'reject' ? prompt('Rejection reason (optional):') : undefined;
        try {
            await adminFetch('admin_process_payout', {
                request_id: request.id,
                action,
                reason: reason || null,
            });
            load();
        } catch (err) {
            alert('Payout action failed.');
            console.error(err);
        } finally {
            setProcessing(false);
        }
    };

    const pendingPayouts = payouts.filter(p => p.status === 'pending');
    const openTickets = tickets.filter(t => t.status === 'open' || t.status === 'in_review');

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* Header KPIs */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                    { label: 'Open Tickets', value: openTickets.length, color: 'text-yellow-400', icon: <Flag size={18} /> },
                    { label: 'Pending Payouts', value: pendingPayouts.length, color: 'text-cyan-400', icon: <CreditCard size={18} /> },
                    { label: 'Resolved Today', value: tickets.filter(t => t.status === 'resolved' && new Date(t.created_at).toDateString() === new Date().toDateString()).length, color: 'text-green-400', icon: <CheckCircle size={18} /> },
                    { label: 'Total Payout $', value: `$${(payouts.filter(p => p.status === 'completed').reduce((s, p) => s + p.amount_cents, 0) / 100).toFixed(0)}`, color: 'text-purple-400', icon: <CreditCard size={18} /> },
                ].map(kpi => (
                    <div key={kpi.label} className="bg-white/5 border border-white/10 rounded-3xl p-6 flex items-center gap-4">
                        <div className={`p-2 rounded-xl bg-white/5 ${kpi.color}`}>{kpi.icon}</div>
                        <div>
                            <p className="text-xs font-black text-white/40 uppercase tracking-widest">{kpi.label}</p>
                            <p className={`text-2xl font-black ${kpi.color}`}>{kpi.value}</p>
                        </div>
                    </div>
                ))}
            </div>

            {/* Section switcher */}
            <div className="flex gap-3">
                {(['tickets', 'payouts'] as const).map(s => (
                    <button
                        key={s}
                        onClick={() => setActiveSection(s)}
                        className={`px-5 py-2 rounded-2xl text-xs font-black uppercase tracking-widest transition-all ${activeSection === s ? 'bg-purple-500/30 text-purple-300 border border-purple-500/40' : 'bg-white/5 text-white/40 border border-white/10 hover:border-white/20'}`}
                    >
                        {s === 'tickets' ? `Support Tickets (${openTickets.length} open)` : `Payout Requests (${pendingPayouts.length} pending)`}
                    </button>
                ))}
                <button onClick={load} className="ml-auto p-2 text-white/40 hover:text-cyan-400 transition-colors">
                    <RefreshCw size={16} />
                </button>
            </div>

            {loading ? (
                <div className="flex items-center justify-center py-20">
                    <div className="w-8 h-8 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
                </div>
            ) : activeSection === 'tickets' ? (
                <div className="bg-white/5 border border-white/10 rounded-[2.5rem] overflow-hidden">
                    <div className="px-8 py-5 border-b border-white/5 flex items-center gap-3 bg-white/[0.02]">
                        <Flag className="text-yellow-400" size={16} />
                        <h2 className="text-xs font-bold text-white/40 uppercase tracking-widest">Support Tickets</h2>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead>
                                <tr className="bg-white/[0.01] border-b border-white/5">
                                    {['User', 'Category', 'Description', 'Status', 'Date', 'Actions'].map(h => (
                                        <th key={h} className="px-6 py-4 text-[10px] font-black text-white/20 uppercase tracking-widest">{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                {tickets.map(t => (
                                    <tr key={t.id} className="hover:bg-white/[0.02] transition-colors">
                                        <td className="px-6 py-4">
                                            <p className="text-sm font-bold text-white">{(t.profiles as any)?.full_name || 'Unknown'}</p>
                                            <p className="text-xs text-white/40">{(t.profiles as any)?.email}</p>
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className="text-xs font-black text-white/60">{CATEGORY_LABELS[t.category] || t.category}</span>
                                        </td>
                                        <td className="px-6 py-4 max-w-xs">
                                            <p className="text-sm text-white/70 line-clamp-2">{t.description}</p>
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className={`text-[10px] font-black border px-2 py-1 rounded-md uppercase tracking-tight ${STATUS_COLORS[t.status] || 'text-white/40'}`}>
                                                {t.status}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-xs text-white/40">
                                            {new Date(t.created_at).toLocaleDateString()}
                                        </td>
                                        <td className="px-6 py-4">
                                            {(t.status === 'open' || t.status === 'in_review') && (
                                                <button
                                                    onClick={() => { setSelectedTicket(t); setResolutionNote(''); setRefundAmount(''); }}
                                                    className="px-4 py-2 bg-purple-500/20 text-purple-300 text-xs font-black rounded-xl hover:bg-purple-500/40 transition-all border border-purple-500/30"
                                                >
                                                    Review
                                                </button>
                                            )}
                                            {t.resolution_note && (
                                                <p className="text-xs text-white/30 mt-1 max-w-[160px] line-clamp-1">{t.resolution_note}</p>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                                {tickets.length === 0 && (
                                    <tr>
                                        <td colSpan={6} className="px-8 py-20 text-center text-white/40 text-xs">No tickets</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            ) : (
                <div className="bg-white/5 border border-white/10 rounded-[2.5rem] overflow-hidden">
                    <div className="px-8 py-5 border-b border-white/5 flex items-center gap-3 bg-white/[0.02]">
                        <CreditCard className="text-cyan-400" size={16} />
                        <h2 className="text-xs font-bold text-white/40 uppercase tracking-widest">Driver Payout Requests</h2>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead>
                                <tr className="bg-white/[0.01] border-b border-white/5">
                                    {['Driver', 'Amount', 'Bank Account', 'Status', 'Date', 'Actions'].map(h => (
                                        <th key={h} className="px-6 py-4 text-[10px] font-black text-white/20 uppercase tracking-widest">{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                {payouts.map(p => (
                                    <tr key={p.id} className="hover:bg-white/[0.02] transition-colors">
                                        <td className="px-6 py-4">
                                            <p className="text-sm font-bold text-white">{(p.drivers as any)?.name || 'Unknown Driver'}</p>
                                            <p className="text-xs text-white/40">{(p.drivers as any)?.phone_number}</p>
                                        </td>
                                        <td className="px-6 py-4">
                                            <p className="text-lg font-black text-white">${(p.amount_cents / 100).toFixed(2)}</p>
                                            <p className="text-xs text-white/40">TTD</p>
                                        </td>
                                        <td className="px-6 py-4">
                                            {p.bank_details ? (
                                                <div>
                                                    <p className="text-sm font-bold text-white">{p.bank_details.bank_name}</p>
                                                    <p className="text-xs text-white/40">{p.bank_details.account_holder}</p>
                                                    <p className="text-xs text-white/40">····{p.bank_details.account_number?.slice(-4)}</p>
                                                </div>
                                            ) : <span className="text-xs text-white/30">No details</span>}
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className={`text-[10px] font-black border px-2 py-1 rounded-md uppercase tracking-tight ${STATUS_COLORS[p.status] || 'text-white/40'}`}>
                                                {p.status}
                                            </span>
                                            {p.rejection_reason && (
                                                <p className="text-[10px] text-red-400/60 mt-1 max-w-[120px] line-clamp-1">{p.rejection_reason}</p>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 text-xs text-white/40">
                                            {new Date(p.created_at).toLocaleDateString()}
                                        </td>
                                        <td className="px-6 py-4">
                                            {p.status === 'pending' && (
                                                <div className="flex gap-2">
                                                    <button
                                                        onClick={() => processPayout(p, 'approve')}
                                                        disabled={processing}
                                                        className="p-2 bg-green-500/20 text-green-400 rounded-xl hover:bg-green-500/40 transition-all border border-green-500/30"
                                                        title="Approve payout"
                                                    >
                                                        <CheckCircle size={16} />
                                                    </button>
                                                    <button
                                                        onClick={() => processPayout(p, 'reject')}
                                                        disabled={processing}
                                                        className="p-2 bg-red-500/20 text-red-400 rounded-xl hover:bg-red-500/40 transition-all border border-red-500/30"
                                                        title="Reject payout"
                                                    >
                                                        <XCircle size={16} />
                                                    </button>
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                                {payouts.length === 0 && (
                                    <tr>
                                        <td colSpan={6} className="px-8 py-20 text-center text-white/40 text-xs">No payout requests</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Ticket resolution modal */}
            {selectedTicket && (
                <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-[#0d0b1a] border border-white/10 rounded-3xl p-8 w-full max-w-lg">
                        <h3 className="text-lg font-black text-white mb-2">Resolve Ticket</h3>
                        <p className="text-sm text-white/50 mb-1">
                            <span className="font-bold text-white/80">{(selectedTicket.profiles as any)?.full_name}</span> — {CATEGORY_LABELS[selectedTicket.category]}
                        </p>
                        <p className="text-sm text-white/60 mb-6 bg-white/5 rounded-2xl p-4">{selectedTicket.description}</p>

                        {selectedTicket.rides && (
                            <p className="text-xs text-white/40 mb-4">
                                Trip: {(selectedTicket.rides as any)?.pickup_address} → {(selectedTicket.rides as any)?.dropoff_address}
                                {' · '}${((selectedTicket.rides as any)?.total_fare_cents / 100).toFixed(2)} TTD
                            </p>
                        )}

                        {selectedTicket.category === 'refund_request' && selectedTicket.ride_id && (
                            <input
                                type="number"
                                placeholder="Refund amount TTD (leave blank for full fare refund)"
                                value={refundAmount}
                                onChange={e => setRefundAmount(e.target.value)}
                                className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:border-cyan-500 outline-none mb-3"
                            />
                        )}

                        <textarea
                            placeholder="Resolution note (shown internally, logged on ticket)..."
                            value={resolutionNote}
                            onChange={e => setResolutionNote(e.target.value)}
                            rows={3}
                            className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:border-cyan-500 outline-none mb-4 resize-none"
                        />

                        <div className="flex gap-3">
                            <button
                                onClick={() => resolveTicket(selectedTicket, 'resolved')}
                                disabled={processing}
                                className="flex-1 py-3 bg-green-500/20 text-green-400 text-sm font-black rounded-2xl hover:bg-green-500/40 transition-all border border-green-500/30"
                            >
                                {processing ? 'Processing…' : 'Resolve'}
                            </button>
                            <button
                                onClick={() => resolveTicket(selectedTicket, 'rejected')}
                                disabled={processing}
                                className="flex-1 py-3 bg-red-500/20 text-red-400 text-sm font-black rounded-2xl hover:bg-red-500/40 transition-all border border-red-500/30"
                            >
                                Reject
                            </button>
                            <button
                                onClick={() => { setSelectedTicket(null); setResolutionNote(''); }}
                                className="px-5 py-3 bg-white/5 text-white/40 text-sm font-black rounded-2xl hover:bg-white/10 transition-all"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
