import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Shield, ShieldAlert, CheckCircle, XCircle, Map, RefreshCw, Inbox, DollarSign, TrendingUp, Clock } from 'lucide-react';

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
