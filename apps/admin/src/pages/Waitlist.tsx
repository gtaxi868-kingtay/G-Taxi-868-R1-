import { useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { RefreshCw, Search, Users2, MapPin } from 'lucide-react';

interface WaitlistRow {
    id: string;
    full_name: string;
    email: string | null;
    phone: string | null;
    user_type: string | null;
    status: string | null;
    created_at: string;
    community: string | null;
    referred_by: string | null;
    source: string | null;
}

const C = {
    text: '#F1F5F9',
    muted: 'rgba(255,255,255,0.4)',
    faint: 'rgba(255,255,255,0.3)',
    body: 'rgba(255,255,255,0.8)',
    surface: 'rgba(255,255,255,0.05)',
    surfaceHigh: 'rgba(255,255,255,0.08)',
    accent: '#A78BFA',
    ok: '#10B981',
};

const ROLE_LABELS: Record<string, string> = {
    ride: 'Rider',
    drive: 'Driver',
    sell: 'Merchant',
};

const roleLabel = (t: string | null) => (t ? ROLE_LABELS[t] || t : '—');

const fmt = (iso: string) => new Date(iso).toLocaleString('en-TT', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
});

export function Waitlist() {
    const [rows, setRows] = useState<WaitlistRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [communityFilter, setCommunityFilter] = useState('all');
    const [roleFilter, setRoleFilter] = useState('all');

    const fetchRows = useCallback(async () => {
        setError(null);
        const { data, error: err } = await supabase
            .from('waitlist')
            .select('id, full_name, email, phone, user_type, status, created_at, community, referred_by, source')
            .order('created_at', { ascending: false });
        if (err) {
            setError(err.message);
        } else {
            setRows(data || []);
        }
        setLoading(false);
    }, []);

    useEffect(() => {
        fetchRows();
        const interval = setInterval(fetchRows, 60000);
        return () => clearInterval(interval);
    }, [fetchRows]);

    const byCommunity = useMemo(() => {
        const map = new Map<string, number>();
        for (const r of rows) {
            const key = r.community || 'Unspecified';
            map.set(key, (map.get(key) || 0) + 1);
        }
        return [...map.entries()].sort((a, b) => b[1] - a[1]);
    }, [rows]);

    const communities = useMemo(() => [...new Set(rows.map(r => r.community || 'Unspecified'))].sort(), [rows]);

    const filtered = useMemo(() => rows.filter(r => {
        if (communityFilter !== 'all' && (r.community || 'Unspecified') !== communityFilter) return false;
        if (roleFilter !== 'all' && r.user_type !== roleFilter) return false;
        if (search.trim()) {
            const q = search.trim().toLowerCase();
            if (!r.full_name.toLowerCase().includes(q) && !(r.phone || '').includes(q)) return false;
        }
        return true;
    }), [rows, communityFilter, roleFilter, search]);

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <RefreshCw size={24} className="animate-spin" style={{ color: C.accent }} />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between flex-wrap gap-4">
                <div>
                    <h2 className="text-xl font-black" style={{ color: C.text }}>Waitlist Signups</h2>
                    <p className="text-xs mt-1" style={{ color: C.muted }}>{rows.length} total · live from the public front door</p>
                </div>
                <button
                    onClick={() => { setLoading(true); fetchRows(); }}
                    className="flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold"
                    style={{ background: C.surfaceHigh, color: C.text }}
                >
                    <RefreshCw size={14} /> Refresh
                </button>
            </div>

            {error && (
                <div className="p-4 rounded-xl text-sm" style={{ background: 'rgba(239,68,68,0.1)', color: '#EF4444' }}>
                    Failed to load: {error}
                </div>
            )}

            <div>
                <div className="flex items-center gap-2 mb-3">
                    <MapPin size={14} style={{ color: C.accent }} />
                    <span className="text-[11px] font-black uppercase tracking-widest" style={{ color: C.muted }}>By community</span>
                </div>
                <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
                    {byCommunity.length === 0 && (
                        <div className="text-sm p-4" style={{ color: C.faint }}>No signups yet.</div>
                    )}
                    {byCommunity.map(([name, count]) => (
                        <button
                            key={name}
                            onClick={() => setCommunityFilter(communityFilter === name ? 'all' : name)}
                            className="p-4 rounded-xl text-left transition-colors"
                            style={{
                                background: communityFilter === name ? 'rgba(167,139,250,0.16)' : C.surface,
                                border: `1px solid ${communityFilter === name ? C.accent : 'rgba(255,255,255,0.08)'}`,
                            }}
                        >
                            <div className="text-2xl font-black" style={{ color: C.text }}>{count}</div>
                            <div className="text-xs mt-1 truncate" style={{ color: C.muted }}>{name}</div>
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
                <div className="relative flex-1 min-w-[200px]">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: C.faint }} />
                    <input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Search name or phone…"
                        className="w-full pl-9 pr-3 py-2 rounded-lg text-sm outline-none"
                        style={{ background: C.surface, border: '1px solid rgba(255,255,255,0.08)', color: C.text }}
                    />
                </div>
                <select
                    value={communityFilter}
                    onChange={e => setCommunityFilter(e.target.value)}
                    className="px-3 py-2 rounded-lg text-sm outline-none"
                    style={{ background: C.surface, border: '1px solid rgba(255,255,255,0.08)', color: C.text }}
                >
                    <option value="all">All communities</option>
                    {communities.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <select
                    value={roleFilter}
                    onChange={e => setRoleFilter(e.target.value)}
                    className="px-3 py-2 rounded-lg text-sm outline-none"
                    style={{ background: C.surface, border: '1px solid rgba(255,255,255,0.08)', color: C.text }}
                >
                    <option value="all">All roles</option>
                    <option value="ride">Rider</option>
                    <option value="drive">Driver</option>
                    <option value="sell">Merchant</option>
                </select>
            </div>

            <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr style={{ background: C.surface }}>
                                <th className="text-left px-4 py-3 font-bold text-xs uppercase tracking-wider" style={{ color: C.muted }}>Name</th>
                                <th className="text-left px-4 py-3 font-bold text-xs uppercase tracking-wider" style={{ color: C.muted }}>Phone</th>
                                <th className="text-left px-4 py-3 font-bold text-xs uppercase tracking-wider" style={{ color: C.muted }}>Community</th>
                                <th className="text-left px-4 py-3 font-bold text-xs uppercase tracking-wider" style={{ color: C.muted }}>Role</th>
                                <th className="text-left px-4 py-3 font-bold text-xs uppercase tracking-wider" style={{ color: C.muted }}>Source</th>
                                <th className="text-left px-4 py-3 font-bold text-xs uppercase tracking-wider" style={{ color: C.muted }}>Signed up</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.length === 0 && (
                                <tr>
                                    <td colSpan={6} className="px-4 py-8 text-center" style={{ color: C.faint }}>
                                        <Users2 size={20} className="mx-auto mb-2" style={{ opacity: 0.4 }} />
                                        No signups match this filter.
                                    </td>
                                </tr>
                            )}
                            {filtered.map(r => (
                                <tr key={r.id} style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                                    <td className="px-4 py-3 font-semibold" style={{ color: C.text }}>{r.full_name}</td>
                                    <td className="px-4 py-3" style={{ color: C.body }}>{r.phone || '—'}</td>
                                    <td className="px-4 py-3" style={{ color: C.body }}>{r.community || 'Unspecified'}</td>
                                    <td className="px-4 py-3">
                                        <span
                                            className="px-2 py-1 rounded-full text-[11px] font-bold"
                                            style={{ background: 'rgba(167,139,250,0.14)', color: C.accent }}
                                        >
                                            {roleLabel(r.user_type)}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-xs" style={{ color: C.faint }}>{r.source || '—'}</td>
                                    <td className="px-4 py-3 text-xs" style={{ color: C.faint }}>{fmt(r.created_at)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
