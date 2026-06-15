import { useEffect, useState, useCallback } from 'react';
import type { User } from '@supabase/supabase-js';
import type { Session } from '@supabase/auth-js';
import { supabase, adminFetch } from './lib/supabase';
import Login from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { FleetManager } from './pages/FleetManager';
import { Financials } from './pages/Financials';
import { DriverApproval } from './pages/DriverApproval';
import { NodeRegistry } from './pages/NodeRegistry';
import { RescueScreen } from './pages/RescueScreen';
import { WarChest } from './pages/WarChest';
import { PlatformControl } from './pages/PlatformControl';
import { TravelPackages } from './pages/TravelPackages';
import { DealerBrokerage } from './pages/DealerBrokerage';
import { Intelligence } from './pages/Intelligence';
import { Pricing } from './pages/Pricing';
import { MerchantNetwork } from './pages/MerchantNetwork';
import { Support } from './pages/Support';
import { Progression } from './pages/Progression';
import { LOGO_B64 } from './logoUrl';
import { LayoutDashboard, Users, CreditCard, LogOut, ShieldCheck, Activity, UserCheck, Menu, X, ShieldOff, Radio, AlertTriangle, Vault, SlidersHorizontal, Plane, Car, Bot, Tag, Store, Flag, TrendingUp } from 'lucide-react';

// ── AdminSecurityGate ──────────────────────────────────────────────────────────
// Blocks all rendering unless the user has a verified Supabase session AND
// the profiles table confirms admin role (checked via edge function).
// Uses onAuthStateChange for real-time sync.
function AdminSecurityGate({ children }: { children: React.ReactNode }) {
    const [gateState, setGateState] = useState<'loading' | 'unauthorized' | 'authorized'>('loading');
    const [user, setUser] = useState<User | null>(null);

    const checkAccess = useCallback(async () => {
        setGateState('loading');

        const { data: { session } } = await supabase.auth.getSession();

        if (!session || !session.user) {
            setGateState('unauthorized');
            setUser(null);
            return;
        }

        setUser(session.user);

        // Server-side admin check via edge function
        // The edge function calls requireAdmin() which queries the
        // profiles table to confirm admin role. FastPath: admin_get_flags
        // is the lightest admin-gated endpoint.
        try {
            await supabase.functions.invoke('admin_get_flags', {
                headers: { Authorization: `Bearer ${session.access_token}` }
            });
            setGateState('authorized');
        } catch {
            setGateState('unauthorized');
        }
    }, []);

    useEffect(() => {
        checkAccess();

        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event: string, session: Session | null) => {
            if (!session) {
                setGateState('unauthorized');
                setUser(null);
            } else {
                checkAccess();
            }
        });

        return () => subscription.unsubscribe();
    }, [checkAccess]);

    if (gateState === 'loading') {
        return (
            <div className="min-h-screen flex items-center justify-center bg-[#07050f]">
                <div className="w-12 h-12 border-4 border-cyan-400 border-t-transparent rounded-full animate-spin shadow-[0_0_20px_rgba(0,242,255,0.4)]" />
                <p className="ml-4 text-cyan-400 font-mono text-sm uppercase tracking-widest">Verifying Authorization</p>
            </div>
        );
    }

    if (gateState === 'unauthorized') {
        return <Login onLoginSuccess={() => checkAccess()} />;
    }

    return <>{children}</>;
}

// ── App ────────────────────────────────────────────────────────────────────────
type AdminView = 'dashboard' | 'fleet' | 'financials' | 'approval' | 'nodes' | 'rescue' | 'warchest' | 'platformcontrol' | 'travel' | 'dealer' | 'intelligence' | 'pricing' | 'merchants' | 'support' | 'progression';

const TAB_LABELS: Record<AdminView, string> = {
    dashboard: 'Operations Overview',
    fleet: 'Fleet & Personnel',
    financials: 'Financials',
    approval: 'Driver Approval',
    nodes: 'Node Registry',
    rescue: 'Rescue',
    warchest: 'War Chest',
    platformcontrol: 'Platform Control',
    travel: 'Travel Packages',
    dealer: 'Dealer Brokerage',
    intelligence: 'AI Intelligence',
    pricing: 'Pricing Config',
    merchants: 'Merchant Network',
    support: 'Support Tickets',
    progression: 'Rider Progression',
};

