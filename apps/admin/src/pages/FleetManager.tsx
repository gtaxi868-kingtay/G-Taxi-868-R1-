import { useState, useEffect, useCallback } from 'react';
import { supabase, adminFetch } from '../lib/supabase';
import {
  Users, Truck, AlertCircle, Shield, Ban, CheckCircle2,
  Activity, ShoppingBag, Zap, TrendingUp, Clock, ExternalLink,
  ChevronDown, ChevronUp, Loader2, DollarSign, Car, Star,
} from 'lucide-react';

interface FleaseLease {
    id: string;
    status: string;
    start_date: string;
    end_date: string | null;
    lease_type: string;
    daily_rate_cents: number;
    security_deposit_cents: number;
    deposit_paid: boolean;
    termination_reason: string | null;
    drivers: { profiles: { name: string } | null } | null;
    fleet_vehicles: { make: string; model: string; year: number; license_plate: string; ownership_type: string } | null;
}

const fmtTTD = (cents: number) => `$${(cents / 100).toFixed(2)} TTD`;
const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString('en-TT', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

interface PendingActivation {
    id: string;
    driver_id: string;
    fleet_vehicle_id: string | null;
    status: string;
    daily_deduction_cents: number;
    total_lease_cents: number | null;
    proof_of_income: any;
    created_at: string;
    drivers: {
        id: string;
        user_id: string;
        rating: number | null;
        rides_count: number | null;
        profiles: { full_name: string; email: string } | null;
    } | null;
    fleet_vehicles: {
        make: string; model: string; year: number;
        license_plate: string; ownership_type: string;
    } | null;
}

function calculateRiskScore(driver: PendingActivation['drivers'], income: any): {
    score: number; label: string; color: string;
} {
    const rides = driver?.rides_count || 0;
    const rating = driver?.rating || 0;
    const avgRide = income?.avg_per_ride_cents || 0;
    let score = 0;
    if (rides >= 1000) score += 35;
    else if (rides >= 500) score += 25;
    else if (rides >= 200) score += 15;
    else score += 5;
    if (rating >= 4.9) score += 30;
    else if (rating >= 4.8) score += 25;
    else if (rating >= 4.5) score += 15;
    else if (rating >= 4.0) score += 10;
    else score += 5;
    if (avgRide >= 4000) score += 35;
    else if (avgRide >= 3000) score += 25;
    else if (avgRide >= 2000) score += 15;
    else score += 5;
    const label = score >= 80 ? 'Low Risk' : score >= 55 ? 'Medium Risk' : 'High Risk';
    const color = score >= 80 ? 'text-green-400 border-green-500/20 bg-green-400/10'
                 : score >= 55 ? 'text-amber-400 border-amber-500/20 bg-amber-400/10'
                 : 'text-red-400 border-red-500/20 bg-red-400/10';
    return { score, label, color };
}

export const FleetManager = ({ allUsers, rides, orders, onRefresh }: any) => {
    const [tab, setTab] = useState<'personnel' | 'operations' | 'logistics'>('operations');
    const [opsView, setOpsView] = useState<'rides' | 'food'>('rides');
    const [leases, setLeases] = useState<FleaseLease[]>([]);
    const [leasesLoading, setLeasesLoading] = useState(false);
    const [activatorView, setActivatorView] = useState<'pending' | 'active'>('pending');

    const [pendingActivations, setPendingActivations] = useState<PendingActivation[]>([]);
    const [activationsLoading, setActivationsLoading] = useState(false);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [expandedActivation, setExpandedActivation] = useState<string | null>(null);

    const loadLeases = useCallback(async () => {
        setLeasesLoading(true);
        const { data } = await supabase
            .from('fleet_leases')
            .select(`
                id, status, start_date, end_date, lease_type,
                daily_rate_cents, security_deposit_cents, deposit_paid,
                termination_reason,
                drivers!inner(profiles(name)),
                fleet_vehicles!inner(make, model, year, license_plate, ownership_type)
            `)
            .order('created_at', { ascending: false })
            .limit(50);
        setLeases((data as FleaseLease[]) || []);
        setLeasesLoading(false);
    }, []);

    useEffect(() => {
        if (tab === 'logistics') loadLeases();
    }, [tab, loadLeases]);

    const loadActivations = useCallback(async () => {
        setActivationsLoading(true);
        try {
            const { data } = await supabase
                .from('driver_leases')
                .select(`
                    id, driver_id, fleet_vehicle_id, status,
                    daily_deduction_cents, total_lease_cents,
                    proof_of_income, created_at,
                    drivers!inner(
                        id, user_id, rating, rides_count,
                        profiles!inner(full_name, email)
                    ),
                    fleet_vehicles!left(
                        make, model, year, license_plate, ownership_type
                    )
                `)
                .order('created_at', { ascending: false })
                .limit(50);
            setPendingActivations((data as unknown as PendingActivation[]) || []);
        } catch (err) {
            console.error('[FleetManager] loadActivations error:', err);
        } finally {
            setActivationsLoading(false);
        }
    }, []);

    useEffect(() => {
        if (tab === 'logistics') {
            loadLeases();
            loadActivations();
        }
    }, [tab, loadLeases, loadActivations]);

    const handleActivateLease = async (leaseId: string, driverId: string) => {
        if (!window.confirm('Activate this Term Finance lease? This will enable auto-deductions from driver earnings.')) return;
        setActionLoading(leaseId);
        try {
            const { data, error } = await supabase.rpc('approve_driver_lease', {
                p_lease_id: leaseId,
                p_driver_id: driverId,
            });
            if (error) throw error;
            if (data === false) {
                alert('RPC returned false — check permissions or lease status.');
            }
            await loadActivations();
            await loadLeases();
        } catch (err: any) {
            alert('Activation failed: ' + (err.message || 'Unknown error'));
        } finally {
            setActionLoading(null);
        }
    };

    const handleRejectLease = async (leaseId: string) => {
        if (!window.confirm('Reject this lease application? The driver will be notified.')) return;
        setActionLoading(leaseId);
        try {
            await supabase
                .from('driver_leases')
                .update({ status: 'rejected' })
                .eq('id', leaseId);
            await loadActivations();
        } catch (err: any) {
            alert('Rejection failed: ' + (err.message || 'Unknown error'));
        } finally {
            setActionLoading(null);
        }
    };

    const handleToggleDriver = async (user: any) => {
        const action = user.is_driver ? 'revoke' : 'authorize';
        if (!window.confirm(`${action.toUpperCase()} driver access for ${user.name}?`)) return;
        try {
            await adminFetch('admin', { action: 'toggle_driver', user_id: user.id, sub_action: action, name: user.name });
            onRefresh();
        } catch (err: any) { alert(err.message); }
    };

    const handleSuspendRider = async (user: any) => {
        const nextStatus = !user.suspended;
        if (!window.confirm(`${nextStatus ? 'SUSPEND' : 'REACTIVATE'} this rider?`)) return;
        try {
            await adminFetch('admin', { action: 'suspend_rider', rider_id: user.id, suspend: nextStatus });
            onRefresh();
        } catch (err: any) { alert(err.message); }
    };

    const foodOrders = (orders || []).filter((o: any) => ['grocery', 'food', 'restaurant'].includes(o.delivery_method) || o.category === 'food');

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* SUB-NAVIGATION */}
            <div className="flex gap-4 p-1 bg-white/5 rounded-2xl w-fit border border-white/5">
                <SubTab active={tab === 'operations'} onClick={() => setTab('operations')} icon={<ActivityIcon size={14}/>} label="Operations" />
                <SubTab active={tab === 'personnel'} onClick={() => setTab('personnel')} icon={<Users size={14}/>} label="Personnel" />
                <SubTab active={tab === 'logistics'} onClick={() => setTab('logistics')} icon={<Truck size={14}/>} label="Logistics" />
            </div>

            {tab === 'operations' && (
                <div className="space-y-6">
                    {/* Operations sub-tabs */}
                    <div className="flex gap-2">
                        <button
                            onClick={() => setOpsView('rides')}
                            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all border ${opsView === 'rides' ? 'bg-white/10 text-white border-white/20' : 'text-white/30 border-white/5 hover:text-white/60'}`}
                        >
                            <ActivityIcon size={12}/> Live Rides
                        </button>
                        <button
                            onClick={() => setOpsView('food')}
                            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all border ${opsView === 'food' ? 'bg-white/10 text-white border-white/20' : 'text-white/30 border-white/5 hover:text-white/60'}`}
                        >
                            <ShoppingBag size={12}/> Food Orders {orders?.length > 0 && `(${orders.length})`}
                        </button>
                    </div>

                    {opsView === 'rides' && (
                        <div className="bg-white/5 border border-white/10 rounded-[2.5rem] overflow-hidden">
                            <div className="p-8 border-b border-white/5 flex justify-between items-center">
                                <h2 className="text-xs font-bold text-white/40 uppercase tracking-widest">Active Rides</h2>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-left">
                                    <thead>
                                        <tr className="bg-white/[0.01]">
                                            <th className="px-8 py-5 text-[10px] font-black text-white/20 uppercase tracking-widest">Operator</th>
                                            <th className="px-8 py-5 text-[10px] font-black text-white/20 uppercase tracking-widest">Route</th>
                                            <th className="px-8 py-5 text-[10px] font-black text-white/20 uppercase tracking-widest">Status</th>
                                            <th className="px-8 py-5 text-[10px] font-black text-white/20 uppercase tracking-widest text-right">Adjudication</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-white/5">
                                        {rides.slice(0, 10).map((ride: any) => (
                                            <tr key={ride.id} className="hover:bg-white/[0.02]">
                                                <td className="px-8 py-5">
                                                    <div className="text-xs font-bold text-white mb-1">{ride.rider?.name || 'Unknown Rider'}</div>
                                                    <div className="text-[10px] text-white/30 font-medium">Driver: {ride.driver_id ? 'Assigned' : 'Seeking...'}</div>
                                                </td>
                                                <td className="px-8 py-5">
                                                    <div className="text-[11px] text-white/60 truncate max-w-[200px]">{ride.pickup_address}</div>
                                                    <div className="text-[9px] text-white/20 mt-1">To: {ride.dropoff_address}</div>
                                                </td>
                                                <td className="px-8 py-5">
                                                    <StatusBadge status={ride.status} />
                                                </td>
                                                <td className="px-8 py-5 text-right">
                                                    <button className="text-[9px] font-black text-cyan-400 bg-cyan-400/5 px-3 py-1.5 rounded-lg border border-cyan-400/20 hover:bg-cyan-400/10 transition-all">MANAGE</button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {opsView === 'food' && (
                        <div className="bg-white/5 border border-white/10 rounded-[2.5rem] overflow-hidden">
                            <div className="p-8 border-b border-white/5">
                                <h2 className="text-xs font-bold text-white/40 uppercase tracking-widest">Food &amp; Grocery Orders</h2>
                            </div>
                            {orders.length === 0 ? (
                                <div className="py-16 text-center text-white/20 text-sm uppercase tracking-widest">No orders yet</div>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left">
                                        <thead>
                                            <tr className="bg-white/[0.01]">
                                                <th className="px-8 py-5 text-[10px] font-black text-white/20 uppercase tracking-widest">Order</th>
                                                <th className="px-8 py-5 text-[10px] font-black text-white/20 uppercase tracking-widest">Method</th>
                                                <th className="px-8 py-5 text-[10px] font-black text-white/20 uppercase tracking-widest">Status</th>
                                                <th className="px-8 py-5 text-[10px] font-black text-white/20 uppercase tracking-widest text-right">Total</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-white/5">
                                            {orders.map((order: any) => (
                                                <tr key={order.id} className="hover:bg-white/[0.02]">
                                                    <td className="px-8 py-5">
                                                        <div className="text-xs font-bold text-white font-mono">{order.id.slice(0, 8).toUpperCase()}</div>
                                                        <div className="text-[10px] text-white/30 mt-1">{new Date(order.created_at).toLocaleString('en-TT')}</div>
                                                    </td>
                                                    <td className="px-8 py-5">
                                                        <span className="text-[10px] font-black uppercase tracking-wider text-purple-400 bg-purple-400/10 px-2 py-1 rounded-lg border border-purple-400/20">
                                                            {order.delivery_method || 'courier'}
                                                        </span>
                                                    </td>
                                                    <td className="px-8 py-5">
                                                        <StatusBadge status={order.status} />
                                                    </td>
                                                    <td className="px-8 py-5 text-right font-black text-white text-sm">
                                                        {fmtTTD(order.total_cents || 0)}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {tab === 'personnel' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {allUsers.map((user: any) => (
                        <div key={user.id} className="p-8 bg-white/5 border border-white/10 rounded-[2.5rem] flex items-center justify-between group hover:border-white/20 transition-all">
                            <div className="flex items-center gap-6">
                                <div className="w-14 h-14 bg-white/5 rounded-2xl flex items-center justify-center border border-white/5">
                                    <Shield size={20} className="text-white/20" />
                                </div>
                                <div>
                                    <p className="text-sm font-black text-white mb-1">{user.name || 'Unknown'}</p>
                                    <p className="text-[10px] text-white/30 uppercase tracking-widest">{user.email}</p>
                                    <div className="flex gap-2 mt-2">
                                        {user.is_driver && (
                                            <span className="text-[9px] font-black text-cyan-400 bg-cyan-400/10 px-2 py-0.5 rounded-full border border-cyan-400/20 uppercase tracking-wider">Driver</span>
                                        )}
                                        {user.suspended && (
                                            <span className="text-[9px] font-black text-red-400 bg-red-400/10 px-2 py-0.5 rounded-full border border-red-400/20 uppercase tracking-wider">Suspended</span>
                                        )}
                                    </div>
                                </div>
                            </div>
                            <div className="flex flex-col gap-2">
                                <button
                                    onClick={() => handleToggleDriver(user)}
                                    className={`text-[9px] font-black px-3 py-1.5 rounded-lg border uppercase tracking-tight transition-all ${user.is_driver ? 'text-red-400 bg-red-400/5 border-red-400/20 hover:bg-red-400/10' : 'text-cyan-400 bg-cyan-400/5 border-cyan-400/20 hover:bg-cyan-400/10'}`}
                                >
                                    {user.is_driver ? 'Revoke Driver' : 'Authorize Driver'}
                                </button>
                                <button
                                    onClick={() => handleSuspendRider(user)}
                                    className={`text-[9px] font-black px-3 py-1.5 rounded-lg border uppercase tracking-tight transition-all ${user.suspended ? 'text-green-400 bg-green-400/5 border-green-400/20 hover:bg-green-400/10' : 'text-red-400 bg-red-400/5 border-red-400/20 hover:bg-red-400/10'}`}
                                >
                                    {user.suspended ? 'Reactivate' : 'Suspend Rider'}
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {tab === 'logistics' && (
                <div className="space-y-10">
                    {/* ─── ACTIVATOR VIEW TOGGLE ─── */}
                    <div className="glass-tab">
                        <button className={activatorView === 'pending' ? 'active' : ''} onClick={() => setActivatorView('pending')}>
                            <Zap size={14} /> Pending Activations
                        </button>
                        <button className={activatorView === 'active' ? 'active' : ''} onClick={() => setActivatorView('active')}>
                            <Truck size={14} /> Fleet Lease Registry
                        </button>
                    </div>

                    {activatorView === 'pending' && (
                        <div className="space-y-6">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h3 className="text-lg font-black text-white">Term Finance Lease Activator</h3>
                                    <p className="text-xs text-white/30 uppercase tracking-widest mt-1">
                                        Pending applications · Risk scoring · Activation
                                    </p>
                                </div>
                                <button
                                    onClick={loadActivations}
                                    className="p-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-white/40 hover:text-white transition-all"
                                >
                                    <Loader2 size={16} />
                                </button>
                            </div>

                            {activationsLoading ? (
                                <div className="flex items-center justify-center py-20">
                                    <div className="w-8 h-8 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
                                </div>
                            ) : pendingActivations.length === 0 ? (
                                <div className="py-16 text-center">
                                    <Car className="mx-auto text-white/40 mb-4" size={48} />
                                    <p className="text-white/60 text-sm font-black uppercase tracking-widest">No Pending Activations</p>
                                    <p className="text-white/40 text-xs mt-2">Lease applications appear here when drivers apply</p>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 gap-6">
                                    {pendingActivations.filter((a) => a.status === 'pending_approval' || a.status === 'pending').map((activation) => {
                                        const driver = activation.drivers;
                                        const profile = driver?.profiles;
                                        const income = activation.proof_of_income as any;
                                        const risk = calculateRiskScore(driver, income);
                                        const isBusy = actionLoading === activation.id;
                                        const isExpanded = expandedActivation === activation.id;
                                        const isPendingStatus = activation.status === 'pending_approval' || activation.status === 'pending';
                                        return (
                                            <div
                                                key={activation.id}
                                                className={`bg-white/5 border rounded-[2.5rem] overflow-hidden transition-all duration-300 ${
                                                    isPendingStatus
                                                        ? 'border-amber-500/20 hover:border-amber-500/40 shadow-lg shadow-amber-500/5'
                                                        : 'border-white/10'
                                                }`}
                                            >
                                                <div className="h-0.5 w-full bg-gradient-to-r from-white/10 via-white/5 to-transparent" />

                                                <div className="p-6 sm:p-8">
                                                    {/* HEADER */}
                                                    <div className="flex items-start justify-between mb-6">
                                                        <div className="flex items-center gap-4">
                                                            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-purple-500/10 to-transparent border border-purple-500/20 flex items-center justify-center">
                                                                <Zap size={22} className="text-purple-400" />
                                                            </div>
                                                            <div>
                                                                <p className="text-sm font-black text-white">
                                                                    {profile?.full_name || 'Unknown Driver'}
                                                                </p>
                                                                <p className="text-[10px] text-white/30 uppercase tracking-widest mt-0.5">
                                                                    {profile?.email || 'No email'}
                                                                </p>
                                                            </div>
                                                        </div>
                                                        <div className="flex items-center gap-3">
                                                            {/* RISK SCORE */}
                                                            <div className={`px-3 py-1.5 rounded-xl border text-[10px] font-black uppercase tracking-widest ${risk.color}`}>
                                                                {risk.score}/100 · {risk.label}
                                                            </div>
                                                            {isPendingStatus && (
                                                                <span className="text-[9px] font-black px-2.5 py-1 rounded-lg border text-amber-400 bg-amber-400/10 border-amber-500/20 uppercase tracking-widest">
                                                                    {activation.status}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>

                                                    {/* EARNINGS + METRICS */}
                                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
                                                        <div className="bg-black/30 border border-white/5 rounded-xl p-3">
                                                            <p className="text-[9px] font-bold text-white/30 uppercase tracking-widest mb-1">Rides</p>
                                                            <p className="text-sm font-black text-white">{driver?.rides_count || 0}</p>
                                                        </div>
                                                        <div className="bg-black/30 border border-white/5 rounded-xl p-3">
                                                            <p className="text-[9px] font-bold text-white/30 uppercase tracking-widest mb-1">Rating</p>
                                                            <div className="flex items-center gap-1.5">
                                                                <Star size={12} className="text-amber-400" />
                                                                <p className="text-sm font-black text-white">{driver?.rating?.toFixed(1) || '—'}</p>
                                                            </div>
                                                        </div>
                                                        <div className="bg-black/30 border border-white/5 rounded-xl p-3">
                                                            <p className="text-[9px] font-bold text-white/30 uppercase tracking-widest mb-1">Avg Per Ride</p>
                                                            <p className="text-sm font-black text-white">
                                                                {income?.avg_per_ride_cents ? fmtTTD(income.avg_per_ride_cents) : '—'}
                                                            </p>
                                                        </div>
                                                        <div className="bg-black/30 border border-white/5 rounded-xl p-3">
                                                            <p className="text-[9px] font-bold text-white/30 uppercase tracking-widest mb-1">Daily Deduction</p>
                                                            <p className="text-sm font-black text-cyan-400">{fmtTTD(activation.daily_deduction_cents)}</p>
                                                        </div>
                                                    </div>

                                                    {/* RISK BREAKDOWN BAR */}
                                                    <div className="mb-5">
                                                        <div className="flex items-center justify-between mb-2">
                                                            <p className="text-[9px] font-bold text-white/30 uppercase tracking-widest">Underwriting Score</p>
                                                            <p className="text-[10px] font-bold text-white/60">{risk.score}/100</p>
                                                        </div>
                                                        <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                                                            <div
                                                                className={`h-full rounded-full transition-all duration-700 ${
                                                                    risk.score >= 80 ? 'bg-green-400' : risk.score >= 55 ? 'bg-amber-400' : 'bg-red-400'
                                                                }`}
                                                                style={{ width: `${risk.score}%` }}
                                                            />
                                                        </div>
                                                        <div className="flex justify-between mt-1.5">
                                                            <span className="text-[8px] text-white/20 uppercase tracking-widest">Rides weight 35%</span>
                                                            <span className="text-[8px] text-white/20 uppercase tracking-widest">Rating weight 30%</span>
                                                            <span className="text-[8px] text-white/20 uppercase tracking-widest">Earnings weight 35%</span>
                                                        </div>
                                                    </div>

                                                    {/* EXPANDED DETAILS */}
                                                    {isExpanded && income && (
                                                        <div className="p-4 bg-black/30 border border-white/5 rounded-2xl mb-5">
                                                            <p className="text-[9px] font-bold text-white/30 uppercase tracking-widest mb-3">Proof of Income Payload</p>
                                                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                                                                {Object.entries(income).map(([key, val]) => (
                                                                    <div key={key}>
                                                                        <p className="text-[8px] font-bold text-white/20 uppercase tracking-widest mb-0.5">{key.replace(/_/g, ' ')}</p>
                                                                        <p className="text-xs font-bold text-white">{String(val)}</p>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}

                                                    {/* VEHICLE INFO */}
                                                    {activation.fleet_vehicles && (
                                                        <div className="flex items-center gap-3 p-3 bg-black/30 border border-white/5 rounded-xl mb-5">
                                                            <Car size={16} className="text-white/30 shrink-0" />
                                                            <div>
                                                                <p className="text-xs font-bold text-white">
                                                                    {activation.fleet_vehicles.year} {activation.fleet_vehicles.make} {activation.fleet_vehicles.model}
                                                                </p>
                                                                <p className="text-[10px] text-white/30 font-mono">{activation.fleet_vehicles.license_plate}</p>
                                                            </div>
                                                            <span className="ml-auto text-[9px] font-black text-cyan-400 bg-cyan-400/10 px-2 py-0.5 rounded border border-cyan-400/20 uppercase tracking-wider">
                                                                {activation.fleet_vehicles.ownership_type}
                                                            </span>
                                                        </div>
                                                    )}

                                                    {/* ACTIONS */}
                                                    <div className="flex items-center gap-3">
                                                        <button
                                                            onClick={() => setExpandedActivation(isExpanded ? null : activation.id)}
                                                            className="flex items-center gap-1.5 px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-[10px] font-bold text-white/50 hover:text-white transition-all"
                                                        >
                                                            {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                                            {isExpanded ? 'Hide Income' : 'View Income'}
                                                        </button>
                                                        {isPendingStatus && (
                                                            <>
                                                                <button
                                                                    onClick={() => handleActivateLease(activation.id, driver?.id || '')}
                                                                    disabled={isBusy}
                                                                    className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-green-500/15 text-green-400 border border-green-500/25 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-green-500/25 transition-all disabled:opacity-40"
                                                                >
                                                                    {isBusy ? (
                                                                        <div className="w-4 h-4 border-2 border-green-400 border-t-transparent rounded-full animate-spin" />
                                                                    ) : (
                                                                        <>
                                                                            <Zap size={14} /> Activate Term Finance Lease
                                                                        </>
                                                                    )}
                                                                </button>
                                                                <button
                                                                    onClick={() => handleRejectLease(activation.id)}
                                                                    disabled={isBusy}
                                                                    className="px-4 py-3 bg-red-500/10 text-red-400 border border-red-500/20 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-red-500/20 transition-all disabled:opacity-40"
                                                                >
                                                                    <Ban size={14} />
                                                                </button>
                                                            </>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}

                    {activatorView === 'active' && (
                        <div className="space-y-6">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h3 className="text-lg font-black text-white">Fleet Lease Registry</h3>
                                    <p className="text-xs text-white/30 uppercase tracking-widest mt-1">
                                        Active leases · Vehicle assignments · Installment deductions
                                    </p>
                                </div>
                                <button
                                    onClick={loadLeases}
                                    className="p-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-white/40 hover:text-white transition-all"
                                >
                                    <Activity size={16} />
                                </button>
                            </div>

                            {leasesLoading ? (
                                <div className="flex items-center justify-center py-20">
                                    <div className="w-8 h-8 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
                                </div>
                            ) : leases.length === 0 ? (
                                <div className="py-16 text-center">
                                    <Truck className="mx-auto text-white/40 mb-4" size={40} />
                                    <p className="text-white/60 text-sm">No fleet leases on record</p>
                                    <p className="text-white/40 text-xs mt-2">
                                        Leases are created when admin assigns a fleet vehicle to a driver
                                    </p>
                                </div>
                            ) : (
                                <div className="bg-white/5 border border-white/10 rounded-[2.5rem] overflow-hidden">
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-left">
                                            <thead>
                                                <tr className="bg-white/[0.01] border-b border-white/5">
                                                    <th className="px-6 py-4 text-[10px] font-black text-white/20 uppercase tracking-widest">Driver</th>
                                                    <th className="px-6 py-4 text-[10px] font-black text-white/20 uppercase tracking-widest">Vehicle</th>
                                                    <th className="px-6 py-4 text-[10px] font-black text-white/20 uppercase tracking-widest">Lease Type</th>
                                                    <th className="px-6 py-4 text-[10px] font-black text-white/20 uppercase tracking-widest">Rate</th>
                                                    <th className="px-6 py-4 text-[10px] font-black text-white/20 uppercase tracking-widest">Start</th>
                                                    <th className="px-6 py-4 text-[10px] font-black text-white/20 uppercase tracking-widest">Status</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-white/5">
                                                {leases.map((lease) => {
                                                    const driver = (lease.drivers as any)?.profiles?.name ?? 'Unknown Driver';
                                                    const vehicle = lease.fleet_vehicles
                                                        ? `${lease.fleet_vehicles.year} ${lease.fleet_vehicles.make} ${lease.fleet_vehicles.model}`
                                                        : 'Unknown Vehicle';
                                                    const plate = lease.fleet_vehicles?.license_plate ?? '';
                                                    const ownership = lease.fleet_vehicles?.ownership_type ?? '';
                                                    return (
                                                        <tr key={lease.id} className="hover:bg-white/[0.02]">
                                                            <td className="px-6 py-4">
                                                                <p className="text-xs font-black text-white">{driver}</p>
                                                            </td>
                                                            <td className="px-6 py-4">
                                                                <p className="text-xs font-bold text-white">{vehicle}</p>
                                                                <p className="text-[10px] text-white/30 font-mono mt-0.5">{plate}</p>
                                                                {ownership === 'g-taxi' && (
                                                                    <span className="text-[9px] font-black text-cyan-400 bg-cyan-400/10 px-1.5 py-0.5 rounded border border-cyan-400/20 uppercase tracking-wider mt-1 inline-block">
                                                                        G-Taxi Owned
                                                                    </span>
                                                                )}
                                                            </td>
                                                            <td className="px-6 py-4">
                                                                <span className="text-[10px] font-black uppercase tracking-wider text-purple-400 bg-purple-400/10 px-2 py-1 rounded-lg border border-purple-400/20">
                                                                    {lease.lease_type}
                                                                </span>
                                                            </td>
                                                            <td className="px-6 py-4">
                                                                <p className="text-xs font-black text-white">{fmtTTD(lease.daily_rate_cents)}/day</p>
                                                                {!lease.deposit_paid && lease.security_deposit_cents > 0 && (
                                                                    <p className="text-[10px] text-amber-400 mt-0.5">
                                                                        Deposit pending: {fmtTTD(lease.security_deposit_cents)}
                                                                    </p>
                                                                )}
                                                            </td>
                                                            <td className="px-6 py-4">
                                                                <p className="text-xs text-white/60">{fmtDate(lease.start_date)}</p>
                                                                {lease.end_date && (
                                                                    <p className="text-[10px] text-white/30 mt-0.5">ends {fmtDate(lease.end_date)}</p>
                                                                )}
                                                            </td>
                                                            <td className="px-6 py-4">
                                                                <LeaseStatusBadge status={lease.status} />
                                                                {lease.termination_reason && (
                                                                    <p className="text-[10px] text-red-400 mt-1 max-w-[120px] truncate">
                                                                        {lease.termination_reason}
                                                                    </p>
                                                                )}
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

const SubTab = ({ active, onClick, icon, label }: any) => (
    <button
        onClick={onClick}
        className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${active ? 'bg-white/10 text-white border border-white/10' : 'text-white/30 border border-transparent hover:text-white/60'}`}
    >
        {icon}
        {label}
    </button>
);

const StatusBadge = ({ status }: any) => {
    const colors: any = {
        completed: 'text-green-400 bg-green-400/10 border-green-500/20',
        delivered: 'text-green-400 bg-green-400/10 border-green-500/20',
        cancelled: 'text-red-400 bg-red-400/10 border-red-500/20',
        in_progress: 'text-cyan-400 bg-cyan-400/10 border-cyan-500/20 animate-pulse',
        searching: 'text-yellow-400 bg-yellow-400/10 border-yellow-500/20',
        processing: 'text-blue-400 bg-blue-400/10 border-blue-500/20',
        ready: 'text-purple-400 bg-purple-400/10 border-purple-500/20',
        pending: 'text-white/50 bg-white/5 border-white/10',
    };
    return (
        <span className={`text-[9px] font-black px-2.5 py-1 rounded-md border uppercase tracking-tight ${colors[status] || 'text-white/40 bg-white/5 border-white/5'}`}>
            {status}
        </span>
    );
};

const LeaseStatusBadge = ({ status }: any) => {
    const map: any = {
        active: 'text-green-400 bg-green-400/10 border-green-500/20',
        suspended: 'text-amber-400 bg-amber-400/10 border-amber-500/20',
        terminated: 'text-red-400 bg-red-400/10 border-red-500/20',
        completed: 'text-white/40 bg-white/5 border-white/10',
    };
    return (
        <span className={`text-[9px] font-black px-2.5 py-1 rounded-md border uppercase tracking-tight ${map[status] || 'text-white/40 bg-white/5 border-white/5'}`}>
            {status}
        </span>
    );
};

const ActivityIcon = ({ size }: any) => <Activity size={size} />;
