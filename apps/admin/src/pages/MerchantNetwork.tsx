import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { Store, RefreshCw, CheckCircle, Clock, AlertTriangle, XCircle, Ban, MapPin, DollarSign, Calendar, ChevronDown, ChevronUp, Package, Wifi } from 'lucide-react';

interface MerchantRow {
    id: string;
    name: string;
    category: string;
    address: string | null;
    lat: number | null;
    lng: number | null;
    is_active: boolean;
    commission_rate: number;
    created_at: string;
    subscription: {
        id: string;
        status: 'trial' | 'active' | 'overdue' | 'suspended' | 'cancelled';
        trial_start_at: string;
        trial_end_at: string;
        monthly_fee_cents: number;
        next_billing_at: string | null;
        last_billed_at: string | null;
        overdue_since: string | null;
    } | null;
}

interface MerchantDetail {
    orders: Array<{ id: string; status: string; total_cents: number; created_at: string; delivery_method: string }>;
    nodes: Array<{ id: string; location_name: string; nfc_uid: string | null; is_active: boolean; tap_count: number }>;
}

const STATUS_META: Record<string, { label: string; color: string; icon: any }> = {
    trial:     { label: 'Trial',     color: 'text-cyan-400 bg-cyan-400/10 border-cyan-400/30',     icon: Clock },
    active:    { label: 'Active',    color: 'text-green-400 bg-green-400/10 border-green-400/30',   icon: CheckCircle },
    overdue:   { label: 'Overdue',   color: 'text-amber-400 bg-amber-400/10 border-amber-400/30',   icon: AlertTriangle },
    suspended: { label: 'Suspended', color: 'text-red-400 bg-red-400/10 border-red-400/30',         icon: Ban },
    cancelled: { label: 'Cancelled', color: 'text-white/30 bg-white/5 border-white/10',             icon: XCircle },
};

function fmt(iso: string | null) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-TT', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtTTD(cents: number) {
    return `TTD $${(cents / 100).toFixed(0)}`;
}

function daysLeft(iso: string) {
    const diff = new Date(iso).getTime() - Date.now();
    const d = Math.ceil(diff / 86400000);
    return d > 0 ? `${d}d left` : 'Expired';
}

