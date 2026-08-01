import { useState, useEffect, useCallback } from 'react';
import { supabase, adminFetch } from '../lib/supabase';
import {
  Users, Truck, AlertCircle, Shield, Ban, CheckCircle2,
  Activity, ShoppingBag, Zap, TrendingUp, Clock, ExternalLink,
  ChevronDown, ChevronUp, Loader2, DollarSign, Car, Star, ShieldCheck, X,
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
    insurance_provider: string | null;
    insurance_policy_number: string | null;
    insurance_annual_premium_cents: number | null;
    insurance_commission_bps: number | null;
    insurance_expires_at: string | null;
    insurance_commission_paid: boolean;
    broker_license_ref: string | null;
    broker_of_record: string | null;
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

const RIDE_CANCELLABLE_STATUSES = new Set(['requested', 'searching', 'waiting_queue', 'expired', 'assigned', 'arrived', 'scheduled']);
const RIDE_COMPLETABLE_STATUSES = new Set(['in_progress', 'arrived']);

export const FleetManager = ({ allUsers, rides, orders, onRefresh }: any) => {
    const [tab, setTab] = useState<'personnel' | 'operations' | 'logistics'>('operations');
    const [opsView, setOpsView] = useState<'rides' | 'food'>('rides');
    const [manageOpenId, setManageOpenId] = useState<string | null>(null);
    const [rideActionBusy, setRideActionBusy] = useState<string | null>(null);

    const cancelRide = async (ride: any) => {
        if (!window.confirm(`Cancel this ride (${ride.pickup_address?.split(',')[0] || 'ride'})?`)) return;
        setRideActionBusy(ride.id);
        setManageOpenId(null);
        try {
            const result = await adminFetch('admin', { action: 'cancel_ride', ride_id: ride.id, reason: 'Cancelled by admin (Fleet Manager)' });
            if (!result?.success) throw new Error(result?.error || 'Cancel failed');
            onRefresh?.();
        } catch (err: any) {
            alert('Cancel failed: ' + err.message);
        } finally {
            setRideActionBusy(null);
        }
    };

    const completeRide = async (ride: any) => {
        if (!window.confirm(`Force-complete this ride (${ride.pickup_address?.split(',')[0] || 'ride'})? No payment will be processed — this only closes the ride.`)) return;
        setRideActionBusy(ride.id);
        setManageOpenId(null);
        try {
            const result = await adminFetch('admin', {
                action: 'force_complete',
                ride_id: ride.id,
                process_payment: false,
                ...(ride.status !== 'in_progress' ? { confirm_unsafe_action: 'I_UNDERSTAND_RISKS' } : {}),
            });
            if (!result?.success) throw new Error(result?.error || 'Force-complete failed');
            onRefresh?.();
        } catch (err: any) {
            alert('Force-complete failed: ' + err.message);
        } finally {
            setRideActionBusy(null);
        }
    };
    const [leases, setLeases] = useState<FleaseLease[]>([]);
    const [leasesLoading, setLeasesLoading] = useState(false);
    const [activatorView, setActivatorView] = useState<'pending' | 'active' | 'vehicles'>('pending');
    const [vehicles, setVehicles] = useState<any[]>([]);
    const [vehiclesLoading, setVehiclesLoading] = useState(false);
    const [newVehicle, setNewVehicle] = useState({ make: '', model: '', year: '', license_plate: '', ownership_type: 'g-taxi' });
    const [vehicleSubmitting, setVehicleSubmitting] = useState(false);

    const loadVehicles = useCallback(async () => {
        setVehiclesLoading(true);
        try {
            const { vehicles } = await adminFetch('admin', { action: 'manage_fleet_vehicles', action_type: 'list' });
            setVehicles(vehicles || []);
        } catch (err) {
            console.error('[FleetManager] loadVehicles error:', err);
        } finally {
            setVehiclesLoading(false);
        }
    }, []);

    useEffect(() => { if (activatorView === 'vehicles') loadVehicles(); }, [activatorView, loadVehicles]);

    const createVehicle = async () => {
        if (!newVehicle.make || !newVehicle.model || !newVehicle.year || !newVehicle.license_plate) {
            alert('Make, model, year, and license plate are required');
            return;
        }
        setVehicleSubmitting(true);
        try {
            await adminFetch('admin', {
                action: 'manage_fleet_vehicles', action_type: 'create',
                vehicle: { ...newVehicle, year: Number(newVehicle.year) },
            });
            setNewVehicle({ make: '', model: '', year: '', license_plate: '', ownership_type: 'g-taxi' });
            loadVehicles();
        } catch (err: any) {
            alert(err.message || 'Failed to create vehicle');
        } finally {
            setVehicleSubmitting(false);
        }
    };

    const updateVehicleStatus = async (id: string, status: string) => {
        try {
            await adminFetch('admin', { action: 'manage_fleet_vehicles', action_type: 'update', vehicle: { id, status } });
            loadVehicles();
        } catch (err: any) {
            alert(err.message || 'Failed to update vehicle');
        }
    };

    const [pendingActivations, setPendingActivations] = useState<PendingActivation[]>([]);
    const [activationsLoading, setActivationsLoading] = useState(false);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [expandedActivation, setExpandedActivation] = useState<string | null>(null);

    const [insuranceModalLease, setInsuranceModalLease] = useState<FleaseLease | null>(null);

    const loadLeases = useCallback(async () => {
        // fleet_leases has no admin-role RLS policy (only service_role) — a
        // direct client read here would silently return zero rows for a real
        // admin session. Routed through the admin edge function instead.
        setLeasesLoading(true);
        try {
            const { leases } = await adminFetch('admin', { action: 'list_fleet_leases' });
            setLeases((leases as FleaseLease[]) || []);
        } catch (err) {
            console.error('[FleetManager] loadLeases error:', err);
        } finally {
            setLeasesLoading(false);
        }
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

    const handleBindInsurance = async (payload: {
        lease_id: string; provider: string; policy_number: string;
        annual_premium_cents: number; commission_bps: number; expires_at: string;
        broker_license_ref: string; broker_of_record: string;
    }) => {
        await adminFetch('admin', { action: 'bind_lease_insurance', ...payload });
        setInsuranceModalLease(null);
        await loadLeases();
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
                            {manageOpenId && (
                                <div className="fixed inset-0 z-10" onClick={() => setManageOpenId(null)} />
                            )}
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
                                                <td className="px-8 py-5 text-right relative">
                                                    <button
                                                        onClick={() => setManageOpenId(manageOpenId === ride.id ? null : ride.id)}
                                                        disabled={rideActionBusy === ride.id}
                                                        className="btn-press text-[9px] font-black text-cyan-400 bg-cyan-400/5 px-3 py-1.5 rounded-lg border border-cyan-400/20 hover:bg-cyan-400/10 transition-colors disabled:opacity-40"
                                                    >
                                                        {rideActionBusy === ride.id ? <Loader2 size={11} className="animate-spin inline" /> : 'MANAGE'}
                                                    </button>
                                                    {manageOpenId === ride.id && (
                                                        <div className="dropdown-pop absolute right-8 top-full mt-1 z-20 bg-[#0B0E12] border border-white/10 rounded-xl shadow-2xl overflow-hidden min-w-[160px]" style={{ transformOrigin: 'top right' }}>
                                                            {RIDE_CANCELLABLE_STATUSES.has(ride.status) && (
                                                                <button onClick={() => cancelRide(ride)} className="btn-press w-full text-left px-4 py-2.5 text-[10px] font-bold text-red-400 hover:bg-red-400/10 transition-colors">Cancel Ride</button>
                                                            )}
                                                            {RIDE_COMPLETABLE_STATUSES.has(ride.status) && (
                                                                <button onClick={() => completeRide(ride)} className="btn-press w-full text-left px-4 py-2.5 text-[10px] font-bold text-green-400 hover:bg-green-400/10 transition-colors">Force Complete</button>
                                                            )}
                                                            {!RIDE_CANCELLABLE_STATUSES.has(ride.status) && !RIDE_COMPLETABLE_STATUSES.has(ride.status) && (
                                                                <div className="px-4 py-2.5 text-[10px] font-bold text-white/30">No actions for "{ride.status}"</div>
                                                            )}
                                                        </div>
                                                    )}
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
                        <button className={activatorView === 'vehicles' ? 'active' : ''} onClick={() => setActivatorView('vehicles')}>
                            <Car size={14} /> Vehicles
                        </button>
                    </div>

                    {activatorView === 'vehicles' && (
                        <div className="space-y-6">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h3 className="text-lg font-black text-white">Fleet Vehicles</h3>
                                    <p className="text-xs text-white/30 uppercase tracking-widest mt-1">
                                        The only way a vehicle enters the system — previously required a direct SQL insert
                                    </p>
                                </div>
                                <button onClick={loadVehicles} className="p-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-white/40 hover:text-white transition-all">
                                    <Activity size={16} />
                                </button>
                            </div>

                            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 grid grid-cols-2 sm:grid-cols-5 gap-4 items-end">
                                <div>
                                    <label className="block text-[9px] font-bold text-white/30 uppercase tracking-widest mb-1.5">Make</label>
                                    <input value={newVehicle.make} onChange={(e) => setNewVehicle({ ...newVehicle, make: e.target.value })} placeholder="Toyota" className="admin-input" />
                                </div>
                                <div>
                                    <label className="block text-[9px] font-bold text-white/30 uppercase tracking-widest mb-1.5">Model</label>
                                    <input value={newVehicle.model} onChange={(e) => setNewVehicle({ ...newVehicle, model: e.target.value })} placeholder="Hiace" className="admin-input" />
                                </div>
                                <div>
                                    <label className="block text-[9px] font-bold text-white/30 uppercase tracking-widest mb-1.5">Year</label>
                                    <input type="number" value={newVehicle.year} onChange={(e) => setNewVehicle({ ...newVehicle, year: e.target.value })} placeholder="2024" className="admin-input" />
                                </div>
                                <div>
                                    <label className="block text-[9px] font-bold text-white/30 uppercase tracking-widest mb-1.5">Plate</label>
                                    <input value={newVehicle.license_plate} onChange={(e) => setNewVehicle({ ...newVehicle, license_plate: e.target.value.toUpperCase() })} placeholder="PCK-1234" className="admin-input" />
                                </div>
                                <button
                                    onClick={createVehicle}
                                    disabled={vehicleSubmitting}
                                    className="px-4 py-3 bg-cyan-500/20 border border-cyan-500/40 rounded-xl text-cyan-400 text-[10px] font-black uppercase tracking-widest hover:bg-cyan-500/30 disabled:opacity-40"
                                >
                                    {vehicleSubmitting ? 'Adding…' : '+ Add Vehicle'}
                                </button>
                            </div>

                            {vehiclesLoading ? (
                                <div className="flex items-center justify-center py-20">
                                    <div className="w-8 h-8 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
                                </div>
                            ) : vehicles.length === 0 ? (
                                <div className="py-16 text-center">
                                    <Car className="mx-auto text-white/40 mb-4" size={40} />
                                    <p className="text-white/60 text-sm">No vehicles on record</p>
                                </div>
                            ) : (
                                <div className="grid gap-3">
                                    {vehicles.map((v) => (
                                        <div key={v.id} className="bg-white/5 border border-white/10 rounded-2xl p-5 flex items-center justify-between">
                                            <div>
                                                <p className="text-sm font-black text-white">{v.year} {v.make} {v.model}</p>
                                                <p className="text-xs text-white/40 font-mono mt-1">{v.license_plate} · {v.ownership_type}</p>
                                            </div>
                                            <select
                                                value={v.status || 'available'}
                                                onChange={(e) => updateVehicleStatus(v.id, e.target.value)}
                                                className="admin-input w-40"
                                            >
                                                <option value="available">Available</option>
                                                <option value="leased">Leased</option>
                                                <option value="maintenance">Maintenance</option>
                                                <option value="retired">Retired</option>
                                            </select>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

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

                            {!leasesLoading && leases.length > 0 && (() => {
                                const bound = leases.filter((l) => l.insurance_commission_paid);
                                const totalCommission = bound.reduce((sum, l) =>
                                    sum + Math.round((l.insurance_annual_premium_cents || 0) * (l.insurance_commission_bps || 0) / 10000), 0);
                                const expiringSoon = bound.filter((l) => {
                                    if (!l.insurance_expires_at) return false;
                                    const days = (new Date(l.insurance_expires_at).getTime() - Date.now()) / 86400000;
                                    return days > 0 && days <= 30;
                                });
                                return (
                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                        <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
                                            <p className="text-[9px] font-bold text-white/30 uppercase tracking-widest mb-1">Policies Bound</p>
                                            <p className="text-2xl font-black text-white">{bound.length} <span className="text-sm text-white/30 font-medium">/ {leases.length}</span></p>
                                        </div>
                                        <div className="bg-purple-400/5 border border-purple-400/15 rounded-2xl p-5">
                                            <p className="text-[9px] font-bold text-white/30 uppercase tracking-widest mb-1">Total Brokerage Commission</p>
                                            <p className="text-2xl font-black text-purple-300">{fmtTTD(totalCommission)}</p>
                                        </div>
                                        <div className={`border rounded-2xl p-5 ${expiringSoon.length > 0 ? 'bg-amber-400/5 border-amber-500/20' : 'bg-white/5 border-white/10'}`}>
                                            <p className="text-[9px] font-bold text-white/30 uppercase tracking-widest mb-1">Expiring Within 30 Days</p>
                                            <p className={`text-2xl font-black ${expiringSoon.length > 0 ? 'text-amber-400' : 'text-white'}`}>{expiringSoon.length}</p>
                                        </div>
                                    </div>
                                );
                            })()}

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
                                                    <th className="px-6 py-4 text-[10px] font-black text-white/20 uppercase tracking-widest">Insurance</th>
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
                                                            <td className="px-6 py-4">
                                                                {lease.insurance_commission_paid ? (
                                                                    <div>
                                                                        <span className="flex items-center gap-1 text-[9px] font-black text-green-400 bg-green-400/10 px-2 py-1 rounded-lg border border-green-500/20 uppercase tracking-wider w-fit">
                                                                            <ShieldCheck size={11} /> Bound
                                                                        </span>
                                                                        <p className="text-[10px] text-white/30 mt-1">{lease.insurance_provider}</p>
                                                                        <p className="text-[10px] text-cyan-400/70 mt-0.5">
                                                                            Commission {fmtTTD(Math.round((lease.insurance_annual_premium_cents || 0) * (lease.insurance_commission_bps || 0) / 10000))}
                                                                        </p>
                                                                        {lease.broker_of_record && (
                                                                            <p className="text-[9px] text-white/20 mt-0.5">
                                                                                Broker: {lease.broker_of_record} ({lease.broker_license_ref})
                                                                            </p>
                                                                        )}
                                                                    </div>
                                                                ) : (
                                                                    <button
                                                                        onClick={() => setInsuranceModalLease(lease)}
                                                                        className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-400/10 text-purple-400 border border-purple-400/20 rounded-lg text-[9px] font-black uppercase tracking-widest hover:bg-purple-400/20 transition-all"
                                                                    >
                                                                        <Shield size={12} /> Bind Policy
                                                                    </button>
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

            {insuranceModalLease && (
                <InsuranceBindModal
                    lease={insuranceModalLease}
                    onClose={() => setInsuranceModalLease(null)}
                    onSubmit={handleBindInsurance}
                />
            )}
        </div>
    );
};

const InsuranceBindModal = ({ lease, onClose, onSubmit }: {
    lease: FleaseLease;
    onClose: () => void;
    onSubmit: (payload: {
        lease_id: string; provider: string; policy_number: string;
        annual_premium_cents: number; commission_bps: number; expires_at: string;
        broker_license_ref: string; broker_of_record: string;
    }) => Promise<void>;
}) => {
    const [provider, setProvider] = useState('');
    const [policyNumber, setPolicyNumber] = useState('');
    const [annualPremium, setAnnualPremium] = useState('');
    const [commissionPct, setCommissionPct] = useState('15');
    const [expiresAt, setExpiresAt] = useState('');
    const [brokerLicenseRef, setBrokerLicenseRef] = useState('');
    const [brokerOfRecord, setBrokerOfRecord] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const vehicle = lease.fleet_vehicles
        ? `${lease.fleet_vehicles.year} ${lease.fleet_vehicles.make} ${lease.fleet_vehicles.model} (${lease.fleet_vehicles.license_plate})`
        : 'Unknown Vehicle';
    const driver = (lease.drivers as any)?.profiles?.name ?? 'Unknown Driver';

    const premiumCents = Math.round(parseFloat(annualPremium || '0') * 100);
    const commissionBps = Math.round(parseFloat(commissionPct || '0') * 100);
    const commissionPreviewCents = Math.round(premiumCents * commissionBps / 10000);

    const canSubmit = provider.trim() && policyNumber.trim() && premiumCents > 0 && commissionBps > 0
        && expiresAt && brokerLicenseRef.trim() && brokerOfRecord.trim() && !submitting;

    const handleSubmit = async () => {
        setError(null);
        setSubmitting(true);
        try {
            await onSubmit({
                lease_id: lease.id,
                provider: provider.trim(),
                policy_number: policyNumber.trim(),
                annual_premium_cents: premiumCents,
                commission_bps: commissionBps,
                expires_at: new Date(expiresAt).toISOString(),
                broker_license_ref: brokerLicenseRef.trim(),
                broker_of_record: brokerOfRecord.trim(),
            });
        } catch (err: any) {
            setError(err.message || 'Failed to bind insurance');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <div className="w-full max-w-md bg-[#0d0d12] border border-white/10 rounded-[2rem] p-8 space-y-6">
                <div className="flex items-start justify-between">
                    <div>
                        <h3 className="text-lg font-black text-white flex items-center gap-2">
                            <Shield size={18} className="text-purple-400" /> Bind Insurance Policy
                        </h3>
                        <p className="text-[10px] text-white/30 uppercase tracking-widest mt-1">{driver} · {vehicle}</p>
                    </div>
                    <button onClick={onClose} className="text-white/30 hover:text-white transition-colors">
                        <X size={18} />
                    </button>
                </div>

                <p className="text-[11px] text-white/40 leading-relaxed">
                    The platform brokers this operator's vehicle insurance and earns a brokerage commission
                    on the annual premium — separate from, and never touching, the per-ride lease deduction.
                </p>

                <div className="space-y-4">
                    <Field label="Provider">
                        <input value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="e.g. Sagicor, Guardian Life" className="admin-input" />
                    </Field>
                    <Field label="Policy Number">
                        <input value={policyNumber} onChange={(e) => setPolicyNumber(e.target.value)} placeholder="POL-000000" className="admin-input" />
                    </Field>
                    <div className="grid grid-cols-2 gap-4">
                        <Field label="Annual Premium (TTD)">
                            <input type="number" min="0" step="0.01" value={annualPremium} onChange={(e) => setAnnualPremium(e.target.value)} placeholder="5000.00" className="admin-input" />
                        </Field>
                        <Field label="Commission %">
                            <input type="number" min="0" max="100" step="0.5" value={commissionPct} onChange={(e) => setCommissionPct(e.target.value)} className="admin-input" />
                        </Field>
                    </div>
                    <Field label="Policy Expires">
                        <input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} className="admin-input" />
                    </Field>
                    <div className="pt-2 border-t border-white/5">
                        <p className="text-[9px] font-bold text-amber-400/80 uppercase tracking-widest mb-3">
                            Compliance — required, not legal advice
                        </p>
                        <div className="space-y-4">
                            <Field label="Broker of Record">
                                <input value={brokerOfRecord} onChange={(e) => setBrokerOfRecord(e.target.value)} placeholder="Licensed entity or individual name" className="admin-input" />
                            </Field>
                            <Field label="Broker License Ref">
                                <input value={brokerLicenseRef} onChange={(e) => setBrokerLicenseRef(e.target.value)} placeholder="License / registration number" className="admin-input" />
                            </Field>
                        </div>
                        <p className="text-[10px] text-white/30 mt-3 leading-relaxed">
                            Acting as an insurance intermediary is licensed activity under T&amp;T's Insurance Act.
                            A real licensed broker or agent must be on file before this policy can be bound.
                        </p>
                    </div>
                </div>

                {premiumCents > 0 && commissionBps > 0 && (
                    <div className="p-3 bg-cyan-400/5 border border-cyan-400/15 rounded-xl">
                        <p className="text-[9px] font-bold text-white/30 uppercase tracking-widest mb-1">Commission Earned</p>
                        <p className="text-sm font-black text-cyan-400">{fmtTTD(commissionPreviewCents)}</p>
                    </div>
                )}

                {error && (
                    <p className="text-[11px] text-red-400 bg-red-400/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>
                )}

                <div className="flex gap-3">
                    <button
                        onClick={onClose}
                        className="flex-1 px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-[10px] font-black uppercase tracking-widest text-white/50 hover:text-white transition-all"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={!canSubmit}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-purple-400/15 text-purple-300 border border-purple-400/25 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-purple-400/25 transition-all disabled:opacity-40"
                    >
                        {submitting ? <div className="w-4 h-4 border-2 border-purple-300 border-t-transparent rounded-full animate-spin" /> : <ShieldCheck size={14} />}
                        Bind &amp; Earn Commission
                    </button>
                </div>
            </div>
        </div>
    );
};

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div>
        <label className="block text-[9px] font-bold text-white/30 uppercase tracking-widest mb-1.5">{label}</label>
        {children}
    </div>
);

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
