import { useState, useEffect } from 'react';
import { supabase, adminFetch } from '../lib/supabase';
import { Users, Truck, AlertCircle, Shield, Ban, CheckCircle2 } from 'lucide-react';

export const FleetManager = ({ allUsers, rides, orders, onRefresh }: any) => {
    const [tab, setTab] = useState<'personnel' | 'operations' | 'logistics'>('operations');

    const handleToggleDriver = async (user: any) => {
        const action = user.is_driver ? 'revoke' : 'authorize';
        if (!window.confirm(`${action.toUpperCase()} driver access for ${user.name}?`)) return;
        try { 
            await adminFetch('admin_toggle_driver', { user_id: user.id, action, name: user.name }); 
            onRefresh(); 
        } catch (err: any) { alert(err.message); }
    };

    const handleSuspendRider = async (user: any) => {
        const nextStatus = !user.suspended;
        if (!window.confirm(`${nextStatus ? 'SUSPEND' : 'REACTIVATE'} this rider?`)) return;
        try { 
            await adminFetch('admin_suspend_rider', { rider_id: user.id, suspend: nextStatus }); 
            onRefresh(); 
        } catch (err: any) { alert(err.message); }
    };

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* SUB-NAVIGATION */}
            <div className="flex gap-4 p-1 bg-white/5 rounded-2xl w-fit border border-white/5">
                <SubTab active={tab === 'operations'} onClick={() => setTab('operations')} icon={<Activity size={14}/>} label="Operations" />
                <SubTab active={tab === 'personnel'} onClick={() => setTab('personnel')} icon={<Users size={14}/>} label="Personnel" />
                <SubTab active={tab === 'logistics'} onClick={() => setTab('logistics')} icon={<Truck size={14}/>} label="Logistics" />
            </div>

            {tab === 'operations' && (
                <div className="bg-white/5 border border-white/10 rounded-[2.5rem] overflow-hidden">
                    <div className="p-8 border-b border-white/5 flex justify-between items-center">
                        <h2 className="font-orbitron text-xs font-black tracking-[0.3em] text-white/40 uppercase">Live Operations Stream</h2>
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

            {tab === 'personnel' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {allUsers.map((user: any) => (
                        <div key={user.id} className="p-8 bg-white/5 border border-white/10 rounded-[2.5rem] flex items-center justify-between group hover:border-white/20 transition-all">
                            <div className="flex items-center gap-6">
                                <div className="w-14 h-14 bg-white/5 rounded-2xl flex items-center justify-center border border-white/5">
                                    {user.is_driver ? <Truck className="text-cyan-400" /> : <Users className="text-purple-400" />}
                                </div>
                                <div>
                                    <p className="text-sm font-black text-white">{user.name}</p>
                                    <p className="text-[10px] text-white/20 uppercase tracking-widest font-black mt-1">
                                        {user.is_driver ? 'Licensed Operator' : 'Citizen Rider'}
                                    </p>
                                </div>
                            </div>
                            <div className="flex gap-3">
                                <button 
                                    onClick={() => handleToggleDriver(user)}
                                    className={`p-3 rounded-xl border transition-all ${user.is_driver ? 'bg-red-500/10 border-red-500/20 text-red-400' : 'bg-green-500/10 border-green-500/20 text-green-400'}`}
                                >
                                    <Shield size={16} />
                                </button>
                                <button 
                                    onClick={() => handleSuspendRider(user)}
                                    className={`p-3 rounded-xl border transition-all ${user.suspended ? 'bg-orange-500/20 border-orange-500/40 text-orange-400' : 'bg-white/5 border-white/5 text-white/40'}`}
                                >
                                    <Ban size={16} />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {tab === 'logistics' && (
                <div className="py-20 text-center">
                    <AlertCircle className="mx-auto text-white/10 mb-6" size={48} />
                    <h3 className="font-orbitron text-xs font-black tracking-[0.5em] text-white/20 uppercase">Logistics Manifest Engine</h3>
                    <p className="text-white/10 text-[10px] mt-4 font-bold uppercase tracking-widest leading-relaxed">Cross-referenced with B2B Merchant Hub<br/>Real-time Intake Sync Active</p>
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
        cancelled: 'text-red-400 bg-red-400/10 border-red-500/20',
        in_progress: 'text-cyan-400 bg-cyan-400/10 border-cyan-500/20 animate-pulse',
        searching: 'text-yellow-400 bg-yellow-400/10 border-yellow-500/20'
    };
    return (
        <span className={`text-[9px] font-black px-2.5 py-1 rounded-md border uppercase tracking-tight ${colors[status] || 'text-white/40 bg-white/5 border-white/5'}`}>
            {status}
        </span>
    );
};

const Activity = ({ size }: any) => <Activity size={size} />;
