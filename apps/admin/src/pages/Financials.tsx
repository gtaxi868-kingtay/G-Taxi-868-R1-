import { useEffect, useState } from 'react';
import { adminFetch } from '../lib/supabase';
import { DollarSign, BarChart3, ArrowUpRight, ArrowDownRight, Activity, Check, X, Eye } from 'lucide-react';

interface RevenueLog {
    id: string;
    gross_amount_cents: number;
    platform_fee_cents: number;
    driver_payout_cents: number;
    created_at: string;
}

interface ManualDeposit {
    id: string;
    user_id: string;
    amount_cents: number;
    receipt_url: string;
    status: 'pending' | 'approved' | 'rejected';
    created_at: string;
    profiles: { name: string; email: string };
}

export const Financials = () => {
    const [logs, setLogs] = useState<RevenueLog[]>([]);
    const [pendingDeposits, setPendingDeposits] = useState<ManualDeposit[]>([]);
    const [selectedDeposit, setSelectedDeposit] = useState<ManualDeposit | null>(null);
    const [stats, setStats] = useState({
        totalGross: 0,
        totalNet: 0,
        payouts: 0
    });
    const [isProcessing, setIsProcessing] = useState(false);

    const loadFinancials = async () => {
        try {
            const { data: revData } = await adminFetch('admin_get_revenue_logs');
            setLogs(revData || []);
            
            const { data: depData } = await adminFetch('admin_get_pending_deposits');
            setPendingDeposits(depData || []);

            const totals = (revData || []).reduce((acc: any, curr: any) => ({
                totalGross: acc.totalGross + curr.gross_amount_cents,
                totalNet: acc.totalNet + curr.platform_fee_cents,
                payouts: acc.payouts + curr.driver_payout_cents
            }), { totalGross: 0, totalNet: 0, payouts: 0 });
            
            setStats(totals);
        } catch (err) {
            console.error('Failed to load financials:', err);
        }
    };

    const handleDepositAction = async (depositId: string, action: 'approved' | 'rejected', amountTtd?: number) => {
        if (isProcessing) return;
        setIsProcessing(true);
        try {
            await adminFetch('admin_verify_deposit', { 
                deposit_id: depositId, 
                status: action,
                amount_cents: amountTtd ? Math.round(amountTtd * 100) : undefined
            });
            loadFinancials();
        } catch (err) {
            alert('Verification failed');
        } finally {
            setIsProcessing(false);
        }
    };

    useEffect(() => { loadFinancials(); }, []);

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* KPI GRID */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <StatCard 
                    title="Total Gross Booking" 
                    value={`$${(stats.totalGross / 100).toFixed(2)}`} 
                    icon={<DollarSign className="text-cyan-400" />}
                    trend="+12.5%"
                />
                <StatCard 
                    title="Platform Net Profit" 
                    value={`$${(stats.totalNet / 100).toFixed(2)}`} 
                    icon={<Activity className="text-purple-400" />}
                    trend="+19.2%"
                    isHighlight
                />
                <StatCard 
                    title="Driver Disbursements" 
                    value={`$${(stats.payouts / 100).toFixed(2)}`} 
                    icon={<BarChart3 className="text-yellow-400" />}
                    trend="+8.1%"
                />
            </div>
            {/* PENDING MANUAL DEPOSITS */}
            {pendingDeposits.length > 0 && (
                <div className="bg-white/5 backdrop-blur-3xl border border-white/10 rounded-[2.5rem] overflow-hidden shadow-2xl">
                    <div className="px-8 py-6 border-b border-white/5 flex justify-between items-center bg-cyan-500/10">
                        <div className="flex items-center gap-3">
                            <Activity className="text-cyan-400" size={18} />
                            <h2 className="font-orbitron text-xs font-black tracking-[0.3em] text-cyan-400 uppercase">Awaiting Verification</h2>
                        </div>
                        <span className="px-3 py-1 bg-cyan-500/20 text-cyan-400 text-[10px] font-black rounded-full">{pendingDeposits.length} PENDING</span>
                    </div>
                    <div className="p-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {pendingDeposits.map((dep) => (
                            <div key={dep.id} className="bg-white/[0.03] border border-white/5 rounded-3xl p-6 hover:border-cyan-500/50 transition-all group">
                                <div className="flex justify-between items-start mb-4">
                                    <div className="space-y-1">
                                        <p className="text-[10px] font-black text-white/40 uppercase tracking-widest">{dep.profiles?.name || 'Unknown Pilot'}</p>
                                        <p className="text-xs font-bold text-white/60">{new Date(dep.created_at).toLocaleDateString()}</p>
                                    </div>
                                    <button 
                                        onClick={() => window.open(`${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/receipts/${dep.receipt_url}`, '_blank')}
                                        className="p-2 bg-white/5 rounded-xl text-white/40 hover:text-cyan-400 transition-colors"
                                    >
                                        <Eye size={16} />
                                    </button>
                                </div>
                                
                                <div className="mt-4 flex items-center gap-2">
                                    <div className="flex-1">
                                        <input 
                                            type="number" 
                                            placeholder="Enter TTD Amount"
                                            className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2 text-sm text-white focus:border-cyan-500 outline-none"
                                            id={`amount-${dep.id}`}
                                        />
                                    </div>
                                    <button 
                                        onClick={() => {
                                            const val = (document.getElementById(`amount-${dep.id}`) as HTMLInputElement)?.value;
                                            if (!val) return alert('Enter amount first');
                                            handleDepositAction(dep.id, 'approved', parseFloat(val));
                                        }}
                                        className="p-3 bg-green-500/20 text-green-400 rounded-xl hover:bg-green-500/40 transition-all"
                                    >
                                        <Check size={18} />
                                    </button>
                                    <button 
                                        onClick={() => handleDepositAction(dep.id, 'rejected')}
                                        className="p-3 bg-red-500/20 text-red-400 rounded-xl hover:bg-red-500/40 transition-all"
                                    >
                                        <X size={18} />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* AUDIT LEDGER */}
            <div className="bg-white/5 backdrop-blur-3xl border border-white/10 rounded-[2.5rem] overflow-hidden shadow-2xl">
                <div className="px-8 py-6 border-b border-white/5 flex justify-between items-center bg-white/[0.02]">
                    <h2 className="font-orbitron text-xs font-black tracking-[0.3em] text-white/40 uppercase">Platform Revenue Ledger</h2>
                    <button onClick={loadFinancials} className="text-[10px] font-black text-cyan-400 hover:text-cyan-300 transition-colors uppercase tracking-widest">Refresh Audit</button>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-white/[0.01]">
                                <th className="px-8 py-5 text-[10px] font-black text-white/20 uppercase tracking-widest">Timestamp</th>
                                <th className="px-8 py-5 text-[10px] font-black text-white/20 uppercase tracking-widest">Gross</th>
                                <th className="px-8 py-5 text-[10px] font-black text-white/20 uppercase tracking-widest">Take (Split)</th>
                                <th className="px-8 py-5 text-[10px] font-black text-white/20 uppercase tracking-widest">Payout</th>
                                <th className="px-8 py-5 text-[10px] font-black text-white/20 uppercase tracking-widest text-right">Status</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            {logs.map((log) => (
                                <tr key={log.id} className="hover:bg-white/[0.02] transition-colors">
                                    <td className="px-8 py-5 text-xs font-medium text-white/60">
                                        {new Date(log.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                                    </td>
                                    <td className="px-8 py-5 text-sm font-bold text-white">${(log.gross_amount_cents / 100).toFixed(2)}</td>
                                    <td className="px-8 py-5">
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-black text-cyan-400">${(log.platform_fee_cents / 100).toFixed(2)}</span>
                                            <span className="text-[9px] font-black text-white/20">({((log.platform_fee_cents/log.gross_amount_cents)*100).toFixed(1)}%)</span>
                                        </div>
                                    </td>
                                    <td className="px-8 py-5 text-sm font-medium text-white/60">${(log.driver_payout_cents / 100).toFixed(2)}</td>
                                    <td className="px-8 py-5 text-right">
                                        <span className="text-[9px] font-black bg-green-500/10 text-green-400 border border-green-500/20 px-2 py-1 rounded-md uppercase tracking-tight">VERIFIED</span>
                                    </td>
                                </tr>
                            ))}
                            {logs.length === 0 && (
                                <tr>
                                    <td colSpan={5} className="px-8 py-20 text-center text-white/10 font-orbitron tracking-widest text-xs">NO LEDGER ENTRIES FOUND</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

const StatCard = ({ title, value, icon, trend, isHighlight = false }: any) => (
    <div className={`p-8 rounded-[2.5rem] border backdrop-blur-3xl transition-all hover:scale-[1.02] hover:shadow-2xl ${isHighlight ? 'bg-gradient-to-br from-purple-500/10 to-cyan-500/10 border-white/20' : 'bg-white/5 border-white/10'}`}>
        <div className="flex justify-between items-start mb-6">
            <div className="p-3 bg-white/5 rounded-2xl border border-white/5">{icon}</div>
            <div className={`flex items-center gap-1 text-[10px] font-black ${trend.startsWith('+') ? 'text-green-400' : 'text-red-400'}`}>
                {trend.startsWith('+') ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                {trend}
            </div>
        </div>
        <h3 className="text-xs font-black text-white/40 uppercase tracking-[0.2em] mb-2">{title}</h3>
        <p className="text-4xl font-black text-white tracking-tight">{value}</p>
    </div>
);
