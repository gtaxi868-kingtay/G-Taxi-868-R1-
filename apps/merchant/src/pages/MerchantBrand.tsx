import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { Loader2, Sparkles } from 'lucide-react';

// The business's side of brand approval. G 868 makes the look and the package;
// the owner approves it, asks for a change, or sends in a new package, which
// G 868 reviews. Pausing is instant and only the owner can undo their pause.

type Campaign = {
    id: string; headline: string; offer_text: string | null; accent_color: string; audience: 'everyone' | 'my_clients';
    ends_on: string | null; status: string; authored_by_side: string; paused_by_side: string | null; change_note: string | null;
};

export const MerchantBrand = ({ merchantId }: { merchantId?: string }) => {
    const [rows, setRows] = useState<Campaign[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [form, setForm] = useState({ headline: '', offer_text: '', accent_color: '#8B5CF6', audience: 'everyone', ends_on: '' });
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        if (!merchantId) { setLoading(false); return; }
        setLoading(true);
        const { data, error: err } = await supabase.from('partner_campaigns')
            .select('id, headline, offer_text, accent_color, audience, ends_on, status, authored_by_side, paused_by_side, change_note')
            .eq('merchant_id', merchantId).neq('status', 'ended').order('created_at', { ascending: false });
        if (err) setError('Could not load your brand. Refresh to try again.');
        setRows((data as Campaign[]) || []);
        setLoading(false);
    }, [merchantId]);
    useEffect(() => { load(); }, [load]);

    const decide = async (id: string, decision: string, note?: string) => {
        setError(null);
        const { error: err } = await supabase.rpc('partner_campaign_decide', { p_id: id, p_decision: decision, p_note: note ?? null });
        if (err) { setError(err.message); return; }
        await load();
    };

    const submit = async () => {
        if (!merchantId || form.headline.trim().length < 3) { setError('Write a headline first.'); return; }
        setSaving(true); setError(null);
        const { error: err } = await supabase.rpc('partner_campaign_save', {
            p_merchant_id: merchantId, p_headline: form.headline, p_offer_text: form.offer_text || null,
            p_accent_color: form.accent_color, p_audience: form.audience, p_ends_on: form.ends_on || null,
        });
        setSaving(false);
        if (err) { setError(err.message); return; }
        setForm({ headline: '', offer_text: '', accent_color: '#8B5CF6', audience: 'everyone', ends_on: '' });
        await load();
    };

    const live = rows.find((r) => r.status === 'live');
    const toApprove = rows.filter((r) => r.status === 'awaiting_business');
    const others = rows.filter((r) => !['live', 'awaiting_business'].includes(r.status));
    const btn = 'h-10 px-4 rounded-xl text-xs font-black';

    const preview = (c: Campaign) => (
        <div className="rounded-xl p-4" style={{ background: `${c.accent_color}33`, borderLeft: `4px solid ${c.accent_color}` }}>
            <p className="text-white font-black">{c.headline}</p>
            {c.offer_text && <p className="text-sm text-white/70 mt-0.5">{c.offer_text}</p>}
            <p className="text-[11px] text-white/40 mt-1">{c.audience === 'my_clients' ? 'Shown to your clients' : 'Shown to everyone near your pin'}{c.ends_on ? ` until ${c.ends_on}` : ''}</p>
        </div>
    );

    if (loading) return <div className="py-24 text-center"><Loader2 className="animate-spin mx-auto text-white/30" size={28} /></div>;

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-xl font-black text-white">Your brand</h2>
                <p className="text-xs text-white/40 mt-1">We make it. You approve it. Nothing with your name goes out until you say so.</p>
            </div>
            {error && <p role="alert" className="text-sm text-red-400">{error}</p>}

            {toApprove.map((c) => (
                <div key={c.id} className="rounded-2xl border border-violet-400/40 bg-violet-500/10 p-5 space-y-3">
                    <p className="text-xs font-black text-violet-300 uppercase tracking-wider">Waiting for your approval</p>
                    {preview(c)}
                    <div className="flex flex-wrap gap-2">
                        <button className={`${btn} bg-violet-600 text-white`} onClick={() => decide(c.id, 'approve')}>Approve</button>
                        <button className={`${btn} bg-white/5 border border-white/10 text-white/70`} onClick={() => { const note = window.prompt('What should we change?'); if (note) decide(c.id, 'request_changes', note); }}>Ask for a change</button>
                    </div>
                </div>
            ))}

            <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 space-y-3">
                <p className="text-xs font-black text-white/50 uppercase tracking-wider">On your map pin now</p>
                {live ? (
                    <>
                        {preview(live)}
                        <button className={`${btn} bg-white/5 border border-white/10 text-white/70`} onClick={() => decide(live.id, 'pause')}>Pause</button>
                    </>
                ) : (
                    <div className="py-6 text-center"><Sparkles size={28} className="mx-auto mb-2 text-white/20" /><p className="text-sm text-white/50">Nothing live yet.</p></div>
                )}
            </div>

            {others.map((c) => (
                <div key={c.id} className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 space-y-2">
                    <p className="text-xs text-white/50">{c.status === 'paused' ? 'Paused' : c.status === 'awaiting_g868' ? 'With G 868 for review' : c.authored_by_side === 'business' ? 'G 868 asked for a change. Send a new package below.' : 'G 868 is making your changes'}</p>
                    {preview(c)}
                    {c.change_note && <p className="text-xs text-amber-300">Note: {c.change_note}</p>}
                    {c.status === 'paused' && c.paused_by_side === 'business' && <button className={`${btn} bg-white/5 border border-white/10 text-white/70`} onClick={() => decide(c.id, 'resume')}>Put it back on my pin</button>}
                </div>
            ))}

            <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 space-y-3">
                <p className="text-xs font-black text-white/50 uppercase tracking-wider">Send us a new package</p>
                <input aria-label="Headline" maxLength={60} placeholder="Headline" value={form.headline} onChange={(e) => setForm({ ...form, headline: e.target.value })} className="w-full h-11 px-4 rounded-xl bg-white/5 border border-white/10 text-white text-sm" />
                <textarea aria-label="Package" rows={2} maxLength={140} placeholder="The deal your clients should see" value={form.offer_text} onChange={(e) => setForm({ ...form, offer_text: e.target.value })} className="w-full p-4 rounded-xl bg-white/5 border border-white/10 text-white text-sm" />
                <div className="grid grid-cols-3 gap-3">
                    <label className="text-xs text-white/50">Colour<input aria-label="Colour" type="color" value={form.accent_color} onChange={(e) => setForm({ ...form, accent_color: e.target.value.toUpperCase() })} className="block mt-1 h-10 w-full rounded-lg bg-transparent" /></label>
                    <label className="text-xs text-white/50">Who sees it
                        <select aria-label="Who sees it" value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })} className="mt-1 w-full h-10 px-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm">
                            <option value="everyone">Everyone nearby</option>
                            <option value="my_clients">Only my clients</option>
                        </select>
                    </label>
                    <label className="text-xs text-white/50">Ends (optional)<input aria-label="End date" type="date" value={form.ends_on} onChange={(e) => setForm({ ...form, ends_on: e.target.value })} className="mt-1 w-full h-10 px-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm" /></label>
                </div>
                <button disabled={saving} onClick={submit} className={`${btn} bg-violet-600 text-white`}>{saving ? 'Sending…' : 'Send to G 868'}</button>
            </div>
        </div>
    );
};
