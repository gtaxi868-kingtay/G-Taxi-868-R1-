import { useEffect, useState } from 'react';
import { supabase, adminFetch } from './lib/supabase';
import Login from './pages/Login';
import { DriverMap } from './components/DriverMap';
import { LOGO_B64 } from './logoUrl';


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
  role: string;
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
  const [systemConfig, setSystemConfig] = useState<any>(null);
  const [lockedDrivers, setLockedDrivers] = useState<LockedDriver[]>([]);
  const [allUsers, setAllUsers] = useState<UserRow[]>([]);

  const runAuthCheck = async () => {
    setView('checking');
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setView('login'); return; }
    
    try {
      // Elevate to luxury administrative access
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
      const response = await adminFetch('admin_get_flags');
      const flagsData = Array.isArray(response) ? response : (response?.data || []);
      setFlags(flagsData);
      if (response?.config) setSystemConfig(response.config[0]);
    } catch (primaryErr: any) {
      // Fallback logic kept for feature flags
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

  const handleForceComplete = async (rideId: string) => {
    if (!window.confirm('FORCE COMPLETE this ride?')) return;
    try { await adminFetch('admin_force_complete', { ride_id: rideId }); fetchRides(); } catch (err: any) { alert(err.message); }
  };

  const handleAssignDriver = async (rideId: string) => {
    const driverId = window.prompt('Enter Driver UUID to Assign:');
    if (!driverId) return;
    try { await adminFetch('admin_assign_driver', { ride_id: rideId, driver_id: driverId }); fetchRides(); } catch (err: any) { alert(err.message); }
  };

  const handleRefund = async (rideId: string) => {
    const reason = window.prompt('Reason for Refund (Optional):', 'Admin Override');
    if (reason === null) return;
    try { await adminFetch('admin_refund', { ride_id: rideId, reason }); fetchRides(); } catch (err: any) { alert(err.message); }
  };

  const handleSuspendRider = async (user_id: string, currentStatus: boolean | undefined) => {
    const nextStatus = !currentStatus;
    if (!window.confirm(`${nextStatus ? 'SUSPEND' : 'REACTIVATE'} this rider?`)) return;
    try { await adminFetch('admin_suspend_rider', { rider_id: user_id, suspend: nextStatus }); alert('Rider ' + (nextStatus ? 'Suspended' : 'Reactivated')); fetchAdminData(); } catch (err: any) { alert(err.message); }
  };

  const handleAdjustWallet = async (user_id: string) => {
    const amountStr = window.prompt('Enter Adjustment Amount (e.g. 50.00 or -20.00):');
    if (!amountStr) return;
    const amountCents = Math.round(parseFloat(amountStr) * 100);
    if (isNaN(amountCents)) return alert('Invalid amount format.');
    const reason = window.prompt('Reason for Adjustment:');
    if (!reason) return;
    try { 
        // Direct RPC call because adjusting wallet isn't wrapped in a generic edge function
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/rpc/admin_wallet_adjust`, {
            method: 'POST',
            headers: { 
                'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY, 
                'Authorization': `Bearer ${session?.access_token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ p_user_id: user_id, p_amount_cents: amountCents, p_reason: reason, p_admin_id: session?.user?.id })
        });
        if (!res.ok) { const rb = await res.json(); throw new Error(rb.message || 'Error executing RPC');}
        alert('Wallet Adjusted Successfully.'); 
        fetchAdminData();
    } catch (err: any) { alert(err.message); }
  };

  const toggleMaintenance = async () => {
    const current = systemConfig?.maintenance_mode === 'true';
    if (!window.confirm(`TURN ${current ? 'OFF' : 'ON'} MAINTENANCE MODE? This will block ${current ? 'nothing' : 'EVERYONE'}.`)) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      await fetch(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/system_config?id=eq.global`, {
        method: 'PATCH',
        headers: { 
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY, 
            'Authorization': `Bearer ${session?.access_token}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
        },
        body: JSON.stringify({ maintenance_mode: current ? 'false' : 'true' })
      });
      fetchAdminData();
    } catch (err: any) { alert(err.message); }
  };

  const updateMinVersion = async (type: 'rider' | 'driver') => {
    const current = type === 'rider' ? systemConfig?.min_version_rider : systemConfig?.min_version_driver;
    const next = window.prompt(`Update Minimum ${type.toUpperCase()} Version (Current: ${current})`, current);
    if (!next) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const payload = type === 'rider' ? { min_version_rider: next } : { min_version_driver: next };
      await fetch(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/system_config?id=eq.global`, {
        method: 'PATCH',
        headers: { 
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY, 
            'Authorization': `Bearer ${session?.access_token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
      fetchAdminData();
    } catch (err: any) { alert(err.message); }
  };

  if (view === 'checking') return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a0c]">
      <div className="w-12 h-12 border-4 border-cyan-400 border-t-transparent rounded-full animate-spin shadow-[0_0_15px_rgba(0,242,255,0.4)]" />
    </div>
  );

  if (view === 'login') return <Login onLoginSuccess={runAuthCheck} />;

  // RESILIENT STYLE OBJECTS (Premium Overhaul)
  const styles = {
    header: {
        background: 'rgba(7, 5, 15, 0.8)',
        backdropFilter: 'blur(32px)',
        borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
        position: 'sticky' as const,
        top: 0,
        zIndex: 50,
        padding: '1.25rem 2.5rem'
    },
    neonText: {
        fontFamily: "'Orbitron', sans-serif",
        color: '#A78BFA',
        textShadow: '0 0 15px rgba(167, 139, 250, 0.3)',
        letterSpacing: '0.05em',
        fontWeight: 900
    },
    glassCard: {
        background: 'rgba(255, 255, 255, 0.03)',
        backdropFilter: 'blur(40px)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: '2rem',
        padding: '2rem',
        boxShadow: '0 20px 40px rgba(0, 0, 0, 0.4)'
    },
    tag: {
        fontSize: '9px',
        fontWeight: 'bold',
        textTransform: 'uppercase' as const,
        letterSpacing: '0.2em',
        padding: '0.375rem 0.875rem',
        borderRadius: '999px',
        border: '1px solid rgba(167, 139, 250, 0.2)',
        background: 'rgba(167, 139, 250, 0.05)',
        color: '#A78BFA'
    }
  };

  const toggleAdminRole = async (user: UserRow) => {
    const newRole = user.role === 'admin' ? 'rider' : 'admin';
    if (!window.confirm(`Change ${user.name}'s role to ${newRole.toUpperCase()}?`)) return;
    try { 
      await adminFetch('admin_toggle_role', { target_user_id: user.id, new_role: newRole }); 
      alert(`Access Level Updated: ${newRole.toUpperCase()}`); 
      fetchAdminData(); 
    } catch (err: any) { alert(err.message); }
  };

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#07050f', color: '#f8fafc', paddingBottom: '6rem' }}>
      {/* Background Glows */}
      <div style={{ position: 'fixed', top: '5%', left: '5%', width: '30vw', height: '30vw', background: 'radial-gradient(circle, rgba(167, 139, 250, 0.05) 0%, transparent 70%)', filter: 'blur(100px)', pointerEvents: 'none' }} />
      <div style={{ position: 'fixed', bottom: '5%', right: '5%', width: '30vw', height: '30vw', background: 'radial-gradient(circle, rgba(125, 211, 252, 0.05) 0%, transparent 70%)', filter: 'blur(100px)', pointerEvents: 'none' }} />

      <header style={styles.header}>
        <div style={{ maxWidth: '90rem', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
            <img 
                src={LOGO_B64} 
                alt="Logo" 
                style={{ 
                    height: '45px', 
                    minWidth: '45px',
                    width: 'auto', 
                    display: 'block', 
                    objectFit: 'contain',
                    filter: 'drop-shadow(0 0 10px rgba(167, 139, 250, 0.3))' 
                }} 
            />
            <h1 style={styles.neonText} className="font-orbitron">
              G-TAXI<span style={{ color: '#fff' }}> 868</span>
            </h1>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '2rem' }}>
             <div style={styles.tag} className="font-orbitron">Elite Operations // Secure</div>
             <button 
                onClick={() => supabase.auth.signOut().then(() => setView('login'))} 
                style={{ fontSize: '10px', fontWeight: 900, color: 'rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', padding: '0.6rem 1.2rem', borderRadius: '1rem', cursor: 'pointer', transition: 'all 0.2s', textTransform: 'uppercase', letterSpacing: '0.1em' }}
                onMouseOver={(e) => { e.currentTarget.style.color = '#f87171'; e.currentTarget.style.borderColor = 'rgba(248, 113, 113, 0.3)'; }}
                onMouseOut={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.4)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; }}
             >
               Terminate Session
             </button>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: '90rem', margin: '0 auto', padding: '3rem 2rem', display: 'flex', flexDirection: 'column', gap: '3rem' }}>
        {/* GEOLOCATION HUB */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0 0.5rem' }}>
            <div style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#A78BFA', boxShadow: '0 0 15px #A78BFA' }} />
            <h2 style={{ fontSize: '11px', fontWeight: 900, letterSpacing: '0.4em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', fontFamily: "'Orbitron', sans-serif" }}>Geospatial Fleet Relay</h2>
          </div>
          <div style={{ ...styles.glassCard, padding: '0.75rem', overflow: 'hidden' }}>
            <DriverMap />
          </div>
        </section>

        {/* DATA MONITOR */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: '2.5rem' }}>
          
          {/* RIDE STREAM */}
          <div style={{ gridColumn: 'span 8', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 0.5rem' }}>
              <h2 style={{ fontSize: '11px', fontWeight: 900, letterSpacing: '0.4em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', fontFamily: "'Orbitron', sans-serif" }}>Real-time Operations Monitor</h2>
              <button 
                onClick={fetchRides} 
                style={{ fontSize: '10px', fontWeight: 900, color: '#7DD3FC', background: 'none', border: 'none', cursor: 'pointer', letterSpacing: '0.15em', fontFamily: "'Orbitron', sans-serif" }}
              >SYNC_DATA</button>
            </div>
            
            <div style={{ ...styles.glassCard, padding: 0, overflow: 'hidden' }}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', backgroundColor: 'rgba(255,255,255,0.02)' }}>
                      <th style={{ padding: '1.5rem 1rem', fontSize: '10px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', fontFamily: "'Orbitron', sans-serif" }}>Timestamp</th>
                      <th style={{ padding: '1.5rem 1rem', fontSize: '10px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', fontFamily: "'Orbitron', sans-serif" }}>Status</th>
                      <th style={{ padding: '1.5rem 1rem', fontSize: '10px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', fontFamily: "'Orbitron', sans-serif" }}>Route Execution</th>
                      <th style={{ padding: '1.5rem 1rem', fontSize: '10px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', fontFamily: "'Orbitron', sans-serif" }}>Fare</th>
                      <th style={{ padding: '1.5rem 1rem', textAlign: 'right', fontSize: '10px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', fontFamily: "'Orbitron', sans-serif" }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rides.map(ride => {
                      const color = 
                        ride.status === 'completed' ? '#4ade80' :
                        ride.status === 'cancelled' ? '#f87171' :
                        ride.status === 'in_progress' ? '#7DD3FC' : '#fbbf24';
                      
                      return (
                        <tr key={ride.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)', transition: 'background-color 0.2s' }}>
                          <td style={{ padding: '1.25rem 1rem', fontSize: '11px', fontWeight: 600, color: 'rgba(255,255,255,0.4)', fontFamily: "'Orbitron', sans-serif" }}>
                            {new Date(ride.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                          </td>
                          <td style={{ padding: '1.25rem 1rem' }}>
                            <span style={{ fontSize: '9px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.15em', border: `1px solid ${color}4d`, padding: '0.25rem 0.6rem', borderRadius: '6px', color: color, backgroundColor: `${color}1A` }}>
                              {ride.status}
                            </span>
                          </td>
                          <td style={{ padding: '1.25rem 1rem' }}>
                            <div style={{ maxWidth: '240px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: '12px', fontWeight: 600, color: 'rgba(255,255,255,0.8)' }}>{ride.pickup_address}</div>
                            <div style={{ maxWidth: '240px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: '10px', color: 'rgba(255,255,255,0.3)', marginTop: '0.25rem' }}>{ride.dropoff_address}</div>
                          </td>
                          <td style={{ padding: '1.25rem 1rem', fontSize: '12px', fontWeight: 800, color: '#fff', fontFamily: "'Orbitron', sans-serif" }}>${(ride.total_fare_cents / 100).toFixed(2)}</td>
                          <td style={{ padding: '1.25rem 1rem', textAlign: 'right' }}>
                             {ride.status === 'searching' && (
                                <button 
                                 onClick={() => handleAssignDriver(ride.id)} 
                                 style={{ marginRight: '0.5rem', fontSize: '9px', fontWeight: 900, color: '#A78BFA', border: '1px solid rgba(167, 139, 250, 0.2)', padding: '0.5rem 1rem', borderRadius: '0.75rem', cursor: 'pointer', background: 'rgba(167, 139, 250, 0.05)', textTransform: 'uppercase', letterSpacing: '0.1em' }}
                                >Assign</button>
                             )}
                             {['assigned', 'arrived', 'in_progress'].includes(ride.status) && (
                                <button 
                                 onClick={() => handleForceComplete(ride.id)} 
                                 style={{ marginRight: '0.5rem', fontSize: '9px', fontWeight: 900, color: '#4ade80', border: '1px solid rgba(74, 222, 128, 0.2)', padding: '0.5rem 1rem', borderRadius: '0.75rem', cursor: 'pointer', background: 'rgba(74, 222, 128, 0.05)', textTransform: 'uppercase', letterSpacing: '0.1em' }}
                                >Complete</button>
                             )}
                             {['completed', 'cancelled'].includes(ride.status) && (
                                <button 
                                 onClick={() => handleRefund(ride.id)} 
                                 style={{ marginRight: '0.5rem', fontSize: '9px', fontWeight: 900, color: '#fbbf24', border: '1px solid rgba(251, 191, 36, 0.2)', padding: '0.5rem 1rem', borderRadius: '0.75rem', cursor: 'pointer', background: 'rgba(251, 191, 36, 0.05)', textTransform: 'uppercase', letterSpacing: '0.1em' }}
                                >Refund</button>
                             )}
                             {!['completed', 'cancelled'].includes(ride.status) && (
                                <button 
                                 onClick={() => handleForceCancel(ride.id)} 
                                 style={{ fontSize: '9px', fontWeight: 900, color: '#f87171', border: '1px solid rgba(248, 113, 113, 0.2)', padding: '0.5rem 1rem', borderRadius: '0.75rem', cursor: 'pointer', background: 'rgba(248, 113, 113, 0.05)', textTransform: 'uppercase', letterSpacing: '0.1em' }}
                                 onMouseOver={(e) => { e.currentTarget.style.background = 'rgba(248, 113, 113, 0.15)'; }}
                                 onMouseOut={(e) => { e.currentTarget.style.background = 'rgba(248, 113, 113, 0.05)'; }}
                                >Cancel</button>
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

          {/* SIDEBAR ELITE PANEL */}
          <div style={{ gridColumn: 'span 4', display: 'flex', flexDirection: 'column', gap: '2.5rem' }}>
            {/* FEATURE FLAGS */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <h2 style={{ fontSize: '11px', fontWeight: 900, letterSpacing: '0.4em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', padding: '0 0.5rem', fontFamily: "'Orbitron', sans-serif" }}>Premium Flags</h2>
              <div style={{ ...styles.glassCard, display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                {flags.map(flag => (
                  <div key={flag.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <p style={{ fontSize: '11px', fontWeight: 800, color: '#fff', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{flag.id.replace(/_/g, ' ')}</p>
                      <p style={{ fontSize: '9px', fontWeight: 700, color: flag.is_active ? '#7DD3FC' : 'rgba(255,255,255,0.15)', marginTop: '0.25rem' }}>{flag.is_active ? 'ENABLED' : 'OFFLINE'}</p>
                    </div>
                    <button 
                      onClick={() => toggleFlag(flag.id, flag.is_active)}
                      style={{ 
                        marginLeft: 'auto',
                        width: '2.75rem', 
                        height: '1.4rem', 
                        borderRadius: '1rem', 
                        position: 'relative', 
                        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)', 
                        cursor: 'pointer',
                        border: flag.is_active ? '1px solid #7DD3FC' : '1px solid rgba(255,255,255,0.1)',
                        backgroundColor: flag.is_active ? 'rgba(125, 211, 252, 0.1)' : 'rgba(255,255,255,0.05)',
                        boxShadow: flag.is_active ? '0 0 15px rgba(125, 211, 252, 0.2)' : 'none'
                      }}
                    >
                      <div style={{ 
                        position: 'absolute', 
                        top: '2px', 
                        width: '1rem', 
                        height: '1rem', 
                        borderRadius: '50%', 
                        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)', 
                        backgroundColor: flag.is_active ? '#7DD3FC' : 'rgba(255,255,255,0.2)',
                        left: flag.is_active ? 'calc(100% - 1.25rem)' : '3px'
                      }} />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* DEBT MONITOR */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <h2 style={{ fontSize: '11px', fontWeight: 900, letterSpacing: '0.4em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', padding: '0 0.5rem', fontFamily: "'Orbitron', sans-serif" }}>Debt Watch</h2>
              <div style={{ ...styles.glassCard, display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                {lockedDrivers.map(drv => (
                  <div key={drv.user_id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem', borderRadius: '1.25rem', backgroundColor: 'rgba(248, 113, 113, 0.05)', border: '1px solid rgba(248, 113, 113, 0.1)' }}>
                    <div>
                      <p style={{ fontSize: '12px', fontWeight: 700, color: '#fff' }}>{drv.name}</p>
                      <p style={{ fontSize: '10px', color: '#f87171', fontWeight: 900, marginTop: '0.25rem', fontFamily: "'Orbitron', sans-serif" }}>${(Math.abs(drv.balance) / 100).toFixed(2)}</p>
                    </div>
                    <button 
                        onClick={() => settleDriverDebt(drv.user_id, drv.balance)} 
                        style={{ marginLeft: 'auto', backgroundColor: '#fff', color: '#000', border: 'none', fontSize: '9px', fontWeight: 900, padding: '0.5rem 0.8rem', borderRadius: '0.75rem', cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.05em' }}
                    >Release</button>
                  </div>
                ))}
                {lockedDrivers.length === 0 && <p style={{ textAlign: 'center', padding: '1.5rem 0', fontSize: '11px', fontWeight: 900, color: 'rgba(255,255,255,0.1)', textTransform: 'uppercase', letterSpacing: '0.5em', fontFamily: "'Orbitron', sans-serif" }}>Secure</p>}
              </div>
            </div>

            {/* SYSTEM CONTROLS (Fix 12) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <h2 style={{ fontSize: '11px', fontWeight: 900, letterSpacing: '0.4em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', padding: '0 0.5rem', fontFamily: "'Orbitron', sans-serif" }}>Kill Switch / Fleet</h2>
              <div style={{ ...styles.glassCard, display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                        <p style={{ fontSize: '11px', fontWeight: 800, color: '#fff' }}>MAINTENANCE_MODE</p>
                        <p style={{ fontSize: '9px', fontWeight: 700, color: systemConfig?.maintenance_mode === 'true' ? '#f87171' : 'rgba(255,255,255,0.15)', marginTop: '0.25rem' }}>{systemConfig?.maintenance_mode === 'true' ? 'LOCKDOWN ACTIVE' : 'SYSTEM ONLINE'}</p>
                    </div>
                    <button 
                        onClick={toggleMaintenance}
                        style={{ 
                            width: '2.75rem', 
                            height: '1.4rem', 
                            borderRadius: '1rem', 
                            position: 'relative', 
                            cursor: 'pointer',
                            border: systemConfig?.maintenance_mode === 'true' ? '1px solid #f87171' : '1px solid rgba(255,255,255,0.1)',
                            backgroundColor: systemConfig?.maintenance_mode === 'true' ? 'rgba(248, 113, 113, 0.1)' : 'rgba(255,255,255,0.05)',
                        }}
                    >
                        <div style={{ 
                            position: 'absolute', 
                            top: '2px', 
                            width: '1rem', 
                            height: '1rem', 
                            borderRadius: '50%', 
                            backgroundColor: systemConfig?.maintenance_mode === 'true' ? '#f87171' : 'rgba(255,255,255,0.2)',
                            left: systemConfig?.maintenance_mode === 'true' ? 'calc(100% - 1.25rem)' : '3px',
                            transition: 'left 0.2s'
                        }} />
                    </button>
                </div>

                <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <p style={{ fontSize: '10px', fontWeight: 700, color: 'rgba(255,255,255,0.4)' }}>RIDER_MIN_V</p>
                        <button onClick={() => updateMinVersion('rider')} style={{ fontSize: '10px', color: '#A78BFA', background: 'none', border: 'none', cursor: 'pointer' }}>v{systemConfig?.min_version_rider || '1.0.0'}</button>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <p style={{ fontSize: '10px', fontWeight: 700, color: 'rgba(255,255,255,0.4)' }}>DRIVER_MIN_V</p>
                        <button onClick={() => updateMinVersion('driver')} style={{ fontSize: '10px', color: '#A78BFA', background: 'none', border: 'none', cursor: 'pointer' }}>v{systemConfig?.min_version_driver || '1.0.0'}</button>
                    </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* PERSONNEL LOGISTICS (USERS) */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0 0.5rem' }}>
            <div style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#7DD3FC', boxShadow: '0 0 15px #7DD3FC' }} />
            <h2 style={{ fontSize: '11px', fontWeight: 900, letterSpacing: '0.4em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', fontFamily: "'Orbitron', sans-serif" }}>Personnel & Access Management</h2>
          </div>
          <div style={{ ...styles.glassCard, padding: 0, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', backgroundColor: 'rgba(255,255,255,0.02)' }}>
                    <th style={{ padding: '1.5rem 1rem', fontSize: '10px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', fontFamily: "'Orbitron', sans-serif" }}>Operator Name</th>
                    <th style={{ padding: '1.5rem 1rem', fontSize: '10px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', fontFamily: "'Orbitron', sans-serif" }}>Secure ID / Contact</th>
                    <th style={{ padding: '1.5rem 1rem', fontSize: '10px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', fontFamily: "'Orbitron', sans-serif" }}>Platform Role</th>
                    <th style={{ padding: '1.5rem 1rem', textAlign: 'right', fontSize: '10px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', fontFamily: "'Orbitron', sans-serif" }}>Level Controls</th>
                  </tr>
                </thead>
                <tbody>
                  {allUsers.map(user => (
                    <tr key={user.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                      <td style={{ padding: '1.5rem 1rem' }}>
                        <div style={{ fontSize: '13px', fontWeight: 800, color: '#fff' }}>{user.name}</div>
                        <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.2)', fontFamily: 'monospace', marginTop: '0.25rem' }}>{user.id}</div>
                      </td>
                      <td style={{ padding: '1.5rem 1rem', fontSize: '12px', color: 'rgba(255,255,255,0.4)', fontWeight: 500 }}>{user.email}</td>
                      <td style={{ padding: '1.5rem 1rem' }}>
                        <div style={{ display: 'flex', gap: '0.75rem' }}>
                            <span style={{ fontSize: '9px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em', border: user.is_driver ? '1px solid #7DD3FC' : '1px solid rgba(255,255,255,0.08)', padding: '0.25rem 0.6rem', borderRadius: '6px', color: user.is_driver ? '#7DD3FC' : 'rgba(255,255,255,0.2)', backgroundColor: user.is_driver ? 'rgba(125, 211, 252, 0.05)' : 'transparent' }}>
                            {user.is_driver ? 'DRIVER' : 'RIDER'}
                            </span>
                            <span style={{ fontSize: '9px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em', border: user.role === 'admin' ? '1px solid #A78BFA' : '1px solid rgba(255,255,255,0.08)', padding: '0.25rem 0.6rem', borderRadius: '6px', color: user.role === 'admin' ? '#A78BFA' : 'rgba(255,255,255,0.2)', backgroundColor: user.role === 'admin' ? 'rgba(167, 139, 250, 0.05)' : 'transparent' }}>
                            {user.role === 'admin' ? 'OPERATOR' : 'USER'}
                            </span>
                        </div>
                      </td>
                      <td style={{ padding: '1.5rem 1rem', textAlign: 'right' }}>
                          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                            <button 
                                onClick={() => handleAdjustWallet(user.id)}
                                style={{ fontSize: '9px', fontWeight: 900, padding: '0.5rem 1rem', borderRadius: '0.75rem', cursor: 'pointer', background: 'none', border: '1px solid rgba(251, 191, 36, 0.2)', color: '#fbbf24', textTransform: 'uppercase' }}
                            >
                                Adj. Wallet
                            </button>
                            {!user.is_driver && (
                                <button 
                                    onClick={() => handleSuspendRider(user.id, (user as any).suspended)}
                                    style={{ fontSize: '9px', fontWeight: 900, padding: '0.5rem 1rem', borderRadius: '0.75rem', cursor: 'pointer', background: 'none', border: '1px solid rgba(248, 113, 113, 0.2)', color: '#f87171', textTransform: 'uppercase' }}
                                >
                                    {(user as any).suspended ? 'Unsuspend' : 'Suspend'}
                                </button>
                            )}
                            <button 
                                onClick={() => toggleDriverAuthorization(user)}
                                style={{ fontSize: '9px', fontWeight: 900, padding: '0.5rem 1rem', borderRadius: '0.75rem', cursor: 'pointer', background: 'none', border: user.is_driver ? '1px solid rgba(248, 113, 113, 0.2)' : '1px solid rgba(125, 211, 252, 0.2)', color: user.is_driver ? '#f87171' : '#7DD3FC', textTransform: 'uppercase' }}
                            >
                                {user.is_driver ? 'Deauth Driver' : 'Auth Driver'}
                            </button>
                            <button 
                                onClick={() => toggleAdminRole(user)}
                                style={{ fontSize: '9px', fontWeight: 900, padding: '0.5rem 1rem', borderRadius: '0.75rem', cursor: 'pointer', background: 'none', border: user.role === 'admin' ? '1px solid rgba(248, 113, 113, 0.2)' : '1px solid rgba(167, 139, 250, 0.2)', color: user.role === 'admin' ? '#f87171' : '#A78BFA', textTransform: 'uppercase' }}
                            >
                                {user.role === 'admin' ? 'Revoke Ops' : 'Grant Ops'}
                            </button>
                          </div>
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
      <footer style={{ position: 'fixed', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(7, 5, 15, 0.95)', backdropFilter: 'blur(32px)', borderTop: '1px solid rgba(255, 255, 255, 0.08)', padding: '0.75rem 2.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', zIndex: 100 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
          <div style={{ fontSize: '9px', fontWeight: 900, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.2em', fontFamily: "'Orbitron', sans-serif" }}>G-TAXI ELITE SUITE v1.1.0</div>
          <div style={{ width: '1px', height: '14px', background: 'rgba(255,255,255,0.1)' }} />
          <div style={{ fontSize: '9px', fontWeight: 900, color: '#A78BFA', letterSpacing: '0.2em', fontFamily: "'Orbitron', sans-serif" }}>OPERATIONS_ELITE</div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: flags.some(f => f.is_active) ? '#4ade80' : '#64748b' }} />
            <span style={{ fontSize: '9px', fontWeight: 900, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Aux Units Active</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
