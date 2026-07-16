import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  Shield, ShieldAlert, CheckCircle, XCircle, Map, RefreshCw,
  Inbox, DollarSign, TrendingUp, Clock, Ban, Banknote, ExternalLink,
  ChevronDown, ChevronUp, CheckCircle2, Search,
} from 'lucide-react';

interface Application {
    id: string;
    user_id: string;
    full_name: string;
    phone: string;
    whatsapp: string | null;
    area: string;
    current_role: string | null;
    reasoning: string;
    referral_code: string | null;
    status: string;
    created_at: string;
    user: { id: string; email: string; full_name: string; role: string } | null;
}

interface Commander {
    id: string;
    user_id: string;
    status: string;
    metrics: any;
    created_at: string;
    user: { id: string; email: string; full_name: string; role: string } | null;
    territory: { id: string; name: string; code: string } | null;
}

interface Territory {
    id: string;
    name: string;
    code: string;
}

interface RevshareEntry {
    id: string;
    commander_id: string;
    ride_id: string;
    rider_id: string;
    fare_cents: number;
    revshare_cents: number;
    status: string;
    created_at: string;
    paid_at: string | null;
    commander: { id: string } | null;
    ride: { id: string; fare_cents: number; status: string; created_at: string } | null;
}

interface RevshareSummary {
    paid_total_cents: number;
    pending_total_cents: number;
    void_total_cents: number;
    total_entries: number;
}

interface PayoutRequest {
    id: string;
    commander_id: string;
    amount_cents: number;
    status: 'pending' | 'approved' | 'rejected' | 'completed';
    bank_details: any;
    payment_method: string | null;
    rejection_reason: string | null;
    created_at: string;
    processed_at: string | null;
    commanders: {
        id: string;
        user_id: string;
        status: string;
        user: { id: string; email: string; full_name: string } | null;
        territory: { name: string; code: string } | null;
    } | null;
}

function fmtTTD(cents: number) {
    return `TTD $${(cents / 100).toLocaleString('en-TT', { minimumFractionDigits: 2 })}`;
}

