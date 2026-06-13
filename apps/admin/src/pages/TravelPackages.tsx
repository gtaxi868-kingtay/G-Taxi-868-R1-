import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { Plane, Plus, Edit2, Trash2, Eye, EyeOff, Users, TrendingUp, DollarSign, RefreshCw, X } from 'lucide-react';

function fmtTTD(cents: number) {
    return `TTD $${(cents / 100).toLocaleString('en-TT', { minimumFractionDigits: 0 })}`;
}
function fmtDate(iso: string) {
    return new Date(iso).toLocaleDateString('en-TT', { day: 'numeric', month: 'short', year: 'numeric' });
}

const STATUSES = ['draft', 'active', 'sold_out', 'expired', 'cancelled'] as const;
const DEST_OPTS = [
    { code: 'TAB', label: 'Tobago' },
    { code: 'BGI', label: 'Barbados' },
    { code: 'GND', label: 'Grenada' },
    { code: 'ANU', label: 'Antigua' },
    { code: 'SKB', label: 'St Kitts' },
    { code: 'SLU', label: 'St Lucia' },
    { code: 'SXM', label: 'St Maarten' },
    { code: 'HAV', label: 'Havana' },
];

const EMPTY_FORM = {
    id: '',
    title: '',
    destination_code: 'BGI',
    destination_name: 'Barbados',
    origin_code: 'POS',
    cover_image_url: '',
    price_per_person_cents: 367200,
    wholesale_cost_cents: 282800,
    max_travelers: 20,
    includes_airport_transfer: true,
    status: 'draft' as typeof STATUSES[number],
    departure_at: '',
    expires_at: '',
    flight_number: '',
    airline: '',
    cabin: 'Economy',
    hotel_name: '',
    hotel_nights: 2,
    hotel_room_type: '',
};

