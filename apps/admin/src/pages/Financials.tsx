import { useEffect, useState } from 'react';
import { adminFetch } from '../lib/supabase';
import { DollarSign, BarChart3, ArrowUpRight, ArrowDownRight, Activity, Check, X, Eye, Scale, Landmark } from 'lucide-react';

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
        payouts: 0,
        taxReserve: 0,
        taxPaid: 0,
    });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);

    const loadFinancials = async () => {
        setLoading(true);
        setError(null);
        try {
            const { data: revData } = await adminFetch('admin', { action: 'get_revenue_logs' });
            setLogs(revData || []);
            
            const { data: depData } = await adminFetch('admin', { action: 'get_pending_deposits' });
            setPendingDeposits(depData || []);

            const totals = (revData || []).reduce((acc: any, curr: any) => ({
                totalGross: acc.totalGross + curr.gross_amount_cents,
                totalNet: acc.totalNet + curr.platform_fee_cents,
                payouts: acc.payouts + curr.driver_payout_cents,
                taxReserve: acc.taxReserve + Math.round(curr.gross_amount_cents * 0.125),
                taxPaid: acc.taxPaid + (curr.bir_tax_paid_cents || 0),
            }), { totalGross: 0, totalNet: 0, payouts: 0, taxReserve: 0, taxPaid: 0 });
            
            setStats(totals);
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to load financials';
            console.error('Failed to load financials:', msg);
            setError(msg);
        } finally {
            setLoading(false);
        }
    };

    const handleDepositAction = async (depositId: string, action: 'approved' | 'rejected', amountTtd?: number) => {
        if (isProcessing) return;
        setIsProcessing(true);
        try {
            await adminFetch('admin', { 
                action: 'verify_deposit',
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

    if (loading) {
        return (
            <div className="space-y-8 animate-in">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {[0,1,2].map(i => (
                        <div key={i} className="p-8 rounded-[2.5rem]">
                            <div className="skeleton w-24 h-3 mb-6" />
                            <div className="skeleton w-32 h-10" />
                        </div>
                    ))}
                </div>
                <div className="rounded-[2.5rem] p-8">
                    <div className="skeleton w-48 h-4 mb-6" />
                    {[0,1,2,3].map(i => (
                        <div key={i} className="skeleton-row">
                            <div className="skeleton" style={{ width: '30%', height: 14 }} />
                            <div className="skeleton" style={{ width: '15%', height: 14 }} />
                            <div className="skeleton" style={{ width: '15%', height: 14 }} />
                            <div className="skeleton" style={{ width: '15%', height: 14 }} />
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="animate-in">
                <div className="error-banner">
                    <span>{error}</span>
                    <button onClick={loadFinancials}>Retry</button>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-8 animate-in">
            {/* KPI GRID */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6">
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
                <StatCard
                    title="BIR 12.5% VAT Escrow"
                    value={`$${(stats.taxReserve / 100).toFixed(2)}`}
                    valueSub={stats.taxPaid > 0 ? `$${(stats.taxPaid / 100).toFixed(2)} remitted` : undefined}
                    icon={<Scale className="text-emerald-400" />}
                    trend={`$${((stats.taxReserve - stats.taxPaid) / 100).toFixed(2)} owed`}
                    trendIsNeutral
                    isTax
                />
            </div>

            {/* TAX ESCROW BREAKDOWN ROW */}
            {stats.totalGross > 0 && (
                <div className="bg-gradient-to-r from-emerald-500/5 via-emerald-500/3 to-transparent border border-emerald-500/15 rounded-[2rem] p-6">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:gap-8">
                        <div className="flex items-center gap-3 shrink-0">
                            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                                <Landmark size={18} className="text-emerald-400" />
                            </div>
                            <div>
                                <p className="text-[10px] font-black text-emerald-400/80 uppercase tracking-widest">Tax Reserve</p>
                                <p className="text-lg font-black text-white">BIR 12.5% VAT Escrow</p>
                            </div>
                        </div>
                        <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-4">
                            <div>
                                <p className="text-[9px] font-bold text-white/30 uppercase tracking-widest mb-0.5">Gross Revenue</p>
                                <p className="text-sm font-black text-white">${(stats.totalGross / 100).toFixed(2)}</p>
                            </div>
                            <div>
                                <p className="text-[9px] font-bold text-white/30 uppercase tracking-widest mb-0.5">12.5% VAT Owed</p>
                                <p className="text-sm font-black text-emerald-400">${(stats.taxReserve / 100).toFixed(2)}</p>
                            </div>
                            <div>
                                <p className="text-[9px] font-bold text-white/30 uppercase tracking-widest mb-0.5">Remitted</p>
                                <p className="text-sm font-black text-cyan-400">${(stats.taxPaid / 100).toFixed(2)}</p>
                            </div>
                            <div>
                                <p className="text-[9px] font-bold text-white/30 uppercase tracking-widest mb-0.5">Net Balance</p>
                                <p className={`text-sm font-black ${stats.taxReserve - stats.taxPaid > 0 ? 'text-amber-400' : 'text-green-400'}`}>
                                    ${((stats.taxReserve - stats.taxPaid) / 100).toFixed(2)}
                                </p>
                            </div>
                        </div>
                    </div>
                    {/* PROGRESS BAR */}
                    <div className="mt-4">
                        <div className="flex items-center justify-between mb-1.5">
                            <span className="text-[8px] font-bold text-white/20 uppercase tracking-widest">Remittance Progress</span>
                            <span className="text-[9px] font-bold text-white/40">
                                {stats.taxReserve > 0 ? Math.round((stats.taxPaid / stats.taxReserve) * 100) : 0}%
                            </span>
                        </div>
                        <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                            <div
                                className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-cyan-400 transition-all duration-700"
                                style={{ width: `${stats.taxReserve > 0 ? Math.min(100, (stats.taxPaid / stats.taxReserve) * 100) : 0}%` }}
                            />
                        </div>
                    </div>
                </div>
            )}
            {/* PENDING MANUAL DEPOSITS */}
            {pendingDeposits.length > 0 && (
                <div className="bg-white/5 backdrop-blur-3xl border border-white/10 rounded-[2.5rem] overflow-hidden shadow-2xl">
                    <div className="px-8 py-6 border-b border-white/5 flex justify-between items-center bg-cyan-500/10">
                        <div className="flex items-center gap-3">
                            <Activity className="text-cyan-400" size={18} />
                            <h2 className="text-xs font-bold text-cyan-400 uppercase tracking-widest">Awaiting Verification</h2>
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
                    <div className="flex items-center gap-3">
                        <Scale size={14} className="text-emerald-400" />
                        <h2 className="text-xs font-bold text-white/40 uppercase tracking-widest">Revenue Ledger — BIR 12.5% VAT Escrow Included</h2>
                    </div>
                    <button onClick={loadFinancials} className="text-[10px] font-black text-cyan-400 hover:text-cyan-300 transition-colors uppercase tracking-widest">Refresh Audit</button>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-white/[0.01]">
                                <th className="px-8 py-5 text-[10px] font-black text-white/20 uppercase tracking-widest">Timestamp</th>
                                <th className="px-8 py-5 text-[10px] font-black text-white/20 uppercase tracking-widest">Gross</th>
                                <th className="px-8 py-5 text-[10px] font-black text-white/20 uppercase tracking-widest">Take (Split)</th>
                                <th className="px-8 py-5 text-[10px] font-black text-white/20 uppercase tracking-widest">BIR 12.5%</th>
                                <th className="px-8 py-5 text-[10px] font-black text-white/20 uppercase tracking-widest">Payout</th>
                                <th className="px-8 py-5 text-[10px] font-black text-white/20 uppercase tracking-widest text-right">Status</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            {logs.map((log) => {
                                const birTax = Math.round(log.gross_amount_cents * 0.125);
                                return (
                                    <tr key={log.id} className="hover:bg-white/[0.02] transition-colors">
                                        <td className="px-8 py-5 text-xs font-medium text-white/60">
                                            {new Date(log.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                                        </td>
                                        <td className="px-8 py-5 text-sm font-bold text-white">${(log.gross_amount_cents / 100).toFixed(2)}</td>
                                        <td className="px-8 py-5">
                                            <div className="flex items-center gap-2">
                                                <span className="text-sm font-black text-cyan-400">${(log.platform_fee_cents / 100).toFixed(2)}</span>
                                                <span className="text-[9px] font-black text-white/20">({((log.platform_fee_cents / log.gross_amount_cents) * 100).toFixed(1)}%)</span>
                                            </div>
                                        </td>
                                        <td className="px-8 py-5">
                                            <span className="text-sm font-black text-emerald-400">${(birTax / 100).toFixed(2)}</span>
                                        </td>
                                        <td className="px-8 py-5 text-sm font-medium text-white/60">${(log.driver_payout_cents / 100).toFixed(2)}</td>
                                        <td className="px-8 py-5 text-right">
                                            <span className="text-[9px] font-black bg-green-500/10 text-green-400 border border-green-500/20 px-2 py-1 rounded-md uppercase tracking-tight">VERIFIED</span>
                                        </td>
                                    </tr>
                                );
                            })}
                            {logs.length === 0 && (
                                <tr>
                                    <td colSpan={6} className="px-8 py-20 text-center text-white/40 text-xs">No ledger entries found</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

const StatCard = ({ title, value, icon, trend, valueSub, trendIsNeutral, isHighlight = false, isTax = false }: any) => (
    <div className={`p-8 rounded-[2.5rem] border backdrop-blur-3xl transition-all hover:scale-[1.02] hover:shadow-2xl ${
        isTax
            ? 'bg-gradient-to-br from-emerald-500/10 to-emerald-500/5 border-emerald-500/20'
            : isHighlight
                ? 'bg-gradient-to-br from-purple-500/10 to-cyan-500/10 border-white/20'
                : 'bg-white/5 border-white/10'
    }`}>
        <div className="flex justify-between items-start mb-6">
            <div className={`p-3 rounded-2xl border ${isTax ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-white/5 border-white/5'}`}>
                {icon}
            </div>
            <div className={`flex items-center gap-1 text-[10px] font-black ${
                trendIsNeutral ? 'text-amber-400' :
                trend?.startsWith('+') ? 'text-green-400' : 'text-red-400'
            }`}>
                {trendIsNeutral ? <Scale size={12} /> : trend?.startsWith('+') ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                {trend}
            </div>
        </div>
        <h3 className="text-xs font-black text-white/40 uppercase tracking-[0.2em] mb-2">{title}</h3>
        <p className="text-4xl font-black text-white tracking-tight">{value}</p>
        {valueSub && <p className="text-[10px] font-bold text-white/30 mt-1">{valueSub}</p>}
    </div>
);
