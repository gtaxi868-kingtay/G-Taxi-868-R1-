import { useEffect, useState, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { DollarSign, Download, Calendar, ArrowUpRight, Sparkles } from 'lucide-react';

interface RevenueSummary {
    month: string;
    total_transactions: number;
    total_gross_cents: number;
    total_platform_commission_cents: number;
    total_merchant_earnings_cents: number;
}

export const MerchantFinancials = ({ merchantId }: { merchantId: string }) => {
    const [summary, setSummary] = useState<RevenueSummary[]>([]);
    const [loading, setLoading] = useState(false);
    const [nodeEarningsCents, setNodeEarningsCents] = useState(0);
    const [nodeId, setNodeId] = useState<string | null>(null);
    const debounceRef = useRef<NodeJS.Timeout | null>(null);

    const fetchNodeEarnings = useCallback(async (nId: string) => {
        const { data, error } = await supabase
            .rpc('get_merchant_earnings', { p_merchant_id: merchantId });
        const earningsData = data as unknown as { total_cents?: number } | null;
        if (error) {
            const { data: splits } = await supabase
                .from('revenue_splits')
                .select('merchant_cut')
                .eq('node_id', nId)
                .eq('status', 'settled');
            const total = (splits || []).reduce((sum: number, r: any) => sum + (r.merchant_cut || 0), 0);
            setNodeEarningsCents(total);
        } else if (earningsData?.total_cents !== undefined) {
            setNodeEarningsCents(earningsData.total_cents);
        }
    }, [merchantId]);

    const debouncedRefresh = useCallback((nId: string) => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            fetchNodeEarnings(nId);
        }, 2000);
    }, [fetchNodeEarnings]);

    useEffect(() => {
        if (!merchantId) return;
        (async () => {
            const { data: nodes } = await supabase
                .from('kiosk_nodes')
                .select('id')
                .eq('merchant_id', merchantId)
                .limit(1);
            if (nodes && nodes.length > 0) {
                const nId = nodes[0].id;
                setNodeId(nId);
                fetchNodeEarnings(nId);
            }
        })();
        loadData();
    }, [merchantId]);

    useEffect(() => {
        if (!nodeId) return;
        const channel = supabase
            .channel(`merchant-earnings-${nodeId}`)
            .on('postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'revenue_splits', filter: `node_id=eq.${nodeId}` },
                () => { debouncedRefresh(nodeId); }
            )
            .subscribe();
        return () => {
            channel.unsubscribe();
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
    }, [nodeId, debouncedRefresh]);

    const loadData = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('v_merchant_revenue_summary')
                .select('*')
                .eq('merchant_id', merchantId)
                .order('month', { ascending: false });
            if (error) throw error;
            setSummary(data || []);
        } catch (err) {
            console.error('Error loading merchant financials:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleExport = async (month: string) => {
        try {
            const { data, error } = await supabase
                .from('platform_revenue_logs')
                .select('ride_id, created_at, gross_amount_cents, platform_fee_cents, merchant_split_cents')
                .eq('merchant_id', merchantId)
                .gte('created_at', month)
                .lt('created_at', new Date(new Date(month).setMonth(new Date(month).getMonth() + 1)).toISOString());

            if (error) throw error;

            const csvRows = [
                ['Ride ID', 'Date', 'Gross (TTD)', 'Platform Fee', 'Merchant Earnings'],
                ...(data || []).map((row: any) => [
                    row.ride_id,
                    new Date(row.created_at).toLocaleDateString(),
                    (row.gross_amount_cents / 100).toFixed(2),
                    (row.platform_fee_cents / 100).toFixed(2),
                    (row.merchant_split_cents / 100).toFixed(2)
                ])
            ];

            const csvContent = "data:text/csv;charset=utf-8," + csvRows.map(e => e.join(",")).join("\n");
            const encodedUri = encodeURI(csvContent);
            const link = document.createElement("a");
            link.setAttribute("href", encodedUri);
            link.setAttribute("download", `G-TAXI_MANIFEST_${month.split('T')[0]}.csv`);
            document.body.appendChild(link);
            link.click();
        } catch (err) {
            alert('Export failed: ' + err);
        }
    };

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="bg-gradient-to-br from-[#007070] to-[#004f4f] p-8 rounded-[2rem] text-white shadow-xl">
                <div className="flex items-center justify-between mb-2">
                    <p className="text-[10px] font-black uppercase tracking-[0.3em] opacity-70">Live Node Earnings</p>
                    <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                </div>
                <p className="text-4xl sm:text-5xl font-black tracking-tight">
                    ${(nodeEarningsCents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
                <p className="text-xs font-bold opacity-60 mt-2 uppercase tracking-widest">TTD · 5% Merchant Share · Synced</p>
                <div className="mt-4 h-1.5 bg-white/20 rounded-full overflow-hidden">
                    <div className="h-full w-3/4 bg-white/60 rounded-full" />
                </div>
            </div>

            <div className="bg-[#13171D] rounded-[3rem] p-10 border border-[#007070]/20">
                <div className="flex items-center gap-6 mb-10">
                    <div className="w-16 h-16 bg-[#007070]/20 rounded-3xl flex items-center justify-center border border-[#007070]/30">
                        <DollarSign className="text-[#0D9488]" size={32} />
                    </div>
                    <div>
                        <h2 className="text-2xl font-black tracking-tight text-white">Financial Health</h2>
                        <p className="text-xs font-black text-[#5A5F66] uppercase tracking-widest mt-1">Real-time Revenue Split Engine</p>
                    </div>
                </div>

                <div className="space-y-4">
                    {summary.map((row, i) => (
                        <div key={i} className="p-8 bg-[#0B0E12] rounded-[2.5rem] border border-[#007070]/20 flex flex-col md:flex-row items-center justify-between gap-6 group hover:border-[#0D9488]/30 transition-all">
                            <div className="flex items-center gap-8">
                                <div className="text-center md:text-left">
                                    <p className="text-[10px] font-black text-[#5A5F66] uppercase tracking-widest mb-1">Billing Period</p>
                                    <div className="flex items-center gap-3">
                                        <Calendar size={16} className="text-[#0D9488]" />
                                        <span className="text-xl font-black text-white">{new Date(row.month).toLocaleDateString([], { month: 'long', year: 'numeric' })}</span>
                                    </div>
                                </div>
                                <div className="w-px h-12 bg-[#007070]/20 hidden md:block" />
                                <div>
                                    <p className="text-[10px] font-black text-[#5A5F66] uppercase tracking-widest mb-1">Guest Rides</p>
                                    <span className="text-lg font-black text-white">{row.total_transactions} Total</span>
                                </div>
                            </div>

                            <div className="flex flex-col md:items-end">
                                <p className="text-[10px] font-black text-[#5A5F66] uppercase tracking-widest mb-1">Gross Managed Volume</p>
                                <span className="text-3xl font-black text-white">${(row.total_gross_cents / 100).toFixed(2)} <span className="text-sm opacity-30">TTD</span></span>
                                <p className="text-[9px] font-bold text-[#5A5F66] uppercase mt-1">Platform Commission: ${(row.total_platform_commission_cents / 100).toFixed(2)}</p>
                            </div>

                            <button
                                onClick={() => handleExport(row.month)}
                                className="h-16 px-10 bg-[#007070] text-white rounded-2xl font-black text-xs uppercase tracking-widest flex items-center gap-3 hover:bg-[#004f4f] transition-all shadow-xl shadow-[#007070]/10"
                            >
                                <Download size={18} />
                                Download Manifest
                            </button>
                        </div>
                    ))}
                    {summary.length === 0 && !loading && (
                        <div className="py-20 text-center text-[#5A5F66] italic">No Financial Records Found Yet</div>
                    )}
                </div>
            </div>

            <div className="bg-[#007070] rounded-[3rem] p-12 text-white flex items-center justify-between overflow-hidden relative">
                <div className="relative z-10 max-w-lg">
                    <h3 className="text-2xl font-black mb-4 italic">B2B REFERRAL BONUS</h3>
                    <p className="opacity-70 font-medium leading-relaxed">Earn a 3% kickback on every guest ride exceeding $50 TTD. Revenue reflected in next month's statement.</p>
                </div>
                <div className="relative z-10">
                    <ArrowUpRight size={100} className="opacity-20" />
                </div>
                <div className="absolute top-0 right-0 p-12 opacity-5 scale-150 rotate-12">
                    <Sparkles size={200} />
                </div>
            </div>
        </div>
    );
};