export function TravelPackages() {
    const [packages, setPackages] = useState<any[]>([]);
    const [bookings, setBookings] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState({ ...EMPTY_FORM });
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        const [pkgRes, bkgRes] = await Promise.all([
            supabase.from('travel_packages').select('*').order('created_at', { ascending: false }),
            supabase.from('travel_bookings').select('id, total_cents, platform_margin_cents, status, package_id, created_at'),
        ]);
        setPackages(pkgRes.data || []);
        setBookings(bkgRes.data || []);
        setLoading(false);
    }, []);

    useEffect(() => { load(); }, [load]);

    const totalRevenue = bookings.filter(b => b.status === 'confirmed').reduce((s, b) => s + b.total_cents, 0);
    const totalMargin = bookings.filter(b => b.status === 'confirmed').reduce((s, b) => s + b.platform_margin_cents, 0);

    const openNew = () => {
        setForm({ ...EMPTY_FORM });
        setError(null);
        setShowForm(true);
    };

    const openEdit = (pkg: any) => {
        setForm({
            id: pkg.id,
            title: pkg.title,
            destination_code: pkg.destination_code,
            destination_name: pkg.destination_name,
            origin_code: pkg.origin_code || 'POS',
            cover_image_url: pkg.cover_image_url || '',
            price_per_person_cents: pkg.price_per_person_cents,
            wholesale_cost_cents: pkg.wholesale_cost_cents,
            max_travelers: pkg.max_travelers,
            includes_airport_transfer: pkg.includes_airport_transfer,
            status: pkg.status,
            departure_at: pkg.departure_at ? pkg.departure_at.slice(0, 16) : '',
            expires_at: pkg.expires_at ? pkg.expires_at.slice(0, 16) : '',
            flight_number: pkg.flight_info?.flight_number || '',
            airline: pkg.flight_info?.airline || '',
            cabin: pkg.flight_info?.cabin || 'Economy',
            hotel_name: pkg.hotel_info?.name || '',
            hotel_nights: pkg.hotel_info?.nights || 2,
            hotel_room_type: pkg.hotel_info?.room_type || '',
        });
        setError(null);
        setShowForm(true);
    };

    const handleSave = async () => {
        if (!form.title || !form.departure_at) {
            setError('Title and departure date are required.');
            return;
        }
        setSaving(true);
        setError(null);

        const destLabel = DEST_OPTS.find(d => d.code === form.destination_code)?.label || form.destination_code;

        const body: any = {
            action: 'upsert',
            title: form.title,
            destination_code: form.destination_code,
            destination_name: destLabel,
            origin_code: form.origin_code,
            cover_image_url: form.cover_image_url || null,
            price_per_person_cents: Number(form.price_per_person_cents),
            wholesale_cost_cents: Number(form.wholesale_cost_cents),
            max_travelers: Number(form.max_travelers),
            includes_airport_transfer: form.includes_airport_transfer,
            status: form.status,
            departure_at: new Date(form.departure_at).toISOString(),
            expires_at: form.expires_at ? new Date(form.expires_at).toISOString() : null,
            flight_info: {
                ...(form.flight_number && { flight_number: form.flight_number }),
                ...(form.airline && { airline: form.airline }),
                cabin: form.cabin,
            },
            hotel_info: {
                ...(form.hotel_name && { name: form.hotel_name }),
                nights: Number(form.hotel_nights),
                ...(form.hotel_room_type && { room_type: form.hotel_room_type }),
            },
        };
        if (form.id) body.id = form.id;

        const { data, error: fnError } = await supabase.functions.invoke('admin_upsert_travel_package', { body });
        if (fnError || data?.error) {
            setError(fnError?.message || data?.error || 'Save failed');
        } else {
            setShowForm(false);
            await load();
        }
        setSaving(false);
    };

    const handleDelete = async (id: string, title: string) => {
        if (!confirm(`Delete package "${title}"? This cannot be undone.`)) return;
        await supabase.functions.invoke('admin_upsert_travel_package', { body: { action: 'delete', id } });
        await load();
    };

    const toggleStatus = async (pkg: any) => {
        const nextStatus = pkg.status === 'active' ? 'draft' : 'active';
        await supabase.functions.invoke('admin_upsert_travel_package', {
            body: { action: 'upsert', id: pkg.id, status: nextStatus },
        });
        await load();
    };

    const marginPct = (pkg: any) =>
        pkg.price_per_person_cents > 0
            ? Math.round(((pkg.price_per_person_cents - pkg.wholesale_cost_cents) / pkg.price_per_person_cents) * 1000) / 10
            : 0;

    const pkgBookings = (id: string) => bookings.filter(b => b.package_id === id && b.status === 'confirmed');

    return (
        <div className="space-y-8">
            {/* KPI strip */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <KpiCard icon={<Plane size={18} />} label="Active Packages" value={packages.filter(p => p.status === 'active').length} color="blue" />
                <KpiCard icon={<Users size={18} />} label="Total Bookings" value={bookings.filter(b => b.status === 'confirmed').length} color="green" />
                <KpiCard icon={<DollarSign size={18} />} label="Gross Revenue" value={fmtTTD(totalRevenue)} color="yellow" />
                <KpiCard icon={<TrendingUp size={18} />} label="Platform Margin" value={fmtTTD(totalMargin)} color="purple" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between">
                <h2 className="text-xl font-black text-white uppercase tracking-widest">Travel Packages</h2>
                <div className="flex gap-3">
                    <button onClick={load} className="p-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-white/40 hover:text-white transition-all">
                        <RefreshCw size={16} />
                    </button>
                    <button
                        onClick={openNew}
                        className="flex items-center gap-2 px-5 py-2.5 bg-blue-500 hover:bg-blue-400 text-white font-black text-xs uppercase tracking-widest rounded-xl transition-all"
                    >
                        <Plus size={16} /> New Package
                    </button>
                </div>
            </div>

            {/* Packages table */}
            {loading ? (
                <div className="text-white/40 text-sm font-mono animate-pulse">Loading packages…</div>
            ) : packages.length === 0 ? (
                <div className="text-center py-16 text-white/20">
                    <Plane size={40} className="mx-auto mb-4 opacity-40" />
                    <p className="font-bold text-lg">No packages yet</p>
                    <p className="text-sm mt-1">Create your first Caribbean escape to start selling.</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {packages.map(pkg => {
                        const bkgs = pkgBookings(pkg.id);
                        const pkgMargin = marginPct(pkg);
                        const totalPkgMargin = bkgs.reduce((s: number, b: any) => s + b.platform_margin_cents, 0);
                        return (
                            <div key={pkg.id} className="bg-white/5 border border-white/8 rounded-2xl p-5 flex flex-col lg:flex-row lg:items-center gap-4">
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-3 flex-wrap">
                                        <span className="text-white font-bold text-base">{pkg.title}</span>
                                        <StatusBadge status={pkg.status} />
                                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${pkgMargin >= 20 ? 'bg-green-500/20 text-green-400' : pkgMargin >= 10 ? 'bg-yellow-500/20 text-yellow-400' : 'bg-red-500/20 text-red-400'}`}>
                                            {pkgMargin}% margin
                                        </span>
                                    </div>
                                    <div className="flex flex-wrap gap-4 mt-2 text-xs text-white/40">
                                        <span>POS → {pkg.destination_code}</span>
                                        <span>Departs {fmtDate(pkg.departure_at)}</span>
                                        <span>{pkg.travelers_booked}/{pkg.max_travelers} booked</span>
                                        <span>{fmtTTD(pkg.price_per_person_cents)}/person</span>
                                        <span className="text-white/60">Wholesale: {fmtTTD(pkg.wholesale_cost_cents)}</span>
                                        {totalPkgMargin > 0 && <span className="text-green-400">Margin earned: {fmtTTD(totalPkgMargin)}</span>}
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    <button
                                        onClick={() => toggleStatus(pkg)}
                                        title={pkg.status === 'active' ? 'Deactivate' : 'Activate'}
                                        className={`p-2 rounded-xl border transition-all ${pkg.status === 'active' ? 'bg-green-500/20 border-green-500/30 text-green-400 hover:bg-red-500/20 hover:border-red-500/30 hover:text-red-400' : 'bg-white/5 border-white/10 text-white/30 hover:bg-green-500/20 hover:border-green-500/30 hover:text-green-400'}`}
                                    >
                                        {pkg.status === 'active' ? <Eye size={16} /> : <EyeOff size={16} />}
                                    </button>
                                    <button onClick={() => openEdit(pkg)} className="p-2 rounded-xl bg-white/5 border border-white/10 text-white/40 hover:text-white hover:bg-white/10 transition-all">
                                        <Edit2 size={16} />
                                    </button>
                                    <button onClick={() => handleDelete(pkg.id, pkg.title)} className="p-2 rounded-xl bg-white/5 border border-white/10 text-white/40 hover:text-red-400 hover:bg-red-500/10 hover:border-red-500/20 transition-all">
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Create / Edit Modal */}
            {showForm && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-[#0d0b18] border border-white/10 rounded-3xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
                        <div className="flex items-center justify-between p-6 border-b border-white/8">
                            <h3 className="text-white font-black text-lg uppercase tracking-widest">
                                {form.id ? 'Edit Package' : 'New Package'}
                            </h3>
                            <button onClick={() => setShowForm(false)} className="p-2 rounded-xl bg-white/5 border border-white/10 text-white/40 hover:text-white transition-all">
                                <X size={18} />
                            </button>
                        </div>

                        <div className="p-6 space-y-4">
                            {error && (
                                <div className="p-4 bg-red-900/30 border border-red-500/30 rounded-xl text-red-300 text-sm">{error}</div>
                            )}

                            <FormRow label="Title">
                                <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} className={inputCls} placeholder="Barbados 2-Night Escape" />
                            </FormRow>

                            <div className="grid grid-cols-2 gap-4">
                                <FormRow label="Destination">
                                    <select value={form.destination_code} onChange={e => setForm(f => ({ ...f, destination_code: e.target.value, destination_name: DEST_OPTS.find(d => d.code === e.target.value)?.label || e.target.value }))} className={inputCls}>
                                        {DEST_OPTS.map(d => <option key={d.code} value={d.code}>{d.label} ({d.code})</option>)}
                                    </select>
                                </FormRow>
                                <FormRow label="Status">
                                    <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value as any }))} className={inputCls}>
                                        {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                                    </select>
                                </FormRow>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <FormRow label="Retail Price/person (cents)">
                                    <input type="number" value={form.price_per_person_cents} onChange={e => setForm(f => ({ ...f, price_per_person_cents: Number(e.target.value) }))} className={inputCls} />
                                    <p className="text-xs text-white/30 mt-1">{fmtTTD(Number(form.price_per_person_cents))}</p>
                                </FormRow>
                                <FormRow label="Wholesale Cost/person (cents)">
                                    <input type="number" value={form.wholesale_cost_cents} onChange={e => setForm(f => ({ ...f, wholesale_cost_cents: Number(e.target.value) }))} className={inputCls} />
                                    <p className="text-xs text-white/30 mt-1">{fmtTTD(Number(form.wholesale_cost_cents))} · Margin: {form.price_per_person_cents > 0 ? Math.round(((form.price_per_person_cents - form.wholesale_cost_cents) / form.price_per_person_cents) * 1000) / 10 : 0}%</p>
                                </FormRow>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <FormRow label="Departure Date/Time">
                                    <input type="datetime-local" value={form.departure_at} onChange={e => setForm(f => ({ ...f, departure_at: e.target.value }))} className={inputCls} />
                                </FormRow>
                                <FormRow label="Max Travelers">
                                    <input type="number" min={1} max={100} value={form.max_travelers} onChange={e => setForm(f => ({ ...f, max_travelers: Number(e.target.value) }))} className={inputCls} />
                                </FormRow>
                            </div>

                            <div className="border-t border-white/8 pt-4">
                                <p className="text-xs font-black text-white/30 uppercase tracking-widest mb-3">Flight Info</p>
                                <div className="grid grid-cols-3 gap-4">
                                    <FormRow label="Airline"><input value={form.airline} onChange={e => setForm(f => ({ ...f, airline: e.target.value }))} className={inputCls} placeholder="Caribbean Airlines" /></FormRow>
                                    <FormRow label="Flight No"><input value={form.flight_number} onChange={e => setForm(f => ({ ...f, flight_number: e.target.value }))} className={inputCls} placeholder="BW500" /></FormRow>
                                    <FormRow label="Cabin"><input value={form.cabin} onChange={e => setForm(f => ({ ...f, cabin: e.target.value }))} className={inputCls} placeholder="Economy" /></FormRow>
                                </div>
                            </div>

                            <div className="border-t border-white/8 pt-4">
                                <p className="text-xs font-black text-white/30 uppercase tracking-widest mb-3">Hotel Info</p>
                                <div className="grid grid-cols-3 gap-4">
                                    <FormRow label="Hotel Name"><input value={form.hotel_name} onChange={e => setForm(f => ({ ...f, hotel_name: e.target.value }))} className={inputCls} placeholder="Bougainvillea Beach" /></FormRow>
                                    <FormRow label="Nights"><input type="number" min={1} max={14} value={form.hotel_nights} onChange={e => setForm(f => ({ ...f, hotel_nights: Number(e.target.value) }))} className={inputCls} /></FormRow>
                                    <FormRow label="Room Type"><input value={form.hotel_room_type} onChange={e => setForm(f => ({ ...f, hotel_room_type: e.target.value }))} className={inputCls} placeholder="Double Room" /></FormRow>
                                </div>
                            </div>

                            <div className="flex items-center gap-3">
                                <input type="checkbox" checked={form.includes_airport_transfer} onChange={e => setForm(f => ({ ...f, includes_airport_transfer: e.target.checked }))} id="transfer" className="w-4 h-4 accent-blue-500" />
                                <label htmlFor="transfer" className="text-white/60 text-sm">Include G-Taxi airport transfer</label>
                            </div>
                        </div>

                        <div className="p-6 border-t border-white/8 flex gap-3 justify-end">
                            <button onClick={() => setShowForm(false)} className="px-5 py-3 rounded-xl bg-white/5 border border-white/10 text-white/40 hover:text-white font-bold text-sm transition-all">
                                Cancel
                            </button>
                            <button
                                onClick={handleSave}
                                disabled={saving}
                                className="px-6 py-3 rounded-xl bg-blue-500 hover:bg-blue-400 disabled:opacity-50 text-white font-black text-sm uppercase tracking-widest transition-all"
                            >
                                {saving ? 'Saving…' : form.id ? 'Update' : 'Create Package'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function KpiCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string | number; color: string }) {
    const bg: Record<string, string> = { blue: 'rgba(59,130,246,0.1)', green: 'rgba(34,197,94,0.1)', yellow: 'rgba(245,158,11,0.1)', purple: 'rgba(139,92,246,0.1)' };
    const text: Record<string, string> = { blue: '#3B82F6', green: '#22C55E', yellow: '#F59E0B', purple: '#8B5CF6' };
    return (
        <div className="bg-white/5 border border-white/8 rounded-2xl p-5" style={{ background: bg[color] }}>
            <div className="flex items-center gap-2 mb-3" style={{ color: text[color] }}>{icon}<span className="text-xs font-black uppercase tracking-widest opacity-70">{label}</span></div>
            <div className="text-white font-black text-2xl">{value}</div>
        </div>
    );
}

function StatusBadge({ status }: { status: string }) {
    const cfg: Record<string, string> = { active: 'bg-green-500/20 text-green-400 border-green-500/30', draft: 'bg-white/5 text-white/40 border-white/10', sold_out: 'bg-orange-500/20 text-orange-400 border-orange-500/30', expired: 'bg-red-500/20 text-red-400 border-red-500/30', cancelled: 'bg-red-900/30 text-red-300 border-red-900/30' };
    return <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${cfg[status] || cfg.draft} capitalize`}>{status}</span>;
}

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div>
            <label className="block text-xs font-black text-white/30 uppercase tracking-widest mb-1.5">{label}</label>
            {children}
        </div>
    );
}

const inputCls = 'w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-blue-500/50 placeholder:text-white/20';
