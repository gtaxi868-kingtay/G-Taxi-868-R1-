import { useEffect, useState } from 'react';
import { supabase, adminFetch } from './lib/supabase';
import Login from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { FleetManager } from './pages/FleetManager';
import { Financials } from './pages/Financials';
import { LOGO_B64 } from './logoUrl';
import { LayoutDashboard, Users, CreditCard, LogOut, ShieldCheck, Activity } from 'lucide-react';

type AdminView = 'dashboard' | 'fleet' | 'financials';

function App() {
  const [view, setView] = useState<'checking' | 'login' | 'app'>('checking');
  const [activeTab, setActiveTab] = useState<AdminView>('dashboard');

  // --- GLOBAL DATA STATE ---
  const [rides, setRides] = useState<any[]>([]);
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);

  const runAuthCheck = async () => {
    setView('checking');
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setView('login'); return; }
    try {
      await adminFetch('admin_get_rides');
      setView('app');
    } catch (err) {
      await supabase.auth.signOut();
      setView('login');
    }
  };

  const fetchData = async () => {
    try {
      const { data: rideData } = await adminFetch('admin_get_rides');
      setRides(rideData || []);
      
      const { users } = await adminFetch('admin_get_users');
      setAllUsers(users || []);

      const { data: orderData } = await supabase.from('orders').select('*, rider:rider_id(name)').order('created_at', { ascending: false });
      setOrders(orderData || []);
    } catch (err) {
      console.error('Data Sync Error:', err);
    }
  };

  useEffect(() => {
    runAuthCheck();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) setView('login');
      else if (view === 'login') runAuthCheck();
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (view !== 'app') return;
    fetchData();
    const channel = supabase.channel('admin-sync').on('postgres_changes', { event: '*', schema: 'public', table: 'rides' }, fetchData).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [view]);

  if (view === 'checking') return (
    <div className="min-h-screen flex items-center justify-center bg-[#07050f]">
      <div className="w-12 h-12 border-4 border-cyan-400 border-t-transparent rounded-full animate-spin shadow-[0_0_20px_rgba(0,242,255,0.4)]" />
    </div>
  );

  if (view === 'login') return <Login onLoginSuccess={runAuthCheck} />;

  return (
    <div className="min-h-screen bg-[#07050f] text-slate-100 flex font-sans selection:bg-cyan-500/20">
      {/* SIDEBAR NAVIGATION */}
      <aside className="w-80 border-r border-white/5 bg-black/20 backdrop-blur-3xl flex flex-col p-8 sticky top-0 h-screen">
          <div className="flex items-center gap-4 mb-12">
              <img src={LOGO_B64} alt="G-Taxi" className="h-10 w-auto filter drop-shadow-[0_0_10px_rgba(167,139,250,0.5)]" />
              <div>
                  <h1 className="font-orbitron font-black text-lg tracking-wider text-white">G-TAXI<span className="text-cyan-400"> 868</span></h1>
                  <p className="text-[9px] font-black text-white/20 uppercase tracking-[0.3em]">Command Center</p>
              </div>
          </div>

          <nav className="flex-1 space-y-2">
              <NavItem active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} icon={<LayoutDashboard size={20}/>} label="God View Telemetry" />
              <NavItem active={activeTab === 'fleet'} onClick={() => setActiveTab('fleet')} icon={<Users size={20}/>} label="Fleet & Personnel" />
              <NavItem active={activeTab === 'financials'} onClick={() => setActiveTab('financials')} icon={<CreditCard size={20}/>} label="Financial Index" />
          </nav>

          <div className="pt-8 mt-8 border-t border-white/5">
             <div className="bg-white/5 rounded-2xl p-6 border border-white/5">
                <div className="flex items-center gap-3 mb-4">
                   <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                   <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">Nodes Online</span>
                </div>
                <p className="text-[11px] font-bold text-white/60 leading-relaxed uppercase">Platform Health: Secure</p>
             </div>
             <button 
                onClick={() => supabase.auth.signOut()}
                className="w-full mt-6 h-12 flex items-center justify-center gap-3 rounded-xl border border-red-500/20 text-red-400 font-black text-xs uppercase tracking-widest hover:bg-red-500/10 transition-all"
             >
                <LogOut size={16} />
                Term. Session
             </button>
          </div>
      </aside>

      {/* MAIN CONTENT AREA */}
      <main className="flex-1 overflow-y-auto p-12">
          <header className="flex justify-between items-center mb-12">
              <div>
                  <h2 className="text-3xl font-black text-white italic tracking-tight">{activeTab.toUpperCase()}</h2>
                  <p className="text-xs font-medium text-white/20 uppercase tracking-[0.4em] mt-1">G-Taxi Logistics Layer // Node_868</p>
              </div>
              <div className="flex items-center gap-4">
                  <div className="px-4 py-2 bg-white/5 border border-white/10 rounded-full flex items-center gap-3">
                      <ShieldCheck size={14} className="text-cyan-400" />
                      <span className="text-[10px] font-black uppercase text-white/40 tracking-widest">Admin Authorization: Granted</span>
                  </div>
              </div>
          </header>

          <div className="max-w-7xl">
              {activeTab === 'dashboard' && <Dashboard rides={rides} />}
              {activeTab === 'fleet' && <FleetManager rides={rides} allUsers={allUsers} orders={orders} onRefresh={fetchData} />}
              {activeTab === 'financials' && <Financials />}
          </div>
      </main>

      {/* FOOTER STATUS BAR */}
      <footer className="fixed bottom-0 left-80 right-0 h-10 bg-black/40 backdrop-blur-xl border-t border-white/5 px-10 flex items-center justify-between z-50">
          <div className="flex items-center gap-6">
              <span className="text-[9px] font-black text-white/20 uppercase tracking-[0.3em]">Build V1.7.0</span>
              <div className="w-1 h-1 bg-white/10 rounded-full" />
              <span className="text-[9px] font-black text-cyan-400/60 uppercase tracking-[0.3em]">Quantum Encrypted</span>
          </div>
          <div className="flex items-center gap-2">
              <Activity size={10} className="text-cyan-400" />
              <span className="text-[9px] font-black text-white/40 uppercase tracking-[0.3em]">Live Stream Active</span>
          </div>
      </footer>
    </div>
  );
}

const NavItem = ({ active, onClick, icon, label }: any) => (
  <button 
    onClick={onClick}
    className={`w-full h-14 px-6 flex items-center gap-4 rounded-xl transition-all ${active ? 'bg-white text-black shadow-2xl' : 'text-white/40 hover:bg-white/5 hover:text-white'}`}
  >
    <div className={active ? 'text-black' : 'text-white/20'}>{icon}</div>
    <span className="text-xs font-black uppercase tracking-widest">{label}</span>
  </button>
);

export default App;
 App;
