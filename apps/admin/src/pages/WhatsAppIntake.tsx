import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { RefreshCw, Loader2, MessageCircle, Plus } from 'lucide-react';

// WhatsApp intake (Connection Map item 3), manual by necessity: nothing can
// read inbound WhatsApp messages today (no inbound webhook; the WhatsApp
// Business token is invalid). Paste each message here: the partner ref is
// recognised, matched to its business record, and tracked to "linked".

export type PartnerRef = { slug: string; label: string | null; merchant_id: string | null; lodging_id: string | null; merchants?: { name: string } | null };
export type Intake = {
    id: string; ref_slug: string | null; kind: 'connect' | 'driver_start' | 'other';
    status: 'new' | 'contacted' | 'linked' | 'driver_started' | 'closed';
    contact_name: string | null; contact_phone: string | null; message: string | null; notes: string | null; created_at: string;
};

// Finds the partner ref and what the person wants from a pasted message.
// Accepts "ref=kapok", "ref: kapok", "#kapok", a link ending in ?ref=kapok,
// or the slug as a whole word.
export function parseIntake(text: string, slugs: string[]): { ref_slug: string | null; kind: Intake['kind']; phone: string | null } {
    const t = (text || '').toLowerCase();
    let ref: string | null = null;
    const tagged = /(?:ref\s*[:=]\s*|[?&]ref=|#)([a-z0-9-]{2,40})/.exec(t);
    if (tagged && slugs.includes(tagged[1])) ref = tagged[1];
    if (!ref) ref = slugs.find((s) => new RegExp(`(^|[^a-z0-9])${s}([^a-z0-9]|$)`).test(t)) ?? null;
    const kind: Intake['kind'] = /\bdriv(e|er|ing)\b|start driving|become a driver/.test(t) ? 'driver_start'
        : /connect|partner|sign ?up|join|g-?touch|tap|interested/.test(t) ? 'connect' : 'other';
    const phoneMatch = /(\+?1?[\s-]?\(?868\)?[\s-]?\d{3}[\s-]?\d{4})/.exec(text || '');
    return { ref_slug: ref, kind, phone: phoneMatch ? phoneMatch[1].replace(/[^\d+]/g, '') : null };
}

const STATUS_LABEL: Record<Intake['status'], string> = {
    new: 'New', contacted: 'Contacted', linked: 'Linked to business', driver_started: 'Driver started', closed: 'Closed',
};
const KIND_LABEL: Record<Intake['kind'], string> = { connect: 'Wants to connect', driver_start: 'Driver wants to start', other: 'Other' };

export function WhatsAppIntake() {
    const [refs, setRefs] = useState<PartnerRef[]>([]);
    const [rows, setRows] = useState<Intake[]>([]);
    const [merchants, setMerchants] = useState<{ id: string; name: string }[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [paste, setPaste] = useState({ message: '', name: '', phone: '' });
    const [msg, setMsg] = useState<string | null>(null);
    const [filter, setFilter] = useState<'open' | 'all'>('open');

    const load = useCallback(async () => {
        setLoading(true); setError(null);
        const [r, i, m] = await Promise.all([
            supabase.from('partner_refs').select('slug, label, merchant_id, lodging_id, merchants(name)').order('slug'),
            supabase.from('business_intake').select('*').order('created_at', { ascending: false }).limit(200),
            supabase.from('merchants').select('id, name').order('name'),
        ]);
        if (r.error || i.error) setError('Could not load the intake list. Refresh to try again.');
        setRefs((r.data as unknown as PartnerRef[]) || []);
        setRows((i.data as Intake[]) || []);
        setMerchants((m.data as { id: string; name: string }[]) || []);
        setLoading(false);
    }, []);
    useEffect(() => { load(); }, [load]);

    const parsed = parseIntake(paste.message, refs.map((r) => r.slug));

    const add = async () => {
        if (!paste.message.trim() && !paste.phone.trim()) { setMsg('Paste the message, or at least the phone number.'); return; }
        const { data: { user } } = await supabase.auth.getUser();
        const { error: err } = await supabase.from('business_intake').insert({
            ref_slug: parsed.ref_slug, kind: parsed.kind, message: paste.message.trim() || null,
            contact_name: paste.name.trim() || null, contact_phone: paste.phone.trim() || parsed.phone, created_by: user?.id ?? null,
        });
        setMsg(err ? err.message : `Logged${parsed.ref_slug ? ` for ${parsed.ref_slug}` : ' (no partner ref found: pick one below)'}.`);
        if (!err) { setPaste({ message: '', name: '', phone: '' }); load(); }
    };
    const update = async (id: string, patch: Partial<Intake>) => {
        const { error: err } = await supabase.from('business_intake').update(patch).eq('id', id);
        if (err) setMsg(err.message); else load();
    };
    const linkRef = async (slug: string, merchantId: string) => {
        const { error: err } = await supabase.from('partner_refs').update({ merchant_id: merchantId || null }).eq('slug', slug);
        if (err) setMsg(err.message); else load();
    };

    const shown = rows.filter((r) => filter === 'all' || !['linked', 'closed'].includes(r.status));
    const refBySlug = Object.fromEntries(refs.map((r) => [r.slug, r]));

    return (
        <div className="space-y-8">
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-xl font-black text-white">WhatsApp intake</h2>
                    <p className="text-xs text-white/40 mt-1">Messages can't be read automatically yet (no inbound WhatsApp connection). Paste each one here; the partner ref is picked out for you.</p>
                </div>
                <button onClick={load} className="h-10 px-4 rounded-xl bg-white/5 border border-white/10 text-white/50 text-xs font-bold flex items-center gap-2"><RefreshCw size={14} /> Refresh</button>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 space-y-3">
                <textarea aria-label="Pasted WhatsApp message" rows={3} placeholder="Paste the WhatsApp message here" value={paste.message}
                    onChange={(e) => setPaste({ ...paste, message: e.target.value })} className="admin-input w-full" />
                <div className="grid grid-cols-2 gap-3">
                    <input aria-label="Contact name" placeholder="Their name (optional)" value={paste.name} onChange={(e) => setPaste({ ...paste, name: e.target.value })} className="admin-input" />
                    <input aria-label="Contact phone" placeholder={parsed.phone ? `Phone (found ${parsed.phone})` : 'Their WhatsApp number'} value={paste.phone} onChange={(e) => setPaste({ ...paste, phone: e.target.value })} className="admin-input" />
                </div>
                {paste.message && (
                    <p className="text-xs text-white/60">Partner: <span className="text-white">{parsed.ref_slug ?? 'not found'}</span> · {KIND_LABEL[parsed.kind]}
                        {parsed.ref_slug && refBySlug[parsed.ref_slug]?.merchants?.name ? ` · business: ${refBySlug[parsed.ref_slug].merchants!.name}` : parsed.ref_slug ? ' · no business record linked yet' : ''}</p>
                )}
                <button onClick={add} className="text-[10px] font-black text-cyan-400 uppercase flex items-center gap-1"><Plus size={12} /> Log message</button>
                {msg && <p className="text-xs text-white/70">{msg}</p>}
            </div>

            {loading ? <div className="py-12 text-center"><Loader2 className="animate-spin mx-auto text-white/30" size={24} /></div>
            : error ? <p className="text-sm text-red-400">{error}</p> : (
                <>
                    <div>
                        <div className="flex items-center gap-4 mb-2">
                            <h3 className="text-sm font-black text-white flex items-center gap-2"><MessageCircle size={16} /> Messages</h3>
                            <button onClick={() => setFilter(filter === 'open' ? 'all' : 'open')} className="text-[10px] font-black text-white/40 uppercase">{filter === 'open' ? 'Show all' : 'Show open only'}</button>
                        </div>
                        {shown.length === 0 ? <p className="text-xs text-white/40">Nothing waiting.</p> : (
                            <ul className="divide-y divide-white/5">
                                {shown.map((r) => {
                                    const biz = r.ref_slug ? refBySlug[r.ref_slug]?.merchants?.name : null;
                                    return (
                                        <li key={r.id} className="py-3 text-xs text-white/70 space-y-2">
                                            <div className="flex justify-between gap-4">
                                                <span><span className="text-white">{r.ref_slug ?? 'no ref'}</span>{biz ? ` → ${biz}` : r.ref_slug ? ' → no business record yet' : ''} · {KIND_LABEL[r.kind]} · {r.contact_name ?? ''} {r.contact_phone ?? ''}</span>
                                                <span className="text-white/30 shrink-0">{new Date(r.created_at).toLocaleString('en-TT', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>
                                            </div>
                                            {r.message && <p className="text-white/50 italic">“{r.message}”</p>}
                                            <div className="flex flex-wrap gap-3 items-center">
                                                <select aria-label="Status" value={r.status} onChange={(e) => update(r.id, { status: e.target.value as Intake['status'] })} className="admin-input">
                                                    {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                                                </select>
                                                {!r.ref_slug && (
                                                    <select aria-label="Partner ref" value="" onChange={(e) => update(r.id, { ref_slug: e.target.value || null })} className="admin-input">
                                                        <option value="">Pick partner…</option>
                                                        {refs.map((p) => <option key={p.slug} value={p.slug}>{p.slug}</option>)}
                                                    </select>
                                                )}
                                            </div>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </div>

                    <div>
                        <h3 className="text-sm font-black text-white mb-2">Partner refs → business records</h3>
                        <ul className="divide-y divide-white/5">
                            {refs.map((p) => (
                                <li key={p.slug} className="py-2 flex items-center justify-between gap-4 text-xs text-white/70">
                                    <span className="text-white">{p.slug}{p.label ? ` · ${p.label}` : ''}</span>
                                    <select aria-label={`Business for ${p.slug}`} value={p.merchant_id ?? ''} onChange={(e) => linkRef(p.slug, e.target.value)} className="admin-input max-w-xs">
                                        <option value="">Not linked yet</option>
                                        {merchants.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                                    </select>
                                </li>
                            ))}
                        </ul>
                    </div>
                </>
            )}
        </div>
    );
}
