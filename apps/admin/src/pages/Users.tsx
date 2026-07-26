import { useEffect, useState, useCallback } from 'react';
import { adminFetch } from '../lib/supabase';
import { ShieldCheck, ShieldOff, RefreshCw, Search } from 'lucide-react';

// Vetting gate for new accounts. Signup (web + mobile) always creates a
// plain rider account — this is the only place a rider becomes admin.
// No self-service admin elevation exists anywhere in the codebase; this
// page is that missing control, calling the toggle_role action that
// already existed in supabase/functions/admin/index.ts with no UI on it.
interface UserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  is_driver: boolean;
  balance_cents: number;
}

export function Users() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { users } = await adminFetch('admin', { action: 'get_users' });
      setUsers(users || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleAdmin = async (u: UserRow) => {
    const newRole = u.role === 'admin' ? 'rider' : 'admin';
    const verb = newRole === 'admin' ? 'Grant admin access to' : 'Revoke admin access from';
    if (!window.confirm(`${verb} ${u.name || u.email}?`)) return;
    setBusyId(u.id);
    try {
      await adminFetch('admin', { action: 'toggle_role', target_user_id: u.id, new_role: newRole });
      setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, role: newRole } : x)));
    } catch (err: any) {
      alert(err.message || 'Failed to change role');
    } finally {
      setBusyId(null);
    }
  };

  const filtered = users.filter((u) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return u.name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-white/40 max-w-xl">
          Every new signup (web or mobile) lands here as a plain rider. Grant admin only to people
          you've vetted directly — there's no other way into the role.
        </p>
        <button
          onClick={load}
          disabled={loading}
          className="px-4 py-2 bg-white/5 border border-white/10 rounded-xl text-white/60 text-xs font-black uppercase tracking-widest hover:bg-white/10 flex items-center gap-2 shrink-0"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      <div className="relative max-w-sm">
        <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/20" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or email…"
          className="admin-input w-full pl-10"
        />
      </div>

      {error && <div className="error-banner"><span>{error}</span></div>}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="bg-white/5 rounded-2xl border border-white/10 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-white/[0.02]">
                  <th className="px-6 py-4 text-[10px] font-black text-white/20 uppercase tracking-widest">Name</th>
                  <th className="px-6 py-4 text-[10px] font-black text-white/20 uppercase tracking-widest">Email</th>
                  <th className="px-6 py-4 text-[10px] font-black text-white/20 uppercase tracking-widest">Role</th>
                  <th className="px-6 py-4 text-[10px] font-black text-white/20 uppercase tracking-widest text-right">Access</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {filtered.map((u) => (
                  <tr key={u.id} className="hover:bg-white/[0.02]">
                    <td className="px-6 py-4 text-sm font-bold text-white/80">{u.name}</td>
                    <td className="px-6 py-4 text-xs text-white/50">{u.email}</td>
                    <td className="px-6 py-4">
                      <span className={`text-[9px] font-black px-2 py-1 rounded-md border uppercase tracking-widest ${
                        u.role === 'admin'
                          ? 'text-purple-400 bg-purple-400/10 border-purple-500/20'
                          : 'text-white/30 bg-white/5 border-white/10'
                      }`}>
                        {u.role}{u.is_driver ? ' · driver' : ''}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => toggleAdmin(u)}
                        disabled={busyId === u.id}
                        className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest disabled:opacity-40 ${
                          u.role === 'admin'
                            ? 'bg-red-500/15 border border-red-500/25 text-red-400 hover:bg-red-500/25'
                            : 'bg-purple-500/15 border border-purple-500/25 text-purple-400 hover:bg-purple-500/25'
                        }`}
                      >
                        {u.role === 'admin' ? <ShieldOff size={12} /> : <ShieldCheck size={12} />}
                        {u.role === 'admin' ? 'Revoke Admin' : 'Grant Admin'}
                      </button>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={4} className="px-6 py-12 text-center text-sm text-white/30">No users match.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