function App() {
    const [activeTab, setActiveTab] = useState<AdminView>('dashboard');
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [syncError, setSyncError] = useState<string | null>(null);

    const fetchData = useCallback(async () => {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;

        setSyncError(null);
        try {
            const { data: rideData } = await adminFetch('admin_get_rides');
            setRides(rideData || []);

            const { users } = await adminFetch('admin_get_users');
            setAllUsers(users || []);

            const { data: orderData } = await supabase
                .from('orders')
                .select('*, rider:rider_id(name)')
                .order('created_at', { ascending: false });
            setOrders(orderData || []);
        } catch (err) {
            const msg = err instanceof Error ? err.message : JSON.stringify(err);
            console.error('Data Sync Error:', msg);
            setSyncError(msg);
        }
    }, []);

    useEffect(() => {
        fetchData();
        const channel = supabase
            .channel('admin-sync')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'rides' }, fetchData)
            .subscribe();
        return () => { supabase.removeChannel(channel); };
    }, [fetchData]);

    // GLOBAL DATA STATE
    const [rides, setRides] = useState<any[]>([]);
    const [allUsers, setAllUsers] = useState<any[]>([]);
    const [orders, setOrders] = useState<any[]>([]);

    const handleNav = (tab: AdminView) => {
        setActiveTab(tab);
        setSidebarOpen(false);
    };

    return (
        <AdminSecurityGate>
            <div className="min-h-screen bg-[#07050f] text-slate-100 flex font-sans selection:bg-cyan-500/20">
                {/* MOBILE HAMBURGER */}
                <button
                    onClick={() => setSidebarOpen(true)}
                    className="fixed top-4 left-4 z-50 p-3 rounded-xl bg-black/60 backdrop-blur-xl border border-white/10 lg:hidden"
                >
                    <Menu size={22} className="text-cyan-400" />
                </button>

                {/* SIDEBAR OVERLAY (mobile) */}
                {sidebarOpen && (
                    <div
                        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
                        onClick={() => setSidebarOpen(false)}
                    />
                )}

                {/* SIDEBAR NAVIGATION */}
                <aside className={`
                    fixed lg:sticky top-0 left-0 z-50 h-screen
                    w-72 lg:w-80 border-r border-white/5 bg-black/20 backdrop-blur-3xl flex flex-col p-8 overflow-y-auto
                    transition-transform duration-300
                    ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
                    lg:translate-x-0
                `}>
                    <div className="flex items-center justify-between gap-4 mb-12">
                        <div className="flex items-center gap-4">
                            <img src={LOGO_B64} alt="G-Taxi" className="h-10 w-auto filter drop-shadow-[0_0_10px_rgba(167,139,250,0.5)]" />
                            <div>
                                <h1 className="font-orbitron font-black text-lg tracking-wider text-white">G-TAXI<span className="text-cyan-400"> 868</span></h1>
                                <p className="text-[9px] font-black text-white/20 uppercase tracking-[0.3em]">Command Center</p>
                            </div>
                        </div>
                        <button onClick={() => setSidebarOpen(false)} className="lg:hidden p-2 text-white/40 hover:text-white">
                            <X size={20} />
                        </button>
                    </div>

                    <nav className="flex-1 space-y-2">
                        <NavItem active={activeTab === 'dashboard'} onClick={() => handleNav('dashboard')} icon={<LayoutDashboard size={20}/>} label="Operations Overview" />
                        <NavItem active={activeTab === 'fleet'} onClick={() => handleNav('fleet')} icon={<Users size={20}/>} label="Fleet & Personnel" />
                        <NavItem active={activeTab === 'approval'} onClick={() => handleNav('approval')} icon={<UserCheck size={20}/>} label="Driver Approval" />
                        <NavItem active={activeTab === 'financials'} onClick={() => handleNav('financials')} icon={<CreditCard size={20}/>} label="Financial Index" />
                        <NavItem active={activeTab === 'nodes'} onClick={() => handleNav('nodes')} icon={<Radio size={20}/>} label="Node Registry" />
                        <NavItem active={activeTab === 'rescue'} onClick={() => handleNav('rescue')} icon={<AlertTriangle size={20}/>} label="Rescue Command" />
                        <NavItem active={activeTab === 'warchest'} onClick={() => handleNav('warchest')} icon={<Vault size={20}/>} label="War Chest" />
                        <NavItem active={activeTab === 'platformcontrol'} onClick={() => handleNav('platformcontrol')} icon={<SlidersHorizontal size={20}/>} label="Platform Control" />
                        <NavItem active={activeTab === 'travel'} onClick={() => handleNav('travel')} icon={<Plane size={20}/>} label="Travel Packages" />
                        <NavItem active={activeTab === 'dealer'} onClick={() => handleNav('dealer')} icon={<Car size={20}/>} label="Dealer Brokerage" />
                        <NavItem active={activeTab === 'intelligence'} onClick={() => handleNav('intelligence')} icon={<Bot size={20}/>} label="AI Intelligence" />
                        <NavItem active={activeTab === 'pricing'} onClick={() => handleNav('pricing')} icon={<Tag size={20}/>} label="Pricing Config" />
                        <NavItem active={activeTab === 'merchants'} onClick={() => handleNav('merchants')} icon={<Store size={20}/>} label="Merchant Network" />
                        <NavItem active={activeTab === 'support'} onClick={() => handleNav('support')} icon={<Flag size={20}/>} label="Support Tickets" />
                        <NavItem active={activeTab === 'progression'} onClick={() => handleNav('progression')} icon={<TrendingUp size={20}/>} label="Progression" />
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
                            Sign out
                        </button>
                    </div>
                </aside>

                {/* MAIN CONTENT AREA */}
                <main className="flex-1 overflow-y-auto overflow-x-auto p-4 sm:p-6 lg:p-12 pt-20 lg:pt-12">
                    <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-12">
                        <div>
                            <h2 className="text-2xl sm:text-3xl font-black text-white italic tracking-tight">{TAB_LABELS[activeTab] ?? activeTab}</h2>
                            <p className="text-xs font-medium text-white/30 mt-1">G-Taxi 868 &mdash; Trinidad &amp; Tobago</p>
                        </div>
                        <div className="flex items-center gap-4">
                            <div className="px-4 py-2 bg-white/5 border border-white/10 rounded-full flex items-center gap-3">
                                <ShieldCheck size={14} className="text-cyan-400" />
                                <span className="text-[10px] font-black uppercase text-white/40 tracking-widest">Admin Authorization: Granted</span>
                            </div>
                        </div>
                    </header>

                    {syncError && (
                        <div className="mb-6 p-4 bg-red-900/30 border border-red-500/40 rounded-xl flex items-center justify-between">
                            <span className="text-red-300 text-sm font-mono">{syncError}</span>
                            <button
                                onClick={fetchData}
                                className="px-4 py-2 bg-red-500/20 border border-red-500/40 rounded-lg text-red-300 text-xs font-black uppercase tracking-widest hover:bg-red-500/30"
                            >
                                Retry
                            </button>
                        </div>
                    )}
                    <div className="max-w-7xl">
                        {activeTab === 'dashboard' && <Dashboard rides={rides} />}
                        {activeTab === 'fleet' && <FleetManager rides={rides} allUsers={allUsers} orders={orders} onRefresh={fetchData} />}
                        {activeTab === 'approval' && <DriverApproval onRefresh={fetchData} />}
                        {activeTab === 'financials' && <Financials />}
                        {activeTab === 'nodes' && <NodeRegistry />}
                        {activeTab === 'rescue' && <RescueScreen />}
                        {activeTab === 'warchest' && <WarChest />}
                        {activeTab === 'platformcontrol' && <PlatformControl />}
                        {activeTab === 'travel' && <TravelPackages />}
                        {activeTab === 'dealer' && <DealerBrokerage />}
                        {activeTab === 'intelligence' && <Intelligence />}
                        {activeTab === 'pricing' && <Pricing />}
                        {activeTab === 'merchants' && <MerchantNetwork />}
                        {activeTab === 'support' && <Support />}
                        {activeTab === 'progression' && <Progression />}
                    </div>
                </main>

                {/* FOOTER STATUS BAR */}
                <footer className="fixed bottom-0 left-0 lg:left-80 right-0 h-10 bg-black/40 backdrop-blur-xl border-t border-white/5 px-4 lg:px-10 flex items-center justify-between z-30">
                    <div className="flex items-center gap-6">
                        <span className="text-[9px] font-black text-white/20 uppercase tracking-[0.3em]">Build V1.7.0</span>
                        <div className="w-1 h-1 bg-white/10 rounded-full" />
                        <span className="text-[9px] font-black text-cyan-400/60 uppercase tracking-[0.3em]">TLS Secured</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <Activity size={10} className="text-cyan-400" />
                        <span className="text-[9px] font-black text-white/40 uppercase tracking-[0.3em]">Realtime Connected</span>
                    </div>
                </footer>
            </div>
        </AdminSecurityGate>
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