export function CommanderManagement() {
    const [applications, setApplications] = useState<Application[]>([]);
    const [commanders, setCommanders] = useState<Commander[]>([]);
    const [territories, setTerritories] = useState<Territory[]>([]);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState<string | null>(null);

    const [revshareEntries, setRevshareEntries] = useState<RevshareEntry[]>([]);
    const [revshareSummary, setRevshareSummary] = useState<RevshareSummary | null>(null);
    const [revshareLoading, setRevshareLoading] = useState(true);

    const [payoutRequests, setPayoutRequests] = useState<PayoutRequest[]>([]);
    const [payoutLoading, setPayoutLoading] = useState(true);
    const [payoutSearch, setPayoutSearch] = useState('');
    const [payoutExpanded, setPayoutExpanded] = useState<string | null>(null);

    const loadData = async () => {
        setLoading(true);
        try {
            const [appRes, cmdRes, terrRes, revRes] = await Promise.all([
                supabase.functions.invoke('admin', { body: { action: 'manage_commanders', action_type: 'list_applications' } }),
                supabase.functions.invoke('admin', { body: { action: 'manage_commanders', action_type: 'list' } }),
                supabase.functions.invoke('admin', { body: { action: 'manage_territories', action_type: 'list' } }),
                supabase.functions.invoke('admin', { body: { action: 'manage_commanders', action_type: 'list_revshare' } }),
            ]);

            if (appRes.data?.success) setApplications(appRes.data.applications || []);
            if (cmdRes.data?.success) setCommanders(cmdRes.data.commanders || []);
            if (terrRes.data?.success) setTerritories(terrRes.data.territories || []);
            if (revRes.data?.success) {
                setRevshareEntries(revRes.data.revshare_entries || []);
                setRevshareSummary(revRes.data.summary || null);
            }

            const { data: payoutRes } = await supabase
                .from('payout_requests')
                .select(`
                    *,
                    commanders!commander_id(
                        id, user_id, status,
                        user:user_id(id, email, full_name),
                        territory:territory_id(name, code)
                    )
                `)
                .not('commander_id', 'is', null)
                .order('created_at', { ascending: false })
                .limit(100);
            setPayoutRequests((payoutRes as unknown as PayoutRequest[]) || []);
            setPayoutLoading(false);
        } catch (err) {
            console.error('Failed to load commander data:', err);
        } finally {
            setLoading(false);
            setRevshareLoading(false);
        }
    };

    useEffect(() => {
        loadData();
    }, []);

    const reviewApplication = async (applicationId: string, action: 'approve_application' | 'reject_application') => {
        setActionLoading(`app-${applicationId}`);
        try {
            const res = await supabase.functions.invoke('admin', {
                body: { action: 'manage_commanders', action_type: action, application_id: applicationId }
            });
            if (res.data?.success) {
                await loadData();
            } else {
                alert('Failed: ' + (res.data?.error || 'Unknown error'));
            }
        } catch (err: any) {
            alert('Error: ' + err.message);
        } finally {
            setActionLoading(null);
        }
    };

    const updateStatus = async (userId: string, status: string) => {
        setActionLoading(`status-${userId}`);
        try {
            const res = await supabase.functions.invoke('admin', {
                body: { action: 'manage_commanders', action_type: 'update_status', user_id: userId, status }
            });
            if (res.data?.success) {
                await loadData();
            } else {
                alert('Failed to update status: ' + (res.data?.error || 'Unknown error'));
            }
        } catch (err: any) {
            alert('Error: ' + err.message);
        } finally {
            setActionLoading(null);
        }
    };

    const handlePayoutAction = async (payoutId: string, action: 'approved' | 'rejected') => {
        if (action === 'rejected' && !window.confirm('Reject this payout request? The commander will be notified.')) return;
        setActionLoading(`payout-${payoutId}`);
        try {
            const res = await supabase.functions.invoke('admin', {
                body: {
                    action: 'manage_commanders',
                    action_type: 'process_payout',
                    payout_request_id: payoutId,
                    status: action,
                },
            });
            if (res.data?.success) {
                await loadData();
            } else {
                alert('Failed: ' + (res.data?.error || 'Unknown error'));
            }
        } catch (err: any) {
            alert('Error: ' + err.message);
        } finally {
            setActionLoading(null);
        }
    };

    const assignTerritory = async (userId: string, territoryId: string) => {
        setActionLoading(`territory-${userId}`);
        try {
            const res = await supabase.functions.invoke('admin', {
                body: { action: 'manage_commanders', action_type: 'assign_territory', user_id: userId, territory_id: territoryId }
            });
            if (res.data?.success) {
                await loadData();
            } else {
                alert('Failed to assign territory: ' + (res.data?.error || 'Unknown error'));
            }
        } catch (err: any) {
            alert('Error: ' + err.message);
        } finally {
            setActionLoading(null);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-96">
                <div className="w-10 h-10 border-4 border-cyan-400 border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    const pendingApplications = applications.filter(a => a.status === 'pending');

    return (
        <div className="space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h2 className="text-2xl sm:text-3xl font-black text-white italic tracking-tight">G-LEAD MANAGEMENT</h2>
                    <p className="text-xs font-medium text-white/20 uppercase tracking-[0.4em] mt-1">Commanders // Territory Assignments // Revshare</p>
                </div>
                <button
                    onClick={loadData}
                    className="h-12 px-6 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-white font-black text-xs uppercase tracking-widest transition-all flex items-center gap-3"
                >
                    <RefreshCw size={18} /> Refresh
                </button>
            </div>

            {/* ─── REVSHARE METRICS ─── */}
            <section className="space-y-3">
                <div className="flex items-center gap-3">
                    <DollarSign size={16} className="text-purple-400" />
                    <h3 className="text-sm font-black text-white uppercase tracking-widest">Commander Revshare</h3>
                </div>

                {revshareLoading ? (
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        {[1,2,3,4].map(i => (
                            <div key={i} className="bg-white/5 border border-white/10 rounded-2xl p-5 animate-pulse">
                                <div className="h-3 bg-white/10 rounded w-20 mb-3" />
                                <div className="h-6 bg-white/10 rounded w-28" />
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        <div className="bg-gradient-to-br from-purple-500/10 to-transparent border border-purple-500/20 rounded-2xl p-5">
                            <div className="flex items-center gap-2 mb-3">
                                <DollarSign size={14} className="text-purple-400" />
                                <span className="text-[10px] font-black text-purple-400/70 uppercase tracking-widest">Pending Payout</span>
                            </div>
                            <div className="text-white font-black text-2xl">{revshareSummary ? fmtTTD(revshareSummary.pending_total_cents) : '—'}</div>
                        </div>
                        <div className="bg-gradient-to-br from-green-500/10 to-transparent border border-green-500/20 rounded-2xl p-5">
                            <div className="flex items-center gap-2 mb-3">
                                <TrendingUp size={14} className="text-green-400" />
                                <span className="text-[10px] font-black text-green-400/70 uppercase tracking-widest">Paid Out</span>
                            </div>
                            <div className="text-white font-black text-2xl">{revshareSummary ? fmtTTD(revshareSummary.paid_total_cents) : '—'}</div>
                        </div>
                        <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
                            <div className="flex items-center gap-2 mb-3">
                                <Clock size={14} className="text-white/40" />
                                <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">Voided</span>
                            </div>
                            <div className="text-white font-black text-2xl">{revshareSummary ? fmtTTD(revshareSummary.void_total_cents) : '—'}</div>
                        </div>
                        <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
                            <div className="flex items-center gap-2 mb-3">
                                <TrendingUp size={14} className="text-cyan-400" />
                                <span className="text-[10px] font-black text-cyan-400/70 uppercase tracking-widest">Total Entries</span>
                            </div>
                            <div className="text-white font-black text-2xl">{revshareSummary ? revshareSummary.total_entries : '—'}</div>
                        </div>
                    </div>
                )}

                {revshareEntries.length > 0 && (
                    <div className="bg-white/5 border border-white/10 rounded-[2.5rem] overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left">
                                <thead>
                                    <tr className="bg-white/[0.01] border-b border-white/5">
                                        <th className="px-6 py-4 text-[10px] font-black text-white/20 uppercase tracking-widest">Date</th>
                                        <th className="px-6 py-4 text-[10px] font-black text-white/20 uppercase tracking-widest">Ride</th>
                                        <th className="px-6 py-4 text-[10px] font-black text-white/20 uppercase tracking-widest">Fare</th>
                                        <th className="px-6 py-4 text-[10px] font-black text-white/20 uppercase tracking-widest">Revshare</th>
                                        <th className="px-6 py-4 text-[10px] font-black text-white/20 uppercase tracking-widest">Status</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/5">
                                    {revshareEntries.slice(0, 20).map(entry => (
                                        <tr key={entry.id} className="hover:bg-white/[0.02]">
                                            <td className="px-6 py-4">
                                                <span className="text-xs font-bold text-white/60 font-mono">
                                                    {new Date(entry.created_at).toLocaleDateString('en-TT', { day: 'numeric', month: 'short' })}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className="text-xs text-white/40 font-mono">{entry.ride_id?.slice(0, 8) || '—'}</span>
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className="text-xs font-bold text-white">{fmtTTD(entry.fare_cents)}</span>
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className="text-xs font-bold text-purple-400">{fmtTTD(entry.revshare_cents)}</span>
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className={`text-[10px] font-black px-2.5 py-1 rounded-md border uppercase tracking-widest ${
                                                    entry.status === 'paid' ? 'text-green-400 bg-green-400/10 border-green-500/20' :
                                                    entry.status === 'pending' ? 'text-amber-400 bg-amber-400/10 border-amber-500/20' :
                                                    'text-red-400 bg-red-400/10 border-red-500/20'
                                                }`}>
                                                    {entry.status}
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </section>

            {/* ─── PAYOUT APPROVAL PANEL ─── */}
            <section className="space-y-3">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <Banknote size={16} className="text-emerald-400" />
                        <h3 className="text-sm font-black text-white uppercase tracking-widest">Payout Approval Panel</h3>
                    </div>
                    <div className="flex items-center gap-2">
                        <Search size={12} className="text-white/20" />
                        <input
                            type="text"
                            placeholder="Search commander..."
                            value={payoutSearch}
                            onChange={(e) => setPayoutSearch(e.target.value)}
                            className="bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white placeholder:text-white/20 focus:border-emerald-400/50 outline-none w-44"
                        />
                    </div>
                </div>

                {payoutLoading ? (
                    <div className="bg-white/5 border border-white/10 rounded-[2.5rem] p-8 animate-pulse">
                        <div className="flex items-center gap-4 mb-4">
                            <div className="h-4 bg-white/10 rounded w-32" />
                            <div className="h-4 bg-white/10 rounded w-20" />
                        </div>
                        {[1, 2].map((i) => (
                            <div key={i} className="flex items-center gap-4 py-4 border-b border-white/5">
                                <div className="h-3 bg-white/10 rounded w-40" />
                                <div className="h-3 bg-white/10 rounded w-24" />
                                <div className="h-8 bg-white/10 rounded w-32 ml-auto" />
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="bg-white/5 border border-white/10 rounded-[2.5rem] overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left">
                                <thead>
                                    <tr className="bg-white/[0.01] border-b border-white/5">
                                        <th className="px-6 py-4 text-[10px] font-black text-white/20 uppercase tracking-widest">Commander</th>
                                        <th className="px-6 py-4 text-[10px] font-black text-white/20 uppercase tracking-widest">Amount</th>
                                        <th className="px-6 py-4 text-[10px] font-black text-white/20 uppercase tracking-widest">Method</th>
                                        <th className="px-6 py-4 text-[10px] font-black text-white/20 uppercase tracking-widest">Date</th>
                                        <th className="px-6 py-4 text-[10px] font-black text-white/20 uppercase tracking-widest">Status</th>
                                        <th className="px-6 py-4 text-[10px] font-black text-white/20 uppercase tracking-widest text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/5">
                                    {(() => {
                                        const filtered = payoutRequests.filter((pr) => {
                                            const name = pr.commanders?.user?.full_name?.toLowerCase() || '';
                                            return name.includes(payoutSearch.toLowerCase());
                                        });
                                        if (filtered.length === 0) {
                                            return (
                                                <tr>
                                                    <td colSpan={6} className="px-6 py-16 text-center">
                                                        <Banknote className="mx-auto text-white/20 mb-3" size={32} />
                                                        <p className="text-white/40 text-sm font-black uppercase tracking-widest">
                                                            {payoutSearch ? 'No matching payouts' : 'No payout requests'}
                                                        </p>
                                                    </td>
                                                </tr>
                                            );
                                        }
                                        return filtered.map((pr) => {
                                            const isPending = pr.status === 'pending';
                                            const isBusy = actionLoading === `payout-${pr.id}`;
                                            const isExpanded = payoutExpanded === pr.id;
                                            const commander = pr.commanders;
                                            return (
                                                <React.Fragment key={pr.id}>
                                                    <tr className={`hover:bg-white/[0.02] transition-colors ${isPending ? 'bg-emerald-500/[0.02]' : ''}`}>
                                                        <td className="px-6 py-4">
                                                            <div className="flex items-center gap-3">
                                                                <div className={`w-10 h-10 rounded-xl flex items-center justify-center border ${
                                                                    isPending
                                                                        ? 'bg-emerald-500/10 border-emerald-500/20'
                                                                        : 'bg-white/5 border-white/10'
                                                                }`}>
                                                                    <Banknote size={16} className={isPending ? 'text-emerald-400' : 'text-white/20'} />
                                                                </div>
                                                                <div>
                                                                    <p className="text-sm font-black text-white">
                                                                        {commander?.user?.full_name || 'Unknown Commander'}
                                                                    </p>
                                                                    <p className="text-[10px] text-white/30 uppercase tracking-widest">
                                                                        {commander?.territory ? `${commander.territory.name} (${commander.territory.code})` : 'No territory'}
                                                                    </p>
                                                                </div>
                                                            </div>
                                                        </td>
                                                        <td className="px-6 py-4">
                                                            <p className="text-sm font-black text-white">{fmtTTD(pr.amount_cents)}</p>
                                                        </td>
                                                        <td className="px-6 py-4">
                                                            <span className="text-[9px] font-black px-2.5 py-1 rounded-md border uppercase tracking-widest ${
                                                                pr.payment_method === 'bank_transfer'
                                                                    ? 'text-cyan-400 bg-cyan-400/10 border-cyan-500/20'
                                                                    : pr.payment_method === 'wipay_cash_code'
                                                                    ? 'text-purple-400 bg-purple-400/10 border-purple-500/20'
                                                                    : 'text-white/30 bg-white/5 border-white/10'
                                                            }">
                                                                {pr.payment_method?.replace('_', ' ') || 'unspecified'}
                                                            </span>
                                                        </td>
                                                        <td className="px-6 py-4">
                                                            <span className="text-xs text-white/60 font-mono">
                                                                {new Date(pr.created_at).toLocaleDateString('en-TT', { day: 'numeric', month: 'short' })}
                                                            </span>
                                                        </td>
                                                        <td className="px-6 py-4">
                                                            <span className={`text-[9px] font-black px-2.5 py-1 rounded-md border uppercase tracking-widest ${
                                                                pr.status === 'pending' ? 'text-amber-400 bg-amber-400/10 border-amber-500/20 animate-pulse-slow' :
                                                                pr.status === 'approved' || pr.status === 'completed' ? 'text-green-400 bg-green-400/10 border-green-500/20' :
                                                                'text-red-400 bg-red-400/10 border-red-500/20'
                                                            }`}>
                                                                {pr.status}
                                                            </span>
                                                        </td>
                                                        <td className="px-6 py-4 text-right">
                                                            <div className="flex items-center justify-end gap-2">
                                                                {isPending && (
                                                                    <>
                                                                        <button
                                                                            onClick={() => handlePayoutAction(pr.id, 'approved')}
                                                                            disabled={isBusy}
                                                                            className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500/10 text-green-400 border border-green-500/20 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-green-500/20 transition-all disabled:opacity-50"
                                                                        >
                                                                            <CheckCircle size={14} /> Pay
                                                                        </button>
                                                                        <button
                                                                            onClick={() => handlePayoutAction(pr.id, 'rejected')}
                                                                            disabled={isBusy}
                                                                            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-red-500/20 transition-all disabled:opacity-50"
                                                                        >
                                                                            <Ban size={14} /> Deny
                                                                        </button>
                                                                    </>
                                                                )}
                                                                {pr.bank_details && (
                                                                    <button
                                                                        onClick={() => setPayoutExpanded(isExpanded ? null : pr.id)}
                                                                        className="p-1.5 text-white/20 hover:text-white/60 transition-colors"
                                                                    >
                                                                        {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                                                                    </button>
                                                                )}
                                                                {isBusy && <div className="w-4 h-4 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />}
                                                            </div>
                                                        </td>
                                                    </tr>
                                                    {isExpanded && pr.bank_details && (
                                                        <tr className="bg-white/[0.01]">
                                                            <td colSpan={6} className="px-6 py-4">
                                                                <div className="flex items-start gap-4 p-4 bg-black/30 rounded-2xl border border-white/5">
                                                                    <ExternalLink size={14} className="text-white/30 mt-0.5 shrink-0" />
                                                                    <div className="grid grid-cols-2 gap-4 text-xs">
                                                                        {Object.entries(pr.bank_details).map(([key, val]) => (
                                                                            <div key={key}>
                                                                                <p className="text-[9px] font-bold text-white/30 uppercase tracking-widest mb-1">{key.replace(/_/g, ' ')}</p>
                                                                                <p className="text-white font-mono font-bold">{String(val)}</p>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    )}
                                                </React.Fragment>
                                            );
                                        });
                                    })()}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </section>

            {/* ─── PENDING APPLICATIONS ─── */}
            <section className="space-y-3">
                <div className="flex items-center gap-3">
                    <Inbox size={16} className="text-amber-400" />
                    <h3 className="text-sm font-black text-white uppercase tracking-widest">Pending Applications</h3>
                    {pendingApplications.length > 0 && (
                        <span className="text-[10px] font-black px-2 py-0.5 rounded-md bg-amber-400/10 text-amber-400 border border-amber-500/20">
                            {pendingApplications.length}
                        </span>
                    )}
                </div>

                <div className="bg-white/5 border border-white/10 rounded-[2.5rem] overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead>
                                <tr className="bg-white/[0.01] border-b border-white/5">
                                    <th className="px-6 py-4 text-[10px] font-black text-white/20 uppercase tracking-widest">Applicant</th>
                                    <th className="px-6 py-4 text-[10px] font-black text-white/20 uppercase tracking-widest">Phone / Area</th>
                                    <th className="px-6 py-4 text-[10px] font-black text-white/20 uppercase tracking-widest">Why</th>
                                    <th className="px-6 py-4 text-[10px] font-black text-white/20 uppercase tracking-widest text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                {pendingApplications.length === 0 ? (
                                    <tr>
                                        <td colSpan={4} className="px-6 py-16 text-center">
                                            <ShieldAlert className="mx-auto text-white/20 mb-3" size={32} />
                                            <p className="text-white/40 text-sm font-black uppercase tracking-widest">No Pending Applications</p>
                                        </td>
                                    </tr>
                                ) : pendingApplications.map(app => {
                                    const isBusy = actionLoading === `app-${app.id}`;
                                    return (
                                        <tr key={app.id} className="hover:bg-white/[0.02] align-top">
                                            <td className="px-6 py-4">
                                                <p className="text-sm font-black text-white">{app.full_name}</p>
                                                <p className="text-[10px] text-white/30 uppercase tracking-widest">{app.user?.email || 'No email'}</p>
                                                {app.referral_code && (
                                                    <p className="text-[10px] text-cyan-400/70 mt-1">REF: {app.referral_code}</p>
                                                )}
                                            </td>
                                            <td className="px-6 py-4">
                                                <p className="text-xs font-bold text-white/80">{app.phone}</p>
                                                <p className="text-[10px] text-white/40 mt-1">{app.area}</p>
                                                {app.current_role && (
                                                    <p className="text-[10px] text-white/30 mt-1">{app.current_role}</p>
                                                )}
                                            </td>
                                            <td className="px-6 py-4 max-w-xs">
                                                <p className="text-xs text-white/60 leading-relaxed">{app.reasoning}</p>
                                            </td>
                                            <td className="px-6 py-4 text-right">
                                                <div className="flex items-center justify-end gap-2">
                                                    <button
                                                        onClick={() => reviewApplication(app.id, 'approve_application')}
                                                        disabled={isBusy}
                                                        className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500/10 text-green-400 border border-green-500/20 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-green-500/20 transition-all disabled:opacity-50"
                                                    >
                                                        <CheckCircle size={14} /> Approve
                                                    </button>
                                                    <button
                                                        onClick={() => reviewApplication(app.id, 'reject_application')}
                                                        disabled={isBusy}
                                                        className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-red-500/20 transition-all disabled:opacity-50"
                                                    >
                                                        <XCircle size={14} /> Reject
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            </section>

            {/* ─── ACTIVE COMMANDERS ─── */}
            <section className="space-y-3">
                <div className="flex items-center gap-3">
                    <Shield size={16} className="text-cyan-400" />
                    <h3 className="text-sm font-black text-white uppercase tracking-widest">Commanders</h3>
                </div>

                <div className="bg-white/5 border border-white/10 rounded-[2.5rem] overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead>
                                <tr className="bg-white/[0.01] border-b border-white/5">
                                    <th className="px-6 py-4 text-[10px] font-black text-white/20 uppercase tracking-widest">Commander</th>
                                    <th className="px-6 py-4 text-[10px] font-black text-white/20 uppercase tracking-widest">Status</th>
                                    <th className="px-6 py-4 text-[10px] font-black text-white/20 uppercase tracking-widest">Assigned Territory</th>
                                    <th className="px-6 py-4 text-[10px] font-black text-white/20 uppercase tracking-widest text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                {commanders.length === 0 ? (
                                    <tr>
                                        <td colSpan={4} className="px-6 py-16 text-center">
                                            <ShieldAlert className="mx-auto text-white/20 mb-3" size={32} />
                                            <p className="text-white/40 text-sm font-black uppercase tracking-widest">No Active Commanders</p>
                                        </td>
                                    </tr>
                                ) : commanders.map(cmd => {
                                    const isActive = cmd.status === 'active';
                                    const isBusyStatus = actionLoading === `status-${cmd.user_id}`;
                                    const isBusyTerritory = actionLoading === `territory-${cmd.user_id}`;

                                    return (
                                        <tr key={cmd.id} className="hover:bg-white/[0.02]">
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-3">
                                                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isActive ? 'bg-cyan-500/10' : 'bg-white/5'}`}>
                                                        <Shield size={18} className={isActive ? 'text-cyan-400' : 'text-white/20'} />
                                                    </div>
                                                    <div>
                                                        <p className="text-sm font-black text-white">{cmd.user?.full_name || 'Unknown'}</p>
                                                        <p className="text-[10px] text-white/30 uppercase tracking-widest">{cmd.user?.email || 'No email'}</p>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className={`text-[10px] font-black px-2.5 py-1 rounded-md border uppercase tracking-widest ${
                                                    isActive ? 'text-cyan-400 bg-cyan-400/10 border-cyan-500/20' :
                                                    'text-red-400 bg-red-400/10 border-red-500/20'
                                                }`}>
                                                    {cmd.status}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-2">
                                                    <Map size={14} className="text-white/20" />
                                                    <select
                                                        value={cmd.territory?.id || ''}
                                                        onChange={(e) => assignTerritory(cmd.user_id, e.target.value)}
                                                        disabled={isBusyTerritory || !isActive}
                                                        className="bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 text-white text-xs font-bold focus:outline-none focus:border-cyan-400/50 disabled:opacity-50 appearance-none min-w-[140px]"
                                                    >
                                                        <option value="">— Unassigned —</option>
                                                        {territories.map(t => (
                                                            <option key={t.id} value={t.id}>{t.name} ({t.code})</option>
                                                        ))}
                                                    </select>
                                                    {isBusyTerritory && <div className="w-3 h-3 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-right">
                                                <div className="flex items-center justify-end gap-2">
                                                    {isActive ? (
                                                        <button
                                                            onClick={() => updateStatus(cmd.user_id, 'suspended')}
                                                            disabled={isBusyStatus}
                                                            className="px-3 py-1.5 bg-white/5 text-white/50 border border-white/10 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-white/10 hover:text-white transition-all disabled:opacity-50"
                                                        >
                                                            Suspend
                                                        </button>
                                                    ) : (
                                                        <button
                                                            onClick={() => updateStatus(cmd.user_id, 'active')}
                                                            disabled={isBusyStatus}
                                                            className="px-3 py-1.5 bg-green-500/10 text-green-400 border border-green-500/20 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-green-500/20 transition-all disabled:opacity-50"
                                                        >
                                                            Reactivate
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            </section>
        </div>
    );
}
