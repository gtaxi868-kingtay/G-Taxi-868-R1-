import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { Wine, QrCode, Loader2, RefreshCw } from 'lucide-react';

interface Venue {
    id: string;
    name: string;
    address: string;
    membership_price_cents: number | null;
    drink_subsidy_cap_cents: number;
    status: 'candidate' | 'active' | 'closed';
    active_members: number;
}

function fmtTTD(cents: number | null) {
    if (cents == null) return '—';
    return `TTD $${(cents / 100).toLocaleString('en-TT', { minimumFractionDigits: 2 })}`;
}

export const MerchantGSpot = () => {
    const [venue, setVenue] = useState<Venue | null | undefined>(undefined);
    const [loading, setLoading] = useState(true);

    const [redeemCode, setRedeemCode] = useState('');
    const [redeemAmount, setRedeemAmount] = useState('');
    const [redeeming, setRedeeming] = useState(false);
    const [redeemResult, setRedeemResult] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase.functions.invoke('merchant', { body: { action: 'get_my_g_spot_venue' } });
            if (!error && data?.success) setVenue(data.venue);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const redeem = async () => {
        const cents = Math.round(parseFloat(redeemAmount) * 100);
        if (!redeemCode.trim() || !cents || cents < 0) {
            alert("Enter the rider's code and a discount amount in TTD");
            return;
        }
        setRedeeming(true);
        setRedeemResult(null);
        try {
            const { data, error } = await supabase.functions.invoke('merchant', {
                body: { action: 'redeem_g_spot_code', code: redeemCode.trim(), discount_cents: cents },
            });
            if (error || !data?.success) throw new Error(data?.error || error?.message || 'Redemption failed');
            const { drink_subsidy_used_cents, drink_subsidy_cap_cents } = data.result;
            setRedeemResult(`Applied. Used ${fmtTTD(drink_subsidy_used_cents)} of ${fmtTTD(drink_subsidy_cap_cents)} this cycle.`);
            setRedeemCode('');
            setRedeemAmount('');
        } catch (err: any) {
            setRedeemResult(err.message || 'Redemption failed');
        } finally {
            setRedeeming(false);
        }
    };

    if (loading) {
        return <div className="py-24 text-center"><Loader2 className="animate-spin mx-auto text-white/30" size={28} /></div>;
    }

    if (!venue) {
        return (
            <div className="py-24 text-center bg-white/[0.02] rounded-3xl border border-dashed border-white/10">
                <Wine size={40} className="mx-auto mb-3 text-white/20" />
                <p className="text-white/50 text-sm">No G Spot venue linked to your account yet</p>
                <p className="text-white/30 text-xs mt-2">An admin assigns venue ownership once your bar membership deal is set up.</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-xl font-black text-white">{venue.name}</h2>
                    <p className="text-xs text-white/40 mt-1">{venue.address}</p>
                </div>
                <button onClick={load} className="h-10 px-4 rounded-xl bg-white/5 border border-white/10 text-white/50 text-xs font-bold flex items-center gap-2">
                    <RefreshCw size={14} /> Refresh
                </button>
            </div>

            <div className="grid grid-cols-3 gap-3">
                <div className="bg-white/5 rounded-xl p-4">
                    <p className="text-[9px] text-white/20 uppercase font-black mb-1">Membership</p>
                    <p className="text-white/70 font-bold text-sm">{fmtTTD(venue.membership_price_cents)}</p>
                </div>
                <div className="bg-white/5 rounded-xl p-4">
                    <p className="text-[9px] text-white/20 uppercase font-black mb-1">Drink Cap/Mo</p>
                    <p className="text-white/70 font-bold text-sm">{fmtTTD(venue.drink_subsidy_cap_cents)}</p>
                </div>
                <div className="bg-white/5 rounded-xl p-4">
                    <p className="text-[9px] text-white/20 uppercase font-black mb-1">Active Members</p>
                    <p className="text-white/70 font-bold text-sm">{venue.active_members}</p>
                </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
                <div className="flex items-center gap-2 text-white/50 text-xs font-black uppercase tracking-widest mb-4">
                    <QrCode size={14} /> Redeem a member's code
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <input value={redeemCode} onChange={(e) => setRedeemCode(e.target.value.toUpperCase())}
                        className="bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm font-mono uppercase"
                        placeholder="RIDER CODE" maxLength={6} />
                    <input value={redeemAmount} onChange={(e) => setRedeemAmount(e.target.value)}
                        type="number" step="0.01"
                        className="bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm"
                        placeholder="Discount amount (TTD)" />
                    <button onClick={redeem} disabled={redeeming}
                        className="h-12 rounded-xl bg-[#0D9488] text-black font-bold text-xs uppercase tracking-widest disabled:opacity-40 flex items-center justify-center gap-2">
                        {redeeming ? <Loader2 size={16} className="animate-spin" /> : null} Redeem
                    </button>
                </div>
                {redeemResult && <p className="text-xs text-white/50 mt-3">{redeemResult}</p>}
            </div>
        </div>
    );
};
