import { useState, useEffect, useCallback } from 'react';
import { adminFetch } from '../lib/supabase';
import { MapPin, Loader2, Plus, X, RefreshCw, Wine } from 'lucide-react';

interface Venue {
  id: string;
  name: string;
  address: string;
  monthly_rent_cents: number;
  membership_price_cents: number | null;
  drink_subsidy_cap_cents: number;
  status: 'candidate' | 'active' | 'closed';
  zone_analysis_notes: string | null;
  created_at: string;
}

function fmtTTD(cents: number | null) {
  if (cents == null) return '—';
  return `TTD $${(cents / 100).toLocaleString('en-TT', { minimumFractionDigits: 2 })}`;
}

const STATUS_BADGE: Record<string, string> = {
  candidate: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  active: 'bg-green-500/10 text-green-400 border-green-500/20',
  closed: 'bg-white/5 text-white/30 border-white/10',
};

const emptyForm = {
  id: undefined as string | undefined,
  name: '',
  address: '',
  monthly_rent_cents: 3500000, // $35,000 TTD — the real anchor figure from the plan; editable, not fixed
  membership_price_cents: 33500, // $335 TTD/mo — the plan's computed launch price; editable
  drink_subsidy_cap_cents: 8400, // $84/mo cap — the plan's computed drink-subsidy ceiling; editable
  status: 'candidate' as Venue['status'],
  zone_analysis_notes: '',
};