export function MerchantNetwork() {
    const [merchants, setMerchants] = useState<MerchantRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [filter, setFilter] = useState<'all' | 'trial' | 'active' | 'overdue' | 'suspended'>('all');
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [details, setDetails] = useState<Record<string, MerchantDetail>>({});
    const [detailLoading, setDetailLoading] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const { data, error: err } = await supabase
                .from('merchants')
                .select(`
                    id, name, category, address, lat, lng, is_active, commission_rate, created_at,
                    merchant_subscriptions (
                        id, status, trial_start_at, trial_end_at,
                        monthly_fee_cents, next_billing_at, last_billed_at, overdue_since
                    )
                `)
                .order('created_at', { ascending: false });

            if (err) throw err;
            const rows: MerchantRow[] = (data || []).map((m: any) => ({
                ...m,
                subscription: m.merchant_subscriptions?.[0] ?? null,
            }));
            setMerchants(rows);
        } catch (e: any) {
            setError(e.message || 'Failed to load merchants');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const loadDetail = useCallback(async (merchantId: string) => {
        if (details[merchantId]) return;
        setDetailLoading(merchantId);
        const [ordersRes, nodesRes] = await Promise.all([
            supabase
                .from('orders')
                .select('id, status, total_cents, created_at, delivery_method')
                .eq('merchant_id', merchantId)
                .order('created_at', { ascending: false })
                .limit(10),
            supabase
                .from('kiosk_nodes')
                .select('id, location_name, nfc_uid, is_active')
                .eq('merchant_id', merchantId)
                .order('created_at', { ascending: false }),
        ]);

        const nodes = (nodesRes.data || []) as any[];
        const nfcUids = nodes.map(n => n.nfc_uid).filter(Boolean);

        let tapCounts: Record<string, number> = {};
        if (nfcUids.length > 0) {
            const { data: tapData } = await supabase
                .from('nfc_event_logs')
                .select('tag_uid')
                .in('tag_uid', nfcUids)
                .gte('created_at', new Date(Date.now() - 30 * 86400000).toISOString());
            for (const row of tapData || []) {
                tapCounts[row.tag_uid] = (tapCounts[row.tag_uid] || 0) + 1;
            }
        }

        setDetails(prev => ({
            ...prev,
            [merchantId]: {
                orders: (ordersRes.data || []) as MerchantDetail['orders'],
                nodes: nodes.map(n => ({ ...n, tap_count: tapCounts[n.nfc_uid] || 0 })),
            },
        }));
        setDetailLoading(null);
    }, [details]);

    const toggleExpand = (merchantId: string) => {
        if (expandedId === merchantId) {
            setExpandedId(null);
        } else {
            setExpandedId(merchantId);
            loadDetail(merchantId);
        }
    };

    const setStatus = async (subId: string, status: string, extra: Record<string, any> = {}) => {
        setActionLoading(subId + status);
        const { error: err } = await supabase
            .from('merchant_subscriptions')
            .update({ status, ...extra })
            .eq('id', subId);
        if (err) alert(err.message);
        else await load();
        setActionLoading(null);
    };

    const extendTrial = async (subId: string) => {
        setActionLoading(subId + 'extend');
        const newEnd = new Date(Date.now() + 30 * 86400000).toISOString();
        const { error: err } = await supabase
            .from('merchant_subscriptions')
            .update({ trial_end_at: newEnd, status: 'trial' })
            .eq('id', subId);
        if (err) alert(err.message);
        else await load();
        setActionLoading(null);
    };

    const setFee = async (subId: string) => {
        const input = prompt('New monthly fee in TTD (e.g. 150):');
        if (!input || isNaN(Number(input))) return;
        const cents = Math.round(Number(input) * 100);
        const { error: err } = await supabase
            .from('merchant_subscriptions')
            .update({ monthly_fee_cents: cents })
            .eq('id', subId);
        if (err) alert(err.message);
        else await load();
    };

    const toggleActive = async (merchantId: string, current: boolean) => {
        setActionLoading(merchantId + 'toggle');
        await supabase.from('merchants').update({ is_active: !current }).eq('id', merchantId);
        await load();
        setActionLoading(null);
    };

    const runBilling = async () => {
        setActionLoading('billing');
        const { data, error: err } = await supabase.rpc('process_merchant_billing');
        if (err) alert(err.message);
        else alert(`Billing run complete.\nActivated: ${data.activated}\nCharged: ${data.charged}\nOverdue: ${data.overdue}`);
        await load();
        setActionLoading(null);
    };

    const visible = filter === 'all'
        ? merchants
        : merchants.filter(m => m.subscription?.status === filter);

    const counts = {
        all:       merchants.length,
        trial:     merchants.filter(m => m.subscription?.status === 'trial').length,
        active:    merchants.filter(m => m.subscription?.status === 'active').length,
        overdue:   merchants.filter(m => m.subscription?.status === 'overdue').length,
        suspended: merchants.filter(m => m.subscription?.status === 'suspended').length,
    };

    return (
        <div className="space-y-8">
            {/* Header row */}
            <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                    <h3 className="text-xl font-black text-white tracking-tight">Merchant Network</h3>
                    <p className="text-xs text-white/30 uppercase tracking-widest mt-1">Subscriptions · Map Visibility · Billing · NFC Activity</p>
                </div>
                <div className="flex gap-3">
                    <button
                        onClick={runBilling}
                        disabled={actionLoading === 'billing'}
                        className="flex items-center gap-2 px-4 py-2 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-400 text-xs font-black uppercase tracking-widest hover:bg-amber-500/20 transition-all disabled:opacity-40"
                    >
                        <DollarSign size={14} />
                        {actionLoading === 'billing' ? 'Running…' : 'Run Billing Now'}
                    </button>
                    <button
                        onClick={load}
                        className="flex items-center gap-2 px-4 py-2 bg-white/5 border border-white/10 rounded-xl text-white/60 text-xs font-black uppercase tracking-widest hover:bg-white/10 transition-all"
                    >
                        <RefreshCw size={14} />
                        Refresh
                    </button>
                </div>
            </div>

            {/* Summary chips */}
            <div className="flex flex-wrap gap-3">
                {(['all', 'trial', 'active', 'overdue', 'suspended'] as const).map(f => (
                    <button
                        key={f}
                        onClick={() => setFilter(f)}
                        className={`px-4 py-2 rounded-xl border text-xs font-black uppercase tracking-widest transition-all ${
                            filter === f
                                ? 'bg-white/10 border-white/30 text-white'
                                : 'bg-white/0 border-white/10 text-white/40 hover:bg-white/5'
                        }`}
                    >
                        {f === 'all' ? 'All' : STATUS_META[f].label} ({counts[f]})
                    </button>
                ))}
            </div>

            {error && (
                <div className="p-4 bg-red-900/30 border border-red-500/40 rounded-xl text-red-300 text-sm">{error}</div>
            )}

            {loading ? (
                <div className="flex items-center justify-center py-20">
                    <RefreshCw size={24} className="text-white/30 animate-spin" />
                </div>
            ) : visible.length === 0 ? (
                <div className="py-20 text-center text-white/20 text-sm uppercase tracking-widest">No merchants found</div>
            ) : (
                <div className="space-y-4">
                    {visible.map(m => {
                        const sub = m.subscription;
                        const meta = sub ? STATUS_META[sub.status] : null;
                        const StatusIcon = meta?.icon ?? Store;
                        const onMap = sub && (sub.status === 'trial' || sub.status === 'active') && m.is_active && m.lat;
                        const isExpanded = expandedId === m.id;
                        const detail = details[m.id];

                        return (
                            <div key={m.id} className="bg-white/[0.03] border border-white/[0.08] rounded-2xl overflow-hidden">
                                {/* Top row */}
                                <div className="p-6 space-y-4">
                                    <div className="flex flex-wrap items-start justify-between gap-4">
                                        <div className="flex items-start gap-4">
                                            <div className="w-10 h-10 rounded-xl bg-purple-500/20 flex items-center justify-center shrink-0">
                                                <Store size={18} className="text-purple-400" />
                                            </div>
                                            <div>
                                                <p className="font-black text-white text-base">{m.name}</p>
                                                <p className="text-xs text-white/40 uppercase tracking-widest mt-0.5">{m.category}</p>
                                                {m.address && <p className="text-xs text-white/25 mt-1">{m.address}</p>}
                                            </div>
                                        </div>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className={`flex items-center gap-1.5 px-3 py-1 rounded-full border text-[10px] font-black uppercase tracking-widest ${
                                                onMap
                                                    ? 'text-cyan-400 bg-cyan-400/10 border-cyan-400/30'
                                                    : 'text-white/20 bg-white/5 border-white/10'
                                            }`}>
                                                <MapPin size={10} />
                                                {onMap ? 'On Map' : 'Hidden'}
                                            </span>
                                            {meta && (
                                                <span className={`flex items-center gap-1.5 px-3 py-1 rounded-full border text-[10px] font-black uppercase tracking-widest ${meta.color}`}>
                                                    <StatusIcon size={10} />
                                                    {meta.label}
                                                </span>
                                            )}
                                            <button
                                                onClick={() => toggleActive(m.id, m.is_active)}
                                                disabled={actionLoading === m.id + 'toggle'}
                                                className={`px-3 py-1 rounded-full border text-[10px] font-black uppercase tracking-widest transition-all ${
                                                    m.is_active
                                                        ? 'text-green-400 border-green-400/30 bg-green-400/10 hover:bg-red-400/10 hover:text-red-400 hover:border-red-400/30'
                                                        : 'text-red-400 border-red-400/30 bg-red-400/10 hover:bg-green-400/10 hover:text-green-400 hover:border-green-400/30'
                                                }`}
                                            >
                                                {m.is_active ? 'Active' : 'Deactivated'}
                                            </button>
                                            {/* Drill-down toggle */}
                                            <button
                                                onClick={() => toggleExpand(m.id)}
                                                className="flex items-center gap-1.5 px-3 py-1 rounded-full border border-white/10 text-[10px] font-black uppercase tracking-widest text-white/40 hover:text-white hover:bg-white/5 transition-all"
                                            >
                                                {isExpanded ? <ChevronUp size={10}/> : <ChevronDown size={10}/>}
                                                {isExpanded ? 'Collapse' : 'Activity'}
                                            </button>
                                        </div>
                                    </div>

                                    {/* Subscription details */}
                                    {sub && (
                                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                            <div className="bg-white/[0.03] rounded-xl p-3">
                                                <p className="text-[9px] text-white/30 uppercase tracking-widest mb-1">Monthly Fee</p>
                                                <p className="text-sm font-black text-white">{fmtTTD(sub.monthly_fee_cents)}</p>
                                            </div>
                                            <div className="bg-white/[0.03] rounded-xl p-3">
                                                <p className="text-[9px] text-white/30 uppercase tracking-widest mb-1">
                                                    {sub.status === 'trial' ? 'Trial Ends' : 'Next Billing'}
                                                </p>
                                                <p className="text-sm font-black text-white">
                                                    {sub.status === 'trial'
                                                        ? <span>{fmt(sub.trial_end_at)} <span className="text-cyan-400 text-xs">({daysLeft(sub.trial_end_at)})</span></span>
                                                        : fmt(sub.next_billing_at)
                                                    }
                                                </p>
                                            </div>
                                            <div className="bg-white/[0.03] rounded-xl p-3">
                                                <p className="text-[9px] text-white/30 uppercase tracking-widest mb-1">Last Charged</p>
                                                <p className="text-sm font-black text-white">{fmt(sub.last_billed_at)}</p>
                                            </div>
                                            <div className="bg-white/[0.03] rounded-xl p-3">
                                                <p className="text-[9px] text-white/30 uppercase tracking-widest mb-1">Joined</p>
                                                <p className="text-sm font-black text-white">{fmt(sub.trial_start_at)}</p>
                                            </div>
                                        </div>
                                    )}

                                    {/* Admin action buttons */}
                                    {sub && (
                                        <div className="flex flex-wrap gap-2 pt-1 border-t border-white/5">
                                            <button
                                                onClick={() => extendTrial(sub.id)}
                                                disabled={!!actionLoading}
                                                className="flex items-center gap-1.5 px-3 py-1.5 bg-cyan-500/10 border border-cyan-500/20 rounded-lg text-cyan-400 text-[10px] font-black uppercase tracking-widest hover:bg-cyan-500/20 transition-all disabled:opacity-40"
                                            >
                                                <Calendar size={11} />
                                                +30 Day Trial
                                            </button>
                                            {sub.status !== 'active' && (
                                                <button
                                                    onClick={() => setStatus(sub.id, 'active', { next_billing_at: new Date(Date.now() + 30 * 86400000).toISOString(), overdue_since: null })}
                                                    disabled={!!actionLoading}
                                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500/10 border border-green-500/20 rounded-lg text-green-400 text-[10px] font-black uppercase tracking-widest hover:bg-green-500/20 transition-all disabled:opacity-40"
                                                >
                                                    <CheckCircle size={11} />
                                                    Force Active
                                                </button>
                                            )}
                                            {(sub.status === 'active' || sub.status === 'overdue' || sub.status === 'trial') && (
                                                <button
                                                    onClick={() => setStatus(sub.id, 'suspended')}
                                                    disabled={!!actionLoading}
                                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-[10px] font-black uppercase tracking-widest hover:bg-red-500/20 transition-all disabled:opacity-40"
                                                >
                                                    <Ban size={11} />
                                                    Suspend
                                                </button>
                                            )}
                                            {sub.status === 'suspended' && (
                                                <button
                                                    onClick={() => setStatus(sub.id, 'active', { overdue_since: null, next_billing_at: new Date(Date.now() + 30 * 86400000).toISOString() })}
                                                    disabled={!!actionLoading}
                                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-500/10 border border-purple-500/20 rounded-lg text-purple-400 text-[10px] font-black uppercase tracking-widest hover:bg-purple-500/20 transition-all disabled:opacity-40"
                                                >
                                                    <CheckCircle size={11} />
                                                    Reactivate
                                                </button>
                                            )}
                                            {sub.status !== 'cancelled' && (
                                                <button
                                                    onClick={() => { if (confirm(`Cancel subscription for ${m.name}? They will leave the map.`)) setStatus(sub.id, 'cancelled'); }}
                                                    disabled={!!actionLoading}
                                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-white/30 text-[10px] font-black uppercase tracking-widest hover:bg-red-500/10 hover:text-red-400 hover:border-red-400/20 transition-all disabled:opacity-40"
                                                >
                                                    <XCircle size={11} />
                                                    Cancel
                                                </button>
                                            )}
                                            <button
                                                onClick={() => setFee(sub.id)}
                                                disabled={!!actionLoading}
                                                className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/10 border border-amber-500/20 rounded-lg text-amber-400 text-[10px] font-black uppercase tracking-widest hover:bg-amber-500/20 transition-all disabled:opacity-40"
                                            >
                                                <DollarSign size={11} />
                                                Set Fee
                                            </button>
                                        </div>
                                    )}
                                </div>

                                {/* ── DRILL-DOWN: Orders + NFC Activity ── */}
                                {isExpanded && (
                                    <div className="border-t border-white/5 bg-black/20 p-6 space-y-6">
                                        {detailLoading === m.id ? (
                                            <div className="flex items-center justify-center py-8">
                                                <RefreshCw size={18} className="text-white/30 animate-spin" />
                                            </div>
                                        ) : detail ? (
                                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                                {/* Recent Orders */}
                                                <div>
                                                    <div className="flex items-center gap-2 mb-3">
                                                        <Package size={14} className="text-purple-400" />
                                                        <p className="text-xs font-black text-white/60 uppercase tracking-widest">Recent Orders ({detail.orders.length})</p>
                                                    </div>
                                                    {detail.orders.length === 0 ? (
                                                        <p className="text-white/20 text-xs italic">No orders yet</p>
                                                    ) : (
                                                        <div className="space-y-2">
                                                            {detail.orders.map(order => (
                                                                <div key={order.id} className="flex items-center justify-between p-3 bg-white/5 rounded-xl border border-white/5">
                                                                    <div>
                                                                        <p className="text-[10px] font-black text-white/60 font-mono">{order.id.slice(0, 8).toUpperCase()}</p>
                                                                        <p className="text-[9px] text-white/30 mt-0.5">{new Date(order.created_at).toLocaleString('en-TT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
                                                                    </div>
                                                                    <div className="text-right">
                                                                        <OrderStatusBadge status={order.status} />
                                                                        <p className="text-xs font-black text-white mt-1">{fmtTTD(order.total_cents)}</p>
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>

                                                {/* NFC Nodes */}
                                                <div>
                                                    <div className="flex items-center gap-2 mb-3">
                                                        <Wifi size={14} className="text-cyan-400" />
                                                        <p className="text-xs font-black text-white/60 uppercase tracking-widest">NFC Nodes ({detail.nodes.length})</p>
                                                    </div>
                                                    {detail.nodes.length === 0 ? (
                                                        <p className="text-white/20 text-xs italic">No NFC nodes registered</p>
                                                    ) : (
                                                        <div className="space-y-2">
                                                            {detail.nodes.map(node => (
                                                                <div key={node.id} className="flex items-center justify-between p-3 bg-white/5 rounded-xl border border-white/5">
                                                                    <div>
                                                                        <p className="text-xs font-black text-white">{node.location_name || 'Unnamed Node'}</p>
                                                                        {node.nfc_uid && <p className="text-[9px] text-white/30 font-mono mt-0.5">{node.nfc_uid}</p>}
                                                                    </div>
                                                                    <div className="text-right">
                                                                        <span className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded border ${node.is_active ? 'text-green-400 border-green-400/30 bg-green-400/10' : 'text-white/20 border-white/10 bg-white/5'}`}>
                                                                            {node.is_active ? 'Online' : 'Offline'}
                                                                        </span>
                                                                        <p className="text-[10px] text-cyan-400 font-black mt-1">{node.tap_count} taps <span className="text-white/20 font-normal">30d</span></p>
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        ) : null}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

const OrderStatusBadge = ({ status }: any) => {
    const map: any = {
        delivered: 'text-green-400 bg-green-400/10 border-green-400/20',
        pending:   'text-white/40 bg-white/5 border-white/10',
        processing: 'text-blue-400 bg-blue-400/10 border-blue-400/20',
        ready:     'text-purple-400 bg-purple-400/10 border-purple-400/20',
        cancelled: 'text-red-400 bg-red-400/10 border-red-400/20',
    };
    return (
        <span className={`text-[9px] font-black px-2 py-0.5 rounded border uppercase tracking-tight ${map[status] || 'text-white/30 bg-white/5 border-white/5'}`}>
            {status}
        </span>
    );
};
