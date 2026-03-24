import { useEffect, useState } from 'react';
import { supabase, adminFetch } from './lib/supabase';
import { ShieldAlert, AlertTriangle, Car, CheckCircle2, XCircle, Search, Settings, Wallet, Users, Map as MapIcon } from 'lucide-react';
import Login from './pages/Login';
import { DriverMap } from './components/DriverMap';

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
  const [flags, setFlags] = useState<Flag[]>([]);
  const [lockedDrivers, setLockedDrivers] = useState<LockedDriver[]>([]);
  const [allUsers, setAllUsers] = useState<UserRow[]>([]);

  const runAuthCheck = async () => {
    setView('checking');
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setView('login'); return; }
    
    try {
      // Proactively check if we are truly an admin
      await adminFetch('admin_get_rides');
      setView('dashboard');
    } catch (err: any) {
      console.error('Auth Check Failed:', err);
      // Only sign out if it's a definitive authorization failure (401/403)
      // Otherwise, stay in dashboard mode but show empty/error state
      if (err.message?.includes('HTTP_401') || err.message?.includes('HTTP_403')) {
        await supabase.auth.signOut();
        setView('login');
      } else {
        // Fallback: Default to dashboard if it's just a data-loading error (e.g. 500, 404)
        setView('dashboard');
      }
    }
  };

  useEffect(() => { 
    runAuthCheck(); 

    // Listen for auth state changes (login/logout) to update view immediately
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        setView('login');
      } else if (view === 'login') {
        runAuthCheck();
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const fetchRides = async () => {
    try {
      const { data } = await adminFetch('admin_get_rides');
      setRides(data || []);
    } catch (err: any) { console.error('fetchRides error:', err.message); }
  };

  const fetchAdminData = async () => {
    try {
      const { users, lockedDrivers: locked } = await adminFetch('admin_get_users');
      setAllUsers(users || []);
      setLockedDrivers(locked || []);
    } catch (err: any) { console.error('fetchAdminData error:', err.message); }

    try {
      const data = await adminFetch('admin_get_flags');
      setFlags(Array.isArray(data) ? data : (data?.flags || []));
    } catch (primaryErr: any) {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/system_feature_flags?select=id,is_active&order=id`, {
        headers: { 'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY, 'Authorization': `Bearer ${session.access_token}` }
      });
      if (res.ok) { setFlags(await res.json() || []); }
    }
  };

  useEffect(() => {
    if (view !== 'dashboard') return;
    fetchRides();
    fetchAdminData();
    const channel = supabase.channel('schema-db-changes').on('postgres_changes', { event: '*', schema: 'public', table: 'rides' }, () => { fetchRides(); }).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [view]);

  const handleForceCancel = async (rideId: string) => {
    if (!window.confirm('FORCE CANCEL this ride?')) return;
    try { await adminFetch('admin_cancel_ride', { ride_id: rideId }); fetchRides(); } catch (err: any) { alert(err.message); }
  };

  const toggleFlag = async (id: string, current: boolean) => {
    try { await adminFetch('admin_toggle_flag', { id, is_active: current }); fetchAdminData(); } catch (err: any) { alert(err.message); }
  };

  const settleDriverDebt = async (user_id: string, currentBalanceCents: number) => {
    if (!window.confirm("Confirm debt settlement?")) return;
    try { await adminFetch('admin_settle_debt', { user_id, amount_cents: Math.abs(currentBalanceCents) }); alert('Driver Unlocked.'); fetchAdminData(); } catch (err: any) { alert(err.message); }
  };

  const toggleDriverAuthorization = async (user: UserRow) => {
    const action = user.is_driver ? 'revoke' : 'authorize';
    if (!window.confirm(`${action.toUpperCase()} access for ${user.name}?`)) return;
    try { await adminFetch('admin_toggle_driver', { user_id: user.id, action, name: user.name }); fetchAdminData(); } catch (err: any) { alert(err.message); }
  };

  if (view === 'checking') return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a0c]">
      <div className="w-12 h-12 border-4 border-cyan-400 border-t-transparent rounded-full animate-spin shadow-[0_0_15px_rgba(0,242,255,0.4)]" />
    </div>
  );

  if (view === 'login') return <Login onLoginSuccess={runAuthCheck} />;

  // RESILIENT STYLE OBJECTS
  const styles = {
    header: {
        background: 'rgba(10, 10, 12, 0.8)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid rgba(0, 242, 255, 0.1)',
        position: 'sticky' as const,
        top: 0,
        zIndex: 50,
        padding: '1rem 2rem'
    },
    neonText: {
        fontFamily: "'Orbitron', sans-serif",
        color: '#00f2ff',
        textShadow: '0 0 10px rgba(0, 242, 255, 0.3)',
        letterSpacing: '-0.05em',
        fontWeight: 900
    },
    glassCard: {
        background: 'rgba(255, 255, 255, 0.03)',
        backdropFilter: 'blur(10px)',
        border: '1px solid rgba(255, 255, 255, 0.05)',
        borderRadius: '1rem',
        padding: '1.5rem',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)'
    },
    tag: {
        fontSize: '10px',
        fontWeight: 'bold',
        textTransform: 'uppercase' as const,
        tracking: '0.2em',
        padding: '0.25rem 0.75rem',
        borderRadius: '999px',
        border: '1px solid rgba(0, 242, 255, 0.2)',
        background: 'rgba(0, 242, 255, 0.1)',
        color: '#00f2ff'
    }
  };

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#0a0a0c', color: '#f8fafc', paddingBottom: '5rem' }}>
      <header style={styles.header}>
        <div style={{ maxWidth: '80rem', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <img 
                src="/logo.png" 
                alt="Logo" 
                style={{ height: '40px', width: 'auto', filter: 'drop-shadow(0 0 8px rgba(0, 242, 255, 0.5))' }} 
            />
            <h1 style={styles.neonText}>
              G-TAXI<span style={{ color: '#fff' }}> 868</span>
            </h1>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
             <div style={styles.tag}>Secure Link 1.0.4</div>
             <button 
                onClick={() => supabase.auth.signOut().then(() => setView('login'))} 
                className="hover:text-white transition-colors"
                style={{ fontSize: '10px', fontWeight: 'bold', color: 'rgba(255,255,255,0.4)', background: 'none', border: 'none', cursor: 'pointer' }}
             >
               TERMINATE SESSION
             </button>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: '80rem', margin: '0 auto', padding: '2.5rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '2.5rem' }}>
        {/* GEOLOCATION HUB */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0 0.5rem' }}>
            <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#00f2ff', boxShadow: '0 0 8px #00f2ff' }} />
            <h2 style={{ fontSize: '10px', fontWeight: 'bold', letterSpacing: '0.3em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)' }}>Live Geolocation Relay</h2>
          </div>
          <div style={{ ...styles.glassCard, padding: '0.5rem', overflow: 'hidden' }}>
            <DriverMap />
          </div>
        </section>

        {/* DATA MONITOR */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '2rem' }}>
          
          {/* RIDE STREAM */}
          <div style={{ gridColumn: 'span 2', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 0.5rem' }}>
              <h2 style={{ fontSize: '10px', fontWeight: 'bold', letterSpacing: '0.3em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)' }}>Main Ride Stream</h2>
              <button 
                onClick={fetchRides} 
                style={{ fontSize: '10px', fontWeight: 'bold', color: '#00f2ff', background: 'none', border: 'none', cursor: 'pointer', letterSpacing: '0.1em' }}
              >REFRESH_RELAY</button>
            </div>
            
            <div style={{ ...styles.glassCard, padding: 0, overflow: 'hidden' }}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', backgroundColor: 'rgba(255,255,255,0.02)' }}>
                      <th style={{ padding: '1rem', fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(255,255,255,0.3)' }}>Timestamp</th>
                      <th style={{ padding: '1rem', fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(255,255,255,0.3)' }}>Status</th>
                      <th style={{ padding: '1rem', fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(255,255,255,0.3)' }}>Route</th>
                      <th style={{ padding: '1rem', fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(255,255,255,0.3)' }}>Fare</th>
                      <th style={{ padding: '1rem', textAlign: 'right', fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(255,255,255,0.3)' }}>Ops</th>
                    </tr>
                  </thead>
                  <tbody style={{ backgroundColor: 'transparent' }}>
                    {rides.map(ride => {
                      const color = 
                        ride.status === 'completed' ? '#4ade80' :
                        ride.status === 'cancelled' ? '#f87171' :
                        ride.status === 'in_progress' ? '#22d3ee' : '#fbbf24';
                      
                      return (
                        <tr key={ride.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)', transition: 'background-color 0.2s' }}>
                          <td style={{ padding: '1rem', fontSize: '11px', fontWeight: 500, color: 'rgba(255,255,255,0.4)', fontFamily: "'Orbitron', sans-serif" }}>
                            {new Date(ride.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                          </td>
                          <td style={{ padding: '1rem' }}>
                            <span style={{ fontSize: '9px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em', border: `1px solid ${color}33`, padding: '0.125rem 0.5rem', borderRadius: '4px', color: color, backgroundColor: `${color}0D` }}>
                              {ride.status}
                            </span>
                          </td>
                          <td style={{ padding: '1rem' }}>
                            <div style={{ maxWidth: '180px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: '11px', color: 'rgba(255,255,255,0.7)' }}>{ride.pickup_address}</div>
                            <div style={{ maxWidth: '180px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: '10px', color: 'rgba(255,255,255,0.3)', fontStyle: 'italic', marginTop: '0.125rem' }}>to {ride.dropoff_address}</div>
                          </td>
                          <td style={{ padding: '1rem', fontSize: '11px', fontWeight: 'bold', color: '#fff' }}>${(ride.total_fare_cents / 100).toFixed(2)}</td>
                          <td style={{ padding: '1rem', textAlign: 'right' }}>
                             {!['completed', 'cancelled'].includes(ride.status) && (
                               <button 
                                onClick={() => handleForceCancel(ride.id)} 
                                style={{ fontSize: '9px', fontWeight: 900, color: 'rgba(239,68,68,0.6)', border: '1px solid rgba(239,68,68,0.2)', padding: '0.25rem 0.5rem', borderRadius: '4px', cursor: 'pointer', background: 'none' }}
                               >ABORT</button>
                             )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* SIDEBAR TACTICAL PANEL */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            {/* FEATURE FLAGS */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <h2 style={{ fontSize: '10px', fontWeight: 'bold', letterSpacing: '0.3em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', padding: '0 0.5rem' }}>Tactical Flags</h2>
              <div style={{ ...styles.glassCard, display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                {flags.map(flag => (
                  <div key={flag.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'between' }}>
                    <div>
                      <p style={{ fontSize: '11px', fontWeight: 'bold', color: '#fff', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{flag.id.replace(/_/g, ' ')}</p>
                      <p style={{ fontSize: '9px', color: flag.is_active ? '#00f2ff' : 'rgba(255,255,255,0.2)', marginTop: '0.125rem' }}>{flag.is_active ? 'ENABLED' : 'OFFLINE'}</p>
                    </div>
                    <button 
                      onClick={() => toggleFlag(flag.id, flag.is_active)}
                      style={{ 
                        marginLeft: 'auto',
                        width: '2.5rem', 
                        height: '1.25rem', 
                        borderRadius: '999px', 
                        position: 'relative', 
                        transition: 'all 0.2s', 
                        cursor: 'pointer',
                        border: flag.is_active ? '1px solid #00f2ff' : '1px solid rgba(255,255,255,0.1)',
                        backgroundColor: flag.is_active ? 'rgba(0, 242, 255, 0.1)' : 'rgba(255,255,255,0.05)',
                        boxShadow: flag.is_active ? '0 0 10px rgba(0, 242, 255, 0.2)' : 'none'
                      }}
                    >
                      <div style={{ 
                        position: 'absolute', 
                        top: '2px', 
                        width: '0.875rem', 
                        height: '0.875rem', 
                        borderRadius: '50%', 
                        transition: 'all 0.2s', 
                        backgroundColor: flag.is_active ? '#00f2ff' : 'rgba(255,255,255,0.2)',
                        left: flag.is_active ? 'calc(100% - 1.125rem)' : '4px'
                      }} />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* DEBT MONITOR */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <h2 style={{ fontSize: '10px', fontWeight: 'bold', letterSpacing: '0.3em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', padding: '0 0.5rem' }}>Debt Watch</h2>
              <div style={{ ...styles.glassCard, display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {lockedDrivers.map(drv => (
                  <div key={drv.user_id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'between', padding: '0.75rem', borderRadius: '0.75rem', backgroundColor: 'rgba(239, 68, 68, 0.05)', border: '1px solid rgba(239, 68, 68, 0.1)' }}>
                    <div>
                      <p style={{ fontSize: '11px', fontWeight: 'bold', color: '#fff' }}>{drv.name}</p>
                      <p style={{ fontSize: '10px', color: '#f87171', fontWeight: 900, marginTop: '0.125rem', fontFamily: "'Orbitron', sans-serif" }}>${(Math.abs(drv.balance) / 100).toFixed(2)}</p>
                    </div>
                    <button 
                        onClick={() => settleDriverDebt(drv.user_id, drv.balance)} 
                        style={{ marginLeft: 'auto', backgroundColor: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', fontSize: '9px', fontWeight: 900, padding: '0.5rem', borderRadius: '0.5rem', cursor: 'pointer', color: '#fff' }}
                    >SETTLE</button>
                  </div>
                ))}
                {lockedDrivers.length === 0 && <p style={{ textAlign: 'center', padding: '1rem 0', fontSize: '10px', fontWeight: 'bold', color: 'rgba(255,255,255,0.2)', textTransform: 'uppercase', letterSpacing: '0.2em' }}>Clear Perimeter</p>}
              </div>
            </div>
          </div>
        </div>

        {/* PERSONNEL LOGISTICS (USERS) */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0 0.5rem' }}>
            <h2 style={{ fontSize: '10px', fontWeight: 'bold', letterSpacing: '0.3em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)' }}>Personnel Logistics</h2>
          </div>
          <div style={{ ...styles.glassCard, padding: 0, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', backgroundColor: 'rgba(255,255,255,0.02)' }}>
                    <th style={{ padding: '1rem', fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(255,255,255,0.3)' }}>Name</th>
                    <th style={{ padding: '1rem', fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(255,255,255,0.3)' }}>Contact</th>
                    <th style={{ padding: '1rem', fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(255,255,255,0.3)' }}>Role</th>
                    <th style={{ padding: '1rem', textAlign: 'right', fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(255,255,255,0.3)' }}>Perms</th>
                  </tr>
                </thead>
                <tbody>
                  {allUsers.map(user => (
                    <tr key={user.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                      <td style={{ padding: '1rem' }}>
                        <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#fff' }}>{user.name}</div>
                        <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace' }}>ID: {user.id.split('-')[0]}...</div>
                      </td>
                      <td style={{ padding: '1rem', fontSize: '11px', color: 'rgba(255,255,255,0.5)' }}>{user.email}</td>
                      <td style={{ padding: '1rem' }}>
                        <span style={{ fontSize: '9px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em', border: user.is_driver ? '1px solid #00f2ff' : '1px solid rgba(255,255,255,0.1)', padding: '0.125rem 0.5rem', borderRadius: '4px', color: user.is_driver ? '#00f2ff' : 'rgba(255,255,255,0.3)', backgroundColor: user.is_driver ? 'rgba(0, 242, 255, 0.05)' : 'transparent' }}>
                          {user.is_driver ? 'AUTHORIZED_DRIVER' : 'BASE_USER'}
                        </span>
                      </td>
                      <td style={{ padding: '1rem', textAlign: 'right' }}>
                         <button 
                           onClick={() => toggleDriverAuthorization(user)}
                           style={{ fontSize: '9px', fontWeight: 900, paddingLeft: '0.75rem', paddingRight: '0.75rem', paddingTop: '0.25rem', paddingBottom: '0.25rem', borderRadius: '4px', cursor: 'pointer', background: 'none', border: user.is_driver ? '1px solid rgba(239, 68, 68, 0.3)' : '1px solid rgba(0, 242, 255, 0.3)', color: user.is_driver ? '#f87171' : '#00f2ff' }}
                         >
                           {user.is_driver ? 'REVOKE' : 'AUTHORIZE'}
                         </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </main>

      {/* FOOTER STATUS BAR */}
      <footer style={{ position: 'fixed', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(10, 10, 12, 0.9)', backdropFilter: 'blur(12px)', borderTop: '1px solid rgba(255, 255, 255, 0.05)', padding: '0.5rem 2rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', zIndex: 100 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ fontSize: '9px', fontWeight: 800, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.1em' }}>G-TAXI CORE v1.0.4</div>
          <div style={{ width: '1px', height: '12px', background: 'rgba(255,255,255,0.1)' }} />
          <div style={{ fontSize: '9px', fontWeight: 800, color: '#00f2ff', letterSpacing: '0.1em' }}>SYS_READY</div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: flags.some(f => f.is_active) ? '#4ade80' : '#f87171' }} />
            <span style={{ fontSize: '8px', fontWeight: 900, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase' }}>Subsystems Active</span>
          </div>
        </div>
      </footer>
    </div>
  );
}


export default App;
