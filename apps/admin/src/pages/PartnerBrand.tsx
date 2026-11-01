import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { RefreshCw, Loader2, Sparkles } from 'lucide-react';

// G 868's side of partner brand approval. You draft a business's look and
// package here, or review a change the business sent in. Nothing reaches a
// rider's map until the side that did not write it has approved it, which the
// database enforces (partner_campaign_decide). "Record owner's OK" is for
// owners with no account who said yes on WhatsApp or in person.

export type Campaign = {
    id: string; merchant_id: string; headline: string; offer_text: string | null; image_url: string | null;
    accent_color: string; audience: 'everyone' | 'my_clients'; starts_on: string; ends_on: string | null;
    status: 'awaiting_business' | 'awaiting_g868' | 'changes_requested' | 'live' | 'paused' | 'ended';
    authored_by_side: 'g868' | 'business'; paused_by_side: 'g868' | 'business' | null; change_note: string | null;
    created_at: string; merchants?: { name: string } | null;
};

export const STATUS_LABEL: Record<Campaign['status'], string> = {
    awaiting_business: 'Waiting for the business', awaiting_g868: 'Needs your review',
    changes_requested: 'Changes requested', live: 'Live on the pin', paused: 'Paused', ended: 'Ended',
};

const emptyForm = { merchant_id: '', headline: '', offer_text: '', image_url: '', accent_color: '#8B5CF6', audience: 'everyone', ends_on: '' };

export function needsG868(c: Campaign) {
    return c.status === 'awaiting_g868' || (c.status === 'changes_requested' && c.authored_by_side === 'g868');
}

