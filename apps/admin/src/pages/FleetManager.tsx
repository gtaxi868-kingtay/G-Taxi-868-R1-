import { useState, useEffect, useCallback } from 'react';
import { supabase, adminFetch } from '../lib/supabase';
import { Users, Truck, AlertCircle, Shield, Ban, CheckCircle2, Activity, ShoppingBag } from 'lucide-react';

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

export const FleetManager = ({ allUsers, rides, orders, onRefresh }: any) => {
    const [tab, setTab] = useState<'personnel' | 'operations' | 'logistics'>('operations');
    const [opsView, setOpsView] = useState<'rides' | 'food'>('rides');
    const [leases, setLeases] = useState<FleaseLease[]>([]);
    const [leasesLoading, setLeasesLoading] = useState(false);

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
                <div className="space-y-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="text-lg font-black text-white">Fleet Lease Registry</h3>
                            <p className="text-xs text-white/30 uppercase tracking-widest mt-1">Active leases · Vehicle assignments · Installment deductions</p>
                        </div>
                        <button onClick={loadLeases} className="p-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-white/40 hover:text-white transition-all">
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
                            <p className="text-white/40 text-xs mt-2">Leases are created when admin assigns a fleet vehicle to a driver</p>
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
                                        {leases.map(lease => {
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
                                                            <span className="text-[9px] font-black text-cyan-400 bg-cyan-400/10 px-1.5 py-0.5 rounded border border-cyan-400/20 uppercase tracking-wider mt-1 inline-block">G-Taxi Owned</span>
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
                                                            <p className="text-[10px] text-amber-400 mt-0.5">Deposit pending: {fmtTTD(lease.security_deposit_cents)}</p>
                                                        )}
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        <p className="text-xs text-white/60">{fmtDate(lease.start_date)}</p>
                                                        {lease.end_date && <p className="text-[10px] text-white/30 mt-0.5">ends {fmtDate(lease.end_date)}</p>}
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        <LeaseStatusBadge status={lease.status} />
                                                        {lease.termination_reason && (
                                                            <p className="text-[10px] text-red-400 mt-1 max-w-[120px] truncate">{lease.termination_reason}</p>
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
