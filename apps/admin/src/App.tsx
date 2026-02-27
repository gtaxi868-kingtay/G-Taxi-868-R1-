import { useEffect, useState } from 'react';
import { supabase, adminFetch } from './lib/supabase';
import { ShieldAlert, AlertTriangle, Car, CheckCircle2, XCircle, Search, Settings, Wallet, Users } from 'lucide-react';
import Login from './pages/Login';

interface Ride {
  id: string;
  created_at: string;
  status: string;
  pickup_address: string;
  dropoff_address: string;
  total_fare_cents: number;
  rider_id: string;
  driver_id: string | null;
}

interface UserRow {
  id: string;
  name: string;
  email: string;
  is_driver: boolean;
  balance_cents: number;
}

interface LockedDriver {
  user_id: string;
  name: string;
  balance: number;
}

interface Flag {
  id: string;
  is_active: boolean;
}

function App() {
  // 'checking' → auth in flight | 'login' → no session / not admin | 'dashboard' → verified admin
  const [view, setView] = useState<'checking' | 'login' | 'dashboard'>('checking');

  const [rides, setRides] = useState<Ride[]>([]);
  const [loading, setLoading] = useState(true);
  const [flags, setFlags] = useState<Flag[]>([]);
  const [lockedDrivers, setLockedDrivers] = useState<LockedDriver[]>([]);
  const [allUsers, setAllUsers] = useState<UserRow[]>([]);

  // Run the role check on mount, and again after a successful login.
  // Note: the actual admin role verification lives server-side inside requireAdmin.
  // Here we just check for a valid session to decide which view to show.
  const runAuthCheck = async () => {
    setView('checking');
    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
      setView('login');
      return;
    }

    // Attempt a lightweight call to an admin edge function.
    // If the user is not admin, the function returns 403 and adminFetch throws.
    // This is the definitive role check — not a client-side profile read.
    try {
      await adminFetch('admin_get_rides');
      setView('dashboard');
    } catch {
      // Not an admin (403) or session invalid — sign out and show login.
      await supabase.auth.signOut();
      setView('login');
    }
  };

  useEffect(() => {
    runAuthCheck();
  }, []);

  // ─── Data Fetchers (all go through edge functions) ─────────────────────────

  const fetchRides = async () => {
    try {
      const { data } = await adminFetch('admin_get_rides');
      setRides(data || []);
    } catch (err: any) {
      console.error('fetchRides error:', err.message);
    }
    setLoading(false);
  };

  const fetchAdminData = async () => {
    try {
      const { users, lockedDrivers: locked } = await adminFetch('admin_get_users');
      setAllUsers(users || []);
      setLockedDrivers(locked || []);
    } catch (err: any) {
      console.error('fetchAdminData (users) error:', err.message);
    }

    // ── UI-B4: Flags fetch via adminFetch ─────────────────────────────────────
    //
    // Primary path: adminFetch('admin_get_flags') — routes through the edge
    // function so auth + role checks are enforced server-side.
    //
    // Fallback path: direct REST API call using the session anon token.
    // This is used ONLY if admin_get_flags does not exist as an edge function,
    // because flags are read-only data and the system_feature_flags table has
    // an RLS policy that allows authenticated admin reads.
    // The toggle actions (writes) still go through admin_toggle_flag.
    try {
      const data = await adminFetch('admin_get_flags');
      setFlags(Array.isArray(data) ? data : (data?.flags || []));
    } catch (primaryErr: any) {
      // admin_get_flags edge function not yet deployed — fall back to direct REST.
      // Remove this fallback once admin_get_flags is deployed.
      console.warn('admin_get_flags not available, falling back to direct REST fetch:', primaryErr.message);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;

        const res = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/system_feature_flags?select=id,is_active&order=id`,
          {
            headers: {
              'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
              'Authorization': `Bearer ${session.access_token}`,
            },
          }
        );
        if (res.ok) {
          const flagData = await res.json();
          setFlags(flagData || []);
        }
      } catch (fallbackErr: any) {
        console.error('fetchAdminData (flags) fallback error:', fallbackErr.message);
      }
    }
  };

  useEffect(() => {
    if (view !== 'dashboard') return;

    fetchRides();
    fetchAdminData();

    // Realtime — still uses the anon Supabase client (anon key is fine for subscriptions).
    const channel = supabase
      .channel('schema-db-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'rides' },
        () => { fetchRides(); }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [view]);

  // ─── Actions ───────────────────────────────────────────────────────────────

  const handleForceCancel = async (rideId: string) => {
    if (!window.confirm('Are you sure you want to FORCE CANCEL this ride?')) return;

    try {
      await adminFetch('admin_cancel_ride', { ride_id: rideId });
      await fetchRides();
    } catch (err: any) {
      alert('Failed to cancel: ' + err.message);
    }
  };

  const toggleFlag = async (id: string, current: boolean) => {
    try {
      await adminFetch('admin_toggle_flag', { id, is_active: current });
      await fetchAdminData();
    } catch (err: any) {
      alert('Failed to toggle flag: ' + err.message);
    }
  };

  const settleDriverDebt = async (user_id: string, currentBalanceCents: number) => {
    if (!window.confirm("Confirm receiving Bank Transfer/Cash to clear this driver's debt?")) return;

    const creditAmount = Math.abs(currentBalanceCents);

    try {
      await adminFetch('admin_settle_debt', { user_id, amount_cents: creditAmount });
      alert('Driver Unlocked.');
      await fetchAdminData();
    } catch (err: any) {
      alert('Failed to settle: ' + err.message);
    }
  };

  const toggleDriverAuthorization = async (user: UserRow) => {
    if (user.is_driver) {
      if (!window.confirm(`Revoke driver access for ${user.name}? They will be logged out and lose app access.`)) return;
      try {
        await adminFetch('admin_toggle_driver', { user_id: user.id, action: 'revoke' });
      } catch (err: any) {
        alert('Failed to revoke: ' + err.message);
      }
    } else {
      if (!window.confirm(`Authorize ${user.name} as a Driver?`)) return;
      try {
        await adminFetch('admin_toggle_driver', { user_id: user.id, action: 'authorize', name: user.name });
      } catch (err: any) {
        alert('Failed to authorize: ' + err.message);
      }
    }
    await fetchAdminData();
  };

  const isStuck = (ride: Ride) => {
    if (ride.status !== 'searching' && ride.status !== 'requested') return false;
    const minutesOld = (new Date().getTime() - new Date(ride.created_at).getTime()) / 60000;
    return minutesOld > 15;
  };

  // ─── View gates ────────────────────────────────────────────────────────────

  if (view === 'checking') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  if (view === 'login') {
    return <Login onLoginSuccess={runAuthCheck} />;
  }

  // view === 'dashboard'
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="bg-slate-900 text-white p-6 shadow-md flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ShieldAlert className="w-8 h-8 text-indigo-400" />
          <h1 className="text-2xl font-bold tracking-tight">G-Taxi Operations</h1>
        </div>
        <div className="flex items-center gap-4">
          <span className="bg-indigo-500/20 text-indigo-300 px-3 py-1 rounded-full text-sm font-semibold border border-indigo-500/30">
            Admin Access
          </span>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-8">
        <div className="flex justify-between items-center mb-8">
          <h2 className="text-xl font-semibold text-slate-800 flex items-center gap-2">
            <Car className="w-5 h-5" /> Live Ride Monitor
          </h2>
          <button
            onClick={fetchRides}
            className="text-sm bg-white border border-slate-300 px-4 py-2 rounded-md shadow-sm hover:bg-slate-50 transition"
          >
            Refresh
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center p-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-sm font-medium text-slate-500">
                  <th className="p-4">Time</th>
                  <th className="p-4">Status</th>
                  <th className="p-4">Pickup</th>
                  <th className="p-4">Dropoff</th>
                  <th className="p-4">Fare</th>
                  <th className="p-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rides.map(ride => {
                  const stuck = isStuck(ride);
                  return (
                    <tr key={ride.id} className={`transition hover:bg-slate-50 ${stuck ? 'bg-red-50/50' : ''}`}>
                      <td className="p-4 text-sm whitespace-nowrap">
                        {new Date(ride.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="p-4">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border
                          ${ride.status === 'completed' ? 'bg-green-100 text-green-700 border-green-200' :
                            ride.status === 'cancelled' ? 'bg-slate-100 text-slate-600 border-slate-200' :
                              ride.status === 'in_progress' || ride.status === 'arrived' ? 'bg-blue-100 text-blue-700 border-blue-200' :
                                stuck ? 'bg-red-100 text-red-700 border-red-200' :
                                  'bg-yellow-100 text-yellow-700 border-yellow-200'
                          }
                        `}>
                          {ride.status === 'completed' && <CheckCircle2 className="w-3 h-3" />}
                          {ride.status === 'cancelled' && <XCircle className="w-3 h-3" />}
                          {ride.status === 'searching' && <Search className="w-3 h-3" />}
                          {stuck && <AlertTriangle className="w-3 h-3" />}
                          {ride.status.toUpperCase()}
                        </span>
                        {stuck && <p className="text-[10px] text-red-500 mt-1 font-semibold">STUCK</p>}
                      </td>
                      <td className="p-4 text-sm text-slate-600 max-w-[200px] truncate" title={ride.pickup_address}>
                        {ride.pickup_address}
                      </td>
                      <td className="p-4 text-sm text-slate-600 max-w-[200px] truncate" title={ride.dropoff_address}>
                        {ride.dropoff_address}
                      </td>
                      <td className="p-4 text-sm font-medium">
                        ${(ride.total_fare_cents / 100).toFixed(2)}
                      </td>
                      <td className="p-4 text-right">
                        {!['completed', 'cancelled'].includes(ride.status) && (
                          <button
                            onClick={() => handleForceCancel(ride.id)}
                            className="text-xs bg-red-50 text-red-600 hover:bg-red-100 px-3 py-1.5 rounded border border-red-100 transition font-medium"
                          >
                            FORCE CANCEL
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {rides.length === 0 && (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-slate-500">
                      No rides found in the system.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* ADMIN PANELS */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-12">
          {/* System Feature Flags */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <h3 className="text-lg font-semibold text-slate-800 flex items-center gap-2 mb-4">
              <Settings className="w-5 h-5 text-indigo-500" />
              System Feature Flags
            </h3>
            <p className="text-sm text-slate-500 mb-6">Hot-Toggle Rider App components without App Store updates.</p>
            <div className="space-y-4">
              {flags.map(flag => (
                <div key={flag.id} className="flex items-center justify-between p-4 bg-slate-50 rounded-lg border border-slate-100">
                  <div>
                    <p className="font-medium text-slate-800 capitalize">{flag.id.replace(/_/g, ' ')}</p>
                    <p className="text-xs text-slate-500">Currently {flag.is_active ? 'Active' : 'Hidden'} in Rider App</p>
                  </div>
                  <button
                    onClick={() => toggleFlag(flag.id, flag.is_active)}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${flag.is_active ? 'bg-indigo-600' : 'bg-slate-200'}`}
                  >
                    <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${flag.is_active ? 'translate-x-5' : 'translate-x-0'}`} />
                  </button>
                </div>
              ))}
              {flags.length === 0 && <p className="text-sm text-slate-500 italic">No feature flags found in DB.</p>}
            </div>
          </div>

          {/* Locked Drivers / Settlements */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <h3 className="text-lg font-semibold text-slate-800 flex items-center gap-2 mb-4">
              <Wallet className="w-5 h-5 text-red-500" />
              Locked Drivers (Debt &gt; $600 TTD)
            </h3>
            <p className="text-sm text-slate-500 mb-6">Drivers listed here are blocked from receiving dispatches.</p>
            <div className="space-y-4">
              {lockedDrivers.map(drv => (
                <div key={drv.user_id} className="flex items-center justify-between p-4 bg-red-50 rounded-lg border border-red-100">
                  <div>
                    <p className="font-medium text-slate-800 flex items-center gap-2">
                      <Users className="w-4 h-4 text-slate-500" />
                      {drv.name}
                    </p>
                    <p className="text-xs font-bold text-red-600 mt-1">
                      Owes: ${(Math.abs(drv.balance) / 100).toFixed(2)} TTD
                    </p>
                  </div>
                  <button
                    onClick={() => settleDriverDebt(drv.user_id, drv.balance)}
                    className="text-xs bg-white text-indigo-600 border border-indigo-200 hover:bg-indigo-50 px-3 py-2 rounded-md font-medium transition"
                  >
                    Settle to $0
                  </button>
                </div>
              ))}
              {lockedDrivers.length === 0 && (
                <div className="p-8 text-center bg-green-50 rounded-lg border border-green-100">
                  <CheckCircle2 className="w-8 h-8 text-green-500 mx-auto mb-2" />
                  <p className="text-sm font-medium text-green-800">No locked drivers.</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* DRIVER WAITLIST MANAGEMENT */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mt-8">
          <h3 className="text-lg font-semibold text-slate-800 flex items-center gap-2 mb-4">
            <Users className="w-5 h-5 text-indigo-500" />
            Driver Waitlist Management
          </h3>
          <p className="text-sm text-slate-500 mb-6">
            Authorize registered users to login to the Driver App. Public registration is controlled via the 'driver_registration_active' feature flag above.
          </p>

          <div className="bg-slate-50 rounded-lg border border-slate-200 overflow-hidden">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-200 text-sm font-medium text-slate-600">
                  <th className="p-4">Name</th>
                  <th className="p-4">Email</th>
                  <th className="p-4">Status</th>
                  <th className="p-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {allUsers.map(user => (
                  <tr key={user.id} className="transition hover:bg-white">
                    <td className="p-4 text-sm font-medium text-slate-800">{user.name}</td>
                    <td className="p-4 text-sm text-slate-500">{user.email}</td>
                    <td className="p-4 text-sm">
                      {user.is_driver ? (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold bg-indigo-100 text-indigo-700 border border-indigo-200">
                          Authorized Driver
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold bg-slate-200 text-slate-600 border border-slate-300">
                          Standard User
                        </span>
                      )}
                    </td>
                    <td className="p-4 text-right">
                      <button
                        onClick={() => toggleDriverAuthorization(user)}
                        className={`text-xs px-3 py-1.5 rounded transition font-bold border ${user.is_driver
                          ? 'bg-red-50 text-red-600 border-red-200 hover:bg-red-100'
                          : 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100 shadow-sm'
                          }`}
                      >
                        {user.is_driver ? 'REVOKE ACCESS' : 'AUTHORIZE'}
                      </button>
                    </td>
                  </tr>
                ))}
                {allUsers.length === 0 && (
                  <tr>
                    <td colSpan={4} className="p-8 text-center text-slate-500">
                      No users registered.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

      </main>
    </div>
  );
}

export default App;
