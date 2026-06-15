import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { Vault, TrendingUp, Zap, Users, RefreshCw, MapPin, Banknote, CheckCircle, AlertCircle } from 'lucide-react';

interface ReserveBalance {
    total_locked_cents: number;
    total_deployed_cents: number;
    total_released_cents: number;
    net_available_cents: number;
    ride_count: number;
}

interface ReferralStat {
    type: string;
    total_referrers: number;
    total_earnings_cents: number;
}

interface SurgeZone {
    id: string;
    name: string;
    surge_multiplier: number;
    is_active: boolean;
    expires_at: string | null;
    center_lat: number;
    center_lng: number;
    radius_km: number;
}

interface LoanRow {
    id: string;
    driver_id: string;
    principal_cents: number;
    balance_cents: number;
    installment_cents: number;
    interest_rate: number;
    status: 'active' | 'paid_off' | 'defaulted' | 'written_off';
    notes: string | null;
    created_at: string;
    drivers: {
        profiles: { name: string } | null;
    } | null;
}

const fmt = (cents: number) => `$${(cents / 100).toLocaleString('en-TT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TTD`;

export function WarChest() {
    const [reserve, setReserve] = useState<ReserveBalance | null>(null);
    const [referralStats, setReferralStats] = useState<ReferralStat[]>([]);
    const [surgeZones, setSurgeZones] = useState<SurgeZone[]>([]);
    const [loans, setLoans] = useState<LoanRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [surgeForm, setSurgeForm] = useState({ lat: '', lng: '', radius: '1.5', multiplier: '1.3', hours: '2' });
    const [surgeSubmitting, setSurgeSubmitting] = useState(false);
    const [surgeMsg, setSurgeMsg] = useState('');
    const [loanForm, setLoanForm] = useState({ driverId: '', principalTTD: '', installmentTTD: '50', notes: '' });
    const [loanSubmitting, setLoanSubmitting] = useState(false);
    const [loanMsg, setLoanMsg] = useState('');

    const load = useCallback(async () => {
        setLoading(true);
        const [reserveRes, referralRes, zonesRes, loansRes] = await Promise.all([
            supabase.rpc('admin_get_reserve_balance'),
            supabase.from('referral_earnings')
                .select('type, referrer_id, amount_cents')
                .eq('status', 'paid'),
            supabase.from('pricing_zones')
                .select('*')
                .eq('is_active', true)
                .order('created_at', { ascending: false }),
            supabase.from('driver_loans')
                .select('*, drivers!inner(profiles(name))')
                .order('created_at', { ascending: false })
                .limit(30),
        ]);

        if (reserveRes.data) {
            const r = Array.isArray(reserveRes.data) ? reserveRes.data[0] : reserveRes.data;
            setReserve(r as ReserveBalance);
        }

        if (referralRes.data) {
            const grouped: Record<string, { total_referrers: Set<string>; total_earnings_cents: number }> = {};
            for (const row of referralRes.data) {
                if (!grouped[row.type]) grouped[row.type] = { total_referrers: new Set(), total_earnings_cents: 0 };
                grouped[row.type].total_referrers.add(row.referrer_id);
                grouped[row.type].total_earnings_cents += row.amount_cents || 0;
            }
            setReferralStats(Object.entries(grouped).map(([type, v]) => ({
                type, total_referrers: v.total_referrers.size, total_earnings_cents: v.total_earnings_cents,
            })));
        }

        setSurgeZones((zonesRes.data as SurgeZone[]) || []);
        setLoans((loansRes.data as LoanRow[]) || []);
        setLoading(false);
    }, []);

    useEffect(() => { load(); }, [load]);

    const activateSurge = async () => {
        const { lat, lng, radius, multiplier, hours } = surgeForm;
        if (!lat || !lng) { setSurgeMsg('Enter lat/lng coordinates'); return; }
        setSurgeSubmitting(true); setSurgeMsg('');
        const expiresAt = new Date(Date.now() + parseFloat(hours) * 3600 * 1000).toISOString();
        const { error } = await supabase.rpc('admin_set_surge_zone', {
            p_lat: parseFloat(lat), p_lng: parseFloat(lng),
            p_radius_km: parseFloat(radius), p_multiplier: parseFloat(multiplier),
            p_expires_at: expiresAt,
        });
        if (error) { setSurgeMsg(`Error: ${error.message}`); }
        else { setSurgeMsg(`Surge ${multiplier}x activated for ${hours}h`); load(); }
        setSurgeSubmitting(false);
    };

    const deactivateSurge = async (zoneId: string) => {
        await supabase.from('pricing_zones').update({ is_active: false }).eq('id', zoneId);
        load();
    };

    const createLoan = async () => {
        const { driverId, principalTTD, installmentTTD, notes } = loanForm;
        if (!driverId.trim()) { setLoanMsg('Driver ID is required'); return; }
        const principalCents = Math.round(parseFloat(principalTTD) * 100);
        const installmentCents = Math.round(parseFloat(installmentTTD) * 100);
        if (isNaN(principalCents) || principalCents <= 0) { setLoanMsg('Enter a valid principal amount'); return; }
        if (isNaN(installmentCents) || installmentCents <= 0) { setLoanMsg('Enter a valid installment amount'); return; }
        setLoanSubmitting(true); setLoanMsg('');
        const { error } = await supabase.rpc('admin_create_driver_loan', {
            p_driver_id: driverId.trim(),
            p_principal_cents: principalCents,
            p_installment_cents: installmentCents,
            p_notes: notes || null,
        });
        if (error) { setLoanMsg(`Error: ${error.message}`); }
        else {
            setLoanMsg(`Loan of ${fmt(principalCents)} created`);
            setLoanForm({ driverId: '', principalTTD: '', installmentTTD: '50', notes: '' });
            load();
        }
        setLoanSubmitting(false);
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-96">
                <div className="w-10 h-10 border-4 border-cyan-400 border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    const deployPct = reserve && reserve.total_locked_cents > 0
        ? Math.round((reserve.total_deployed_cents / reserve.total_locked_cents) * 100)
        : 0;

    const activeLoans = loans.filter(l => l.status === 'active');
    const totalLoanedCents = activeLoans.reduce((s, l) => s + l.balance_cents, 0);

    return (
        <div className="space-y-10">

            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-black text-white italic">WAR CHEST</h2>
                    <p className="text-xs text-white/30 uppercase tracking-widest mt-1">Capital Reserve · Referral Engine · Surge Control · Driver Loans</p>
                </div>
                <button onClick={load} aria-label="Refresh war chest data" className="p-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-white/40 hover:text-white transition-all">
                    <RefreshCw size={18} />
                </button>
            </div>

            {/* Reserve Balance */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                    { label: 'Available Reserve', value: fmt(reserve?.net_available_cents ?? 0), icon: <Vault size={20}/>, color: 'text-cyan-400', border: 'border-cyan-400/20' },
                    { label: 'Total Locked (All Time)', value: fmt(reserve?.total_locked_cents ?? 0), icon: <TrendingUp size={20}/>, color: 'text-purple-400', border: 'border-purple-400/20' },
                    { label: 'Deployed', value: fmt(reserve?.total_deployed_cents ?? 0), icon: <Zap size={20}/>, color: 'text-yellow-400', border: 'border-yellow-400/20' },
                    { label: 'Rides Contributing', value: (reserve?.ride_count ?? 0).toLocaleString(), icon: <Users size={20}/>, color: 'text-green-400', border: 'border-green-400/20' },
                ].map((card) => (
                    <div key={card.label} className={`bg-white/5 rounded-2xl p-6 border ${card.border}`}>
                        <div className={`${card.color} mb-3`}>{card.icon}</div>
                        <p className="text-xs text-white/30 uppercase tracking-widest mb-1">{card.label}</p>
                        <p className="text-2xl font-black text-white">{card.value}</p>
                    </div>
                ))}
            </div>

            {/* Reserve utilization bar */}
            {reserve && reserve.total_locked_cents > 0 && (
                <div className="bg-white/5 rounded-2xl p-6 border border-white/10">
                    <div className="flex justify-between items-center mb-3">
                        <span className="text-xs font-black text-white/40 uppercase tracking-widest">Reserve Utilization</span>
                        <span className="text-xs font-black text-cyan-400">{deployPct}% Deployed</span>
                    </div>
                    <div className="h-3 bg-white/10 rounded-full overflow-hidden">
                        <div className="h-full bg-cyan-400 rounded-full transition-all" style={{ width: `${deployPct}%` }} />
                    </div>
                    <p className="text-[10px] text-white/20 mt-2 uppercase tracking-widest">
                        1.5% of every ride fare locked · Deployed funds earn revenue · Available funds earn 0%
                    </p>
                </div>
            )}

            {/* ── DRIVER LOANS ─────────────────────────────────────── */}
            <div className="bg-white/5 rounded-2xl p-6 border border-white/10">
                <div className="flex items-center gap-3 mb-6">
                    <Banknote size={20} className="text-cyan-400" />
                    <div>
                        <h3 className="font-black text-white uppercase tracking-wider text-sm">Driver Loan Programme</h3>
                        <p className="text-[10px] text-white/30 uppercase tracking-widest">
                            Deploy reserve capital as driver loans · Repaid via per-ride deduction
                            {activeLoans.length > 0 && ` · ${activeLoans.length} active · ${fmt(totalLoanedCents)} outstanding`}
                        </p>
                    </div>
                </div>

                {/* Loan creation form */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
                    {[
                        { key: 'driverId', label: 'Driver UUID', placeholder: 'paste driver id...' },
                        { key: 'principalTTD', label: 'Principal (TTD)', placeholder: '500' },
                        { key: 'installmentTTD', label: 'Per-Ride Deduction (TTD)', placeholder: '50' },
                        { key: 'notes', label: 'Notes (optional)', placeholder: 'BYD deposit, emergency...' },
                    ].map(f => (
                        <div key={f.key}>
                            <label className="block text-[10px] font-black text-white/30 uppercase tracking-widest mb-1">{f.label}</label>
                            <input
                                type="text"
                                value={loanForm[f.key as keyof typeof loanForm]}
                                onChange={e => setLoanForm({ ...loanForm, [f.key]: e.target.value })}
                                placeholder={f.placeholder}
                                className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white text-sm font-mono focus:outline-none focus:border-cyan-400/50"
                            />
                        </div>
                    ))}
                </div>

                <div className="flex items-center gap-4 mb-6">
                    <button
                        onClick={createLoan}
                        disabled={loanSubmitting}
                        className="px-6 py-3 bg-cyan-500 text-black font-black text-xs uppercase tracking-widest rounded-xl hover:bg-cyan-400 transition-all disabled:opacity-50"
                    >
                        {loanSubmitting ? 'Creating...' : 'Issue Loan'}
                    </button>
                    {loanMsg && (
                        <p className={`text-sm font-bold flex items-center gap-2 ${loanMsg.startsWith('Error') ? 'text-red-400' : 'text-green-400'}`}>
                            {loanMsg.startsWith('Error') ? <AlertCircle size={14}/> : <CheckCircle size={14}/>}
                            {loanMsg}
                        </p>
                    )}
                </div>

                {/* Outstanding loans list */}
                {loans.length === 0 ? (
                    <p className="text-white/20 text-sm italic">No loans issued yet</p>
                ) : (
                    <div className="space-y-3">
                        {loans.map(loan => {
                            const paidPct = Math.round(((loan.principal_cents - loan.balance_cents) / loan.principal_cents) * 100);
                            const statusColor = loan.status === 'active' ? 'text-cyan-400' : loan.status === 'paid_off' ? 'text-green-400' : 'text-red-400';
                            const driverName = (loan.drivers as any)?.profiles?.name ?? loan.driver_id.slice(0, 8) + '...';
                            return (
                                <div key={loan.id} className="flex items-center justify-between p-4 bg-white/5 rounded-xl border border-white/10 gap-4">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-3 mb-2">
                                            <span className="text-sm font-black text-white truncate">{driverName}</span>
                                            <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border ${statusColor} bg-white/5 border-current/30`}>{loan.status.replace('_', ' ')}</span>
                                        </div>
                                        <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                                            <div className="h-full bg-cyan-400 rounded-full" style={{ width: `${paidPct}%` }} />
                                        </div>
                                        <p className="text-[10px] text-white/30 mt-1">{paidPct}% repaid · {fmt(loan.installment_cents)}/ride deduction</p>
                                        {loan.notes && <p className="text-[10px] text-white/20 mt-0.5 italic truncate">{loan.notes}</p>}
                                    </div>
                                    <div className="text-right shrink-0">
                                        <p className="text-[10px] text-white/30 uppercase tracking-widest">Balance</p>
                                        <p className="text-lg font-black text-white">{fmt(loan.balance_cents)}</p>
                                        <p className="text-[10px] text-white/20">of {fmt(loan.principal_cents)}</p>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Referral Engine */}
            <div className="bg-white/5 rounded-2xl p-6 border border-white/10">
                <div className="flex items-center gap-3 mb-6">
                    <Users size={20} className="text-purple-400" />
                    <div>
                        <h3 className="font-black text-white uppercase tracking-wider text-sm">Referral Engine</h3>
                        <p className="text-[10px] text-white/30 uppercase tracking-widest">TTD $15 signup credit · Driver earns 1% platform fee for 90 days</p>
                    </div>
                </div>
                {referralStats.length === 0 ? (
                    <p className="text-white/20 text-sm italic">No referral earnings recorded yet</p>
                ) : (
                    <div className="space-y-3">
                        {referralStats.map((stat) => (
                            <div key={stat.type} className="flex items-center justify-between p-4 bg-white/5 rounded-xl border border-white/10">
                                <div>
                                    <span className="text-xs font-black uppercase text-white/60 tracking-widest">{stat.type} referrals</span>
                                    <p className="text-white font-black text-lg mt-1">{stat.total_referrers} referrers active</p>
                                </div>
                                <div className="text-right">
                                    <p className="text-[10px] text-white/30 uppercase tracking-widest">Total Paid</p>
                                    <p className="text-xl font-black text-green-400">{fmt(stat.total_earnings_cents)}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Surge Zone Activation */}
            <div className="bg-white/5 rounded-2xl p-6 border border-white/10">
                <div className="flex items-center gap-3 mb-6">
                    <MapPin size={20} className="text-yellow-400" />
                    <div>
                        <h3 className="font-black text-white uppercase tracking-wider text-sm">Surge Pricing Control</h3>
                        <p className="text-[10px] text-white/30 uppercase tracking-widest">Activate a zone · estimate_fare reads the multiplier in real time</p>
                    </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
                    {[
                        { key: 'lat', label: 'Latitude', placeholder: '10.6549' },
                        { key: 'lng', label: 'Longitude', placeholder: '-61.5019' },
                        { key: 'radius', label: 'Radius (km)', placeholder: '1.5' },
                        { key: 'multiplier', label: 'Multiplier', placeholder: '1.3' },
                        { key: 'hours', label: 'Duration (hrs)', placeholder: '2' },
                    ].map(f => (
                        <div key={f.key}>
                            <label className="block text-[10px] font-black text-white/30 uppercase tracking-widest mb-1">{f.label}</label>
                            <input
                                type="number"
                                step="any"
                                value={surgeForm[f.key as keyof typeof surgeForm]}
                                onChange={e => setSurgeForm({ ...surgeForm, [f.key]: e.target.value })}
                                placeholder={f.placeholder}
                                className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white text-sm font-mono focus:outline-none focus:border-yellow-400/50"
                            />
                        </div>
                    ))}
                </div>

                <div className="flex items-center gap-4">
                    <button
                        onClick={activateSurge}
                        disabled={surgeSubmitting}
                        aria-label="Activate surge pricing zone"
                        className="px-6 py-3 bg-yellow-500 text-black font-black text-xs uppercase tracking-widest rounded-xl hover:bg-yellow-400 transition-all disabled:opacity-50"
                    >
                        {surgeSubmitting ? 'Activating...' : 'Activate Surge Zone'}
                    </button>
                    {surgeMsg && <p className={`text-sm font-bold ${surgeMsg.startsWith('Error') ? 'text-red-400' : 'text-green-400'}`}>{surgeMsg}</p>}
                </div>
            </div>

            {/* Active Surge Zones */}
            {surgeZones.length > 0 && (
                <div className="bg-white/5 rounded-2xl p-6 border border-yellow-400/20">
                    <h3 className="font-black text-yellow-400 uppercase tracking-wider text-sm mb-4">Active Surge Zones ({surgeZones.length})</h3>
                    <div className="space-y-3">
                        {surgeZones.map(zone => (
                            <div key={zone.id} className="flex items-center justify-between p-4 bg-yellow-400/5 rounded-xl border border-yellow-400/10">
                                <div>
                                    <p className="text-white font-black text-sm">{zone.surge_multiplier}x — {zone.name}</p>
                                    <p className="text-[10px] text-white/30 uppercase tracking-widest mt-1">
                                        {zone.center_lat?.toFixed(4)}, {zone.center_lng?.toFixed(4)} · r={zone.radius_km}km
                                        {zone.expires_at && ` · expires ${new Date(zone.expires_at).toLocaleTimeString()}`}
                                    </p>
                                </div>
                                <button
                                    onClick={() => deactivateSurge(zone.id)}
                                    aria-label={`Deactivate surge zone ${zone.name}`}
                                    className="px-4 py-2 bg-red-500/20 border border-red-500/30 text-red-400 text-xs font-black uppercase tracking-widest rounded-xl hover:bg-red-500/30 transition-all"
                                >
                                    Deactivate
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

        </div>
    );
}