export function PartnerBrand() {
    const [rows, setRows] = useState<Campaign[]>([]);
    const [merchants, setMerchants] = useState<{ id: string; name: string }[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [form, setForm] = useState(emptyForm);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        setLoading(true); setError(null);
        const [c, m] = await Promise.all([
            supabase.from('partner_campaigns').select('*, merchants(name)').order('created_at', { ascending: false }).limit(200),
            supabase.from('merchants').select('id, name').order('name'),
        ]);
        if (c.error) setError('Could not load campaigns. Refresh to try again.');
        setRows((c.data as unknown as Campaign[]) || []);
        setMerchants((m.data as { id: string; name: string }[]) || []);
        setLoading(false);
    }, []);
    useEffect(() => { load(); }, [load]);

    const save = async () => {
        if (!form.merchant_id || form.headline.trim().length < 3) { setError('Pick a business and write a headline.'); return; }
        setSaving(true); setError(null);
        const { error: err } = await supabase.rpc('partner_campaign_save', {
            p_merchant_id: form.merchant_id, p_headline: form.headline, p_offer_text: form.offer_text || null,
            p_image_url: form.image_url || null, p_accent_color: form.accent_color, p_audience: form.audience,
            p_ends_on: form.ends_on || null, p_campaign_id: editingId,
        });
        setSaving(false);
        if (err) { setError(err.message); return; }
        setForm(emptyForm); setEditingId(null);
        await load();
    };

    const decide = async (id: string, decision: string, note?: string) => {
        const { error: err } = await supabase.rpc('partner_campaign_decide', { p_id: id, p_decision: decision, p_note: note ?? null });
        if (err) { setError(err.message); return; }
        await load();
    };

    const ask = (id: string, decision: string, prompt: string) => {
        const note = window.prompt(prompt);
        if (note) decide(id, decision, note);
    };

    const edit = (c: Campaign) => {
        setEditingId(c.id);
        setForm({ merchant_id: c.merchant_id, headline: c.headline, offer_text: c.offer_text ?? '', image_url: c.image_url ?? '',
            accent_color: c.accent_color, audience: c.audience, ends_on: c.ends_on ?? '' });
    };

    const btn = 'h-9 px-3 rounded-lg bg-white/5 border border-white/10 text-white/70 text-xs font-bold';

    return (
        <div className="space-y-8">
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-xl font-black text-white">Partner brand</h2>
                    <p className="text-xs text-white/40 mt-1">Make a business's look and package. It shows on their map pin once they approve it.</p>
                </div>
                <button onClick={load} className="h-10 px-4 rounded-xl bg-white/5 border border-white/10 text-white/50 text-xs font-bold flex items-center gap-2"><RefreshCw size={14} /> Refresh</button>
            </div>

            {error && <p role="alert" className="text-sm text-red-400">{error}</p>}

            <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 space-y-3">
                <select aria-label="Business" value={form.merchant_id} disabled={!!editingId} onChange={(e) => setForm({ ...form, merchant_id: e.target.value })} className="admin-input w-full">
                    <option value="">Choose a business</option>
                    {merchants.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
                <input aria-label="Headline" maxLength={60} placeholder="Headline, e.g. Your full shop. Your ride home." value={form.headline} onChange={(e) => setForm({ ...form, headline: e.target.value })} className="admin-input w-full" />
                <textarea aria-label="Package" rows={2} maxLength={140} placeholder="The package riders see (optional)" value={form.offer_text} onChange={(e) => setForm({ ...form, offer_text: e.target.value })} className="admin-input w-full" />
                <input aria-label="Image link" placeholder="Image link, https only (optional)" value={form.image_url} onChange={(e) => setForm({ ...form, image_url: e.target.value })} className="admin-input w-full" />
                <div className="grid grid-cols-3 gap-3">
                    <label className="text-xs text-white/50">Colour<input aria-label="Brand colour" type="color" value={form.accent_color} onChange={(e) => setForm({ ...form, accent_color: e.target.value.toUpperCase() })} className="block mt-1 h-10 w-full rounded-lg bg-transparent" /></label>
                    <label className="text-xs text-white/50">Who sees it
                        <select aria-label="Who sees it" value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })} className="admin-input w-full mt-1">
                            <option value="everyone">Everyone near the pin</option>
                            <option value="my_clients">Only their clients</option>
                        </select>
                    </label>
                    <label className="text-xs text-white/50">Ends (optional)<input aria-label="End date" type="date" value={form.ends_on} onChange={(e) => setForm({ ...form, ends_on: e.target.value })} className="admin-input w-full mt-1" /></label>
                </div>
                <div className="rounded-xl p-4 text-white" style={{ background: `${form.accent_color}33`, borderLeft: `4px solid ${form.accent_color}` }}>
                    <p className="text-[10px] uppercase tracking-wider text-white/50">What the rider sees</p>
                    <p className="font-black">{form.headline || 'Your headline'}</p>
                    {form.offer_text && <p className="text-sm text-white/70">{form.offer_text}</p>}
                </div>
                <button onClick={save} disabled={saving} className="h-10 px-4 rounded-xl bg-violet-600 text-white text-xs font-black">{saving ? 'Saving…' : editingId ? 'Save and send for approval' : 'Send to the business for approval'}</button>
            </div>

            {loading ? (
                <div className="py-16 text-center"><Loader2 className="animate-spin mx-auto text-white/30" size={28} /></div>
            ) : rows.length === 0 ? (
                <div className="py-16 text-center rounded-3xl border border-dashed border-white/10">
                    <Sparkles size={36} className="mx-auto mb-3 text-white/20" />
                    <p className="text-white/50 text-sm">Nothing yet. Draft the first look above.</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {[...rows].sort((a, b) => Number(needsG868(b)) - Number(needsG868(a))).map((c) => (
                        <div key={c.id} className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
                            <div className="flex justify-between gap-3">
                                <div className="min-w-0">
                                    <p className="text-[11px] text-white/40">{c.merchants?.name ?? 'Business'} · {c.audience === 'my_clients' ? 'Their clients' : 'Everyone'}{c.ends_on ? ` · until ${c.ends_on}` : ''}</p>
                                    <h3 className="text-white font-bold">{c.headline}</h3>
                                    {c.offer_text && <p className="text-sm text-white/60">{c.offer_text}</p>}
                                    {c.change_note && <p className="text-xs text-amber-300 mt-1">Note: {c.change_note}</p>}
                                </div>
                                <span className="shrink-0 h-fit px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-white/5 text-white/60">{STATUS_LABEL[c.status]}</span>
                            </div>
                            <div className="flex flex-wrap gap-2 mt-3">
                                {c.status === 'awaiting_g868' && <button className={btn} onClick={() => decide(c.id, 'approve')}>Approve</button>}
                                {c.status === 'awaiting_g868' && <button className={btn} onClick={() => ask(c.id, 'request_changes', 'What needs to change?')}>Send back</button>}
                                {c.status === 'awaiting_business' && <button className={btn} onClick={() => ask(c.id, 'approve_on_behalf', 'Who approved it, and how? e.g. Owner said yes on WhatsApp, 1 Nov')}>Record owner's OK</button>}
                                {['awaiting_business', 'awaiting_g868', 'changes_requested'].includes(c.status) && <button className={btn} onClick={() => edit(c)}>Edit</button>}
                                {c.status === 'live' && <button className={btn} onClick={() => decide(c.id, 'pause')}>Pause</button>}
                                {c.status === 'paused' && c.paused_by_side === 'g868' && <button className={btn} onClick={() => decide(c.id, 'resume')}>Resume</button>}
                                {c.status !== 'ended' && <button className={btn} onClick={() => { if (window.confirm('End this version?')) decide(c.id, 'end'); }}>End</button>}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