export function GSpotVenues() {
  const [venues, setVenues] = useState<Venue[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch('admin', { action: 'get_g_spot_venues' });
      if (res?.success) setVenues(res.venues || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openEdit = (v?: Venue) => {
    setForm(v ? {
      id: v.id, name: v.name, address: v.address,
      monthly_rent_cents: v.monthly_rent_cents,
      membership_price_cents: v.membership_price_cents ?? 0,
      drink_subsidy_cap_cents: v.drink_subsidy_cap_cents,
      status: v.status, zone_analysis_notes: v.zone_analysis_notes ?? '',
    } : emptyForm);
    setShowForm(true);
  };

  const save = async () => {
    if (!form.name.trim() || !form.address.trim()) {
      alert('Name and address are required');
      return;
    }
    setSaving(true);
    try {
      const res = await adminFetch('admin', {
        action: 'upsert_g_spot_venue',
        venue: {
          id: form.id,
          name: form.name.trim(),
          address: form.address.trim(),
          monthly_rent_cents: form.monthly_rent_cents,
          membership_price_cents: form.membership_price_cents || null,
          drink_subsidy_cap_cents: form.drink_subsidy_cap_cents,
          status: form.status,
          zone_analysis_notes: form.zone_analysis_notes.trim() || null,
        },
      });
      if (!res?.success) throw new Error(res?.error || 'Save failed');
      setShowForm(false);
      await load();
    } catch (err: any) {
      alert(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl sm:text-3xl font-black text-white italic tracking-tight">G SPOT VENUES</h2>
          <p className="text-xs font-medium text-white/20 uppercase tracking-[0.4em] mt-1">Bar Membership // Candidate & Active Locations</p>
        </div>
        <div className="flex gap-3">
          <button onClick={load} className="btn-press h-12 px-6 rounded-xl bg-white/5 border border-white/10 text-white/50 font-black text-xs uppercase tracking-widest hover:bg-white/10 transition-all flex items-center gap-3">
            <RefreshCw size={16} /> Refresh
          </button>
          <button onClick={() => openEdit()} className="btn-press h-12 px-6 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 font-black text-xs uppercase tracking-widest hover:bg-cyan-500/20 transition-all flex items-center gap-3">
            <Plus size={16} /> New Venue
          </button>
        </div>
      </div>

      {loading ? (
        <div className="py-32 text-center"><Loader2 className="animate-spin mx-auto text-white/30" size={32} /></div>
      ) : venues.length === 0 ? (
        <div className="py-32 text-center bg-white/[0.02] rounded-[2rem] border border-dashed border-white/5">
          <Wine size={48} className="mx-auto mb-4 text-white/20" />
          <p className="text-white/60 font-black text-xs">No venues yet</p>
          <p className="text-white/40 text-sm mt-2">Add a candidate location — G's fleet department can be asked to compare zones before you commit rent.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {venues.map((v) => (
            <div key={v.id} onClick={() => openEdit(v)} className="rounded-[1.5rem] border border-white/10 bg-white/[0.02] p-6 cursor-pointer hover:bg-white/[0.04] transition-all">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="text-white font-black text-sm">{v.name}</h3>
                  <p className="text-[11px] text-white/40 mt-0.5 flex items-center gap-1"><MapPin size={11} />{v.address}</p>
                </div>
                <span className={`px-3 py-1 rounded-full border text-[10px] font-black uppercase tracking-wider ${STATUS_BADGE[v.status]}`}>{v.status}</span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="bg-white/5 rounded-lg p-2.5">
                  <p className="text-[9px] text-white/20 uppercase font-black mb-1">Rent/mo</p>
                  <p className="text-white/70 font-bold">{fmtTTD(v.monthly_rent_cents)}</p>
                </div>
                <div className="bg-white/5 rounded-lg p-2.5">
                  <p className="text-[9px] text-white/20 uppercase font-black mb-1">Membership</p>
                  <p className="text-white/70 font-bold">{fmtTTD(v.membership_price_cents)}</p>
                </div>
                <div className="bg-white/5 rounded-lg p-2.5">
                  <p className="text-[9px] text-white/20 uppercase font-black mb-1">Drink cap</p>
                  <p className="text-white/70 font-bold">{fmtTTD(v.drink_subsidy_cap_cents)}</p>
                </div>
              </div>
              {v.zone_analysis_notes && (
                <p className="text-[11px] text-white/40 mt-3 italic">"{v.zone_analysis_notes}"</p>
              )}
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setShowForm(false)}>
          <div className="dropdown-pop bg-[#0B0E12] border border-white/10 rounded-[1.5rem] p-8 w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-white font-black text-lg">{form.id ? 'Edit Venue' : 'New Venue'}</h3>
              <button onClick={() => setShowForm(false)} className="btn-press text-white/40 hover:text-white"><X size={20} /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-[10px] font-black text-white/30 uppercase tracking-widest">Name</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full mt-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm" placeholder="e.g. G Spot Tragarete" />
              </div>
              <div>
                <label className="text-[10px] font-black text-white/30 uppercase tracking-widest">Address</label>
                <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })}
                  className="w-full mt-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm" placeholder="Tragarete Road, Port of Spain" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-black text-white/30 uppercase tracking-widest">Monthly rent (cents)</label>
                  <input type="number" value={form.monthly_rent_cents} onChange={(e) => setForm({ ...form, monthly_rent_cents: Number(e.target.value) })}
                    className="w-full mt-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm" />
                </div>
                <div>
                  <label className="text-[10px] font-black text-white/30 uppercase tracking-widest">Membership price (cents)</label>
                  <input type="number" value={form.membership_price_cents} onChange={(e) => setForm({ ...form, membership_price_cents: Number(e.target.value) })}
                    className="w-full mt-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm" />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-black text-white/30 uppercase tracking-widest">Drink subsidy cap /mo (cents)</label>
                <input type="number" value={form.drink_subsidy_cap_cents} onChange={(e) => setForm({ ...form, drink_subsidy_cap_cents: Number(e.target.value) })}
                  className="w-full mt-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm" />
              </div>
              <div>
                <label className="text-[10px] font-black text-white/30 uppercase tracking-widest">Status</label>
                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Venue['status'] })}
                  className="w-full mt-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm">
                  <option value="candidate">Candidate</option>
                  <option value="active">Active</option>
                  <option value="closed">Closed</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] font-black text-white/30 uppercase tracking-widest">Zone analysis notes (from G, or your own research)</label>
                <textarea value={form.zone_analysis_notes} onChange={(e) => setForm({ ...form, zone_analysis_notes: e.target.value })}
                  rows={3} className="w-full mt-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm"
                  placeholder="e.g. ride-density comparison across candidate zones before committing rent" />
              </div>
            </div>
            <button onClick={save} disabled={saving}
              className="btn-press w-full mt-6 h-12 rounded-xl bg-cyan-500 text-black font-black text-xs uppercase tracking-widest hover:bg-cyan-400 transition-all disabled:opacity-40 flex items-center justify-center gap-2">
              {saving ? <Loader2 size={16} className="animate-spin" /> : null} Save Venue
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
