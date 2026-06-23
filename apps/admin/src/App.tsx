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
import { EscapeManagement } from './pages/EscapeManagement';
import { RevshareSettlement } from './pages/RevshareSettlement';
import { CommanderManagement } from './pages/CommanderManagement';
import { LOGO_B64 } from './logoUrl';
import { LayoutDashboard, Users, CreditCard, LogOut, ShieldCheck, Activity, UserCheck, Menu, X, ShieldOff, Radio, AlertTriangle, Vault, SlidersHorizontal, Plane, Car, Bot, Tag, Store, Flag, TrendingUp, Globe, DollarSign } from 'lucide-react';

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
        try {
            await supabase.functions.invoke('admin', {
                body: { action: 'get_flags' },
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
            if (!session) { setGateState('unauthorized'); setUser(null); }
            else { checkAccess(); }
        });
        return () => subscription.unsubscribe();
    }, [checkAccess]);

    if (gateState === 'loading') {
        return (
            <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--surface-base)' }}>
                <div className="flex flex-col items-center gap-6">
                    <div className="relative">
                        <div className="w-14 h-14 border-[3px] border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
                        <div className="absolute inset-0 w-14 h-14 border-[3px] border-[var(--cyan)] border-b-transparent rounded-full animate-spin" style={{ animationDirection: 'reverse', opacity: 0.5 }} />
                    </div>
                    <p className="text-xs font-bold" style={{ color: 'var(--ink-muted)' }}>Verifying</p>
                </div>
            </div>
        );
    }

    if (gateState === 'unauthorized') {
        return <Login onLoginSuccess={() => checkAccess()} />;
    }

    return <>{children}</>;
}

// ── App ────────────────────────────────────────────────────────────────────────
type AdminView = 'dashboard' | 'fleet' | 'commander' | 'financials' | 'approval' | 'nodes' | 'rescue' | 'warchest' | 'platformcontrol' | 'travel' | 'escape' | 'dealer' | 'intelligence' | 'pricing' | 'merchants' | 'support' | 'progression' | 'revshare';

const TAB_LABELS: Record<AdminView, string> = {
    dashboard: 'Operations Overview',
    fleet: 'Fleet & Personnel',
    commander: 'Commanders',
    financials: 'Financials',
    approval: 'Driver Approval',
    nodes: 'Node Registry',
    rescue: 'Rescue',
    warchest: 'War Chest',
    platformcontrol: 'Platform Control',
    travel: 'Travel Packages',
    escape: 'Escape Management',
    dealer: 'Dealer Brokerage',
    intelligence: 'AI Intelligence',
    pricing: 'Pricing Config',
    merchants: 'Merchant Network',
    support: 'Support Tickets',
    progression: 'Rider Progression',
    revshare: 'Revshare Settlement',
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
            const { data: rideData } = await adminFetch('admin', { action: 'get_rides' });
            setRides(rideData || []);
            const { users } = await adminFetch('admin', { action: 'get_users' });
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

    const [rides, setRides] = useState<any[]>([]);
    const [allUsers, setAllUsers] = useState<any[]>([]);
    const [orders, setOrders] = useState<any[]>([]);

    const handleNav = (tab: AdminView) => {
        setActiveTab(tab);
        setSidebarOpen(false);
    };

    return (
        <AdminSecurityGate>
            <div className="min-h-screen flex font-sans selection:bg-[var(--accent)]/20" style={{ background: 'var(--surface-base)', color: 'var(--ink)' }}>
                <button
                    onClick={() => setSidebarOpen(true)}
                    className="glass-panel fixed top-4 left-4 z-50 p-3 rounded-xl lg:hidden"
                    style={{ background: 'rgba(0,0,0,0.6)' }}
                >
                    <Menu size={22} style={{ color: 'var(--cyan)' }} />
                </button>

                {sidebarOpen && (
                    <div
                        className="fixed inset-0 z-40 lg:hidden"
                        style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
                        onClick={() => setSidebarOpen(false)}
                    />
                )}

                <aside className={`
                    glass-panel fixed lg:sticky top-0 left-0 z-50 h-screen
                    w-72 lg:w-80 flex flex-col p-8 overflow-y-auto
                    transition-transform duration-300 ease-out-expo
                    ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
                    lg:translate-x-0
                `} style={{ borderRight: '1px solid var(--glass-border)' }}>
                    <div className="flex items-center justify-between gap-4 mb-12">
                        <div className="flex items-center gap-4">
                            <img src={LOGO_B64} alt="G-Taxi" className="h-10 w-auto" style={{ filter: 'drop-shadow(0 0 12px var(--accent-glow))' }} />
                            <div>
                                <h1 className="font-orbitron font-black text-lg tracking-wider">G-TAXI <span style={{ color: 'var(--cyan)' }}>868</span></h1>
                                <p className="text-[9px] font-black uppercase tracking-[0.3em]" style={{ color: 'var(--ink-dim)' }}>Command Center</p>
                            </div>
                        </div>
                        <button onClick={() => setSidebarOpen(false)} className="lg:hidden p-2" style={{ color: 'var(--ink-dim)' }}>
                            <X size={20} />
                        </button>
                    </div>

                    <nav className="flex-1 flex flex-col gap-1">
                        <NavItem active={activeTab === 'dashboard'} onClick={() => handleNav('dashboard')} icon={<LayoutDashboard size={20}/>} label="Operations" />
                        <NavItem active={activeTab === 'fleet'} onClick={() => handleNav('fleet')} icon={<Users size={20}/>} label="Fleet & Personnel" />
                        <NavItem active={activeTab === 'commander'} onClick={() => handleNav('commander')} icon={<ShieldCheck size={20}/>} label="Commanders" />
                        <NavItem active={activeTab === 'approval'} onClick={() => handleNav('approval')} icon={<UserCheck size={20}/>} label="Driver Approval" />
                        <NavItem active={activeTab === 'financials'} onClick={() => handleNav('financials')} icon={<CreditCard size={20}/>} label="Financial Index" />
                        <NavItem active={activeTab === 'nodes'} onClick={() => handleNav('nodes')} icon={<Radio size={20}/>} label="Node Registry" />
                        <NavItem active={activeTab === 'rescue'} onClick={() => handleNav('rescue')} icon={<AlertTriangle size={20}/>} label="Rescue" />
                        <NavItem active={activeTab === 'warchest'} onClick={() => handleNav('warchest')} icon={<Vault size={20}/>} label="War Chest" />
                        <NavItem active={activeTab === 'platformcontrol'} onClick={() => handleNav('platformcontrol')} icon={<SlidersHorizontal size={20}/>} label="Platform Control" />
                        <NavItem active={activeTab === 'travel'} onClick={() => handleNav('travel')} icon={<Plane size={20}/>} label="Travel Packages" />
                        <NavItem active={activeTab === 'escape'} onClick={() => handleNav('escape')} icon={<Globe size={20}/>} label="Escape Mgmt" />
                        <NavItem active={activeTab === 'dealer'} onClick={() => handleNav('dealer')} icon={<Car size={20}/>} label="Dealer Brokerage" />
                        <NavItem active={activeTab === 'intelligence'} onClick={() => handleNav('intelligence')} icon={<Bot size={20}/>} label="AI Intelligence" />
                        <NavItem active={activeTab === 'pricing'} onClick={() => handleNav('pricing')} icon={<Tag size={20}/>} label="Pricing Config" />
                        <NavItem active={activeTab === 'merchants'} onClick={() => handleNav('merchants')} icon={<Store size={20}/>} label="Merchant Network" />
                        <NavItem active={activeTab === 'support'} onClick={() => handleNav('support')} icon={<Flag size={20}/>} label="Support" />
                        <NavItem active={activeTab === 'progression'} onClick={() => handleNav('progression')} icon={<TrendingUp size={20}/>} label="Progression" />
                        <NavItem active={activeTab === 'revshare'} onClick={() => handleNav('revshare')} icon={<DollarSign size={20}/>} label="Revshare" />
                    </nav>

                    <div className="pt-8 mt-8 border-t" style={{ borderColor: 'var(--glass-border)' }}>
                        <div className="glass-card p-6">
                            <div className="flex items-center gap-3 mb-4">
                                <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--green)', boxShadow: '0 0 8px var(--green-glow)' }} />
                                <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: 'var(--ink-dim)' }}>System Status</span>
                            </div>
                            <p className="text-[11px] font-bold leading-relaxed" style={{ color: 'var(--ink-muted)' }}>All systems nominal</p>
                        </div>
                        <button
                            onClick={() => supabase.auth.signOut()}
                            className="glass-btn glass-btn-ghost w-full mt-4 h-11"
                        >
                            <LogOut size={16} />
                            Sign out
                        </button>
                        <button
                            onClick={async () => {
                                if (!window.confirm('Permanently delete your account and all associated data? This cannot be undone.')) return;
                                try {
                                    const { error } = await supabase.functions.invoke('delete_account');
                                    if (error) throw error;
                                    await supabase.auth.signOut();
                                } catch (err: any) {
                                    alert('Could not delete account: ' + (err?.message || 'unknown error'));
                                }
                            }}
                            className="w-full mt-2 h-9 flex items-center justify-center gap-2 rounded-xl text-[10px] font-bold uppercase tracking-widest"
                            style={{ color: 'var(--ink-dim)' }}
                        >
                            Delete account
                        </button>
                    </div>
                </aside>

                <main className="flex-1 overflow-y-auto overflow-x-auto p-4 sm:p-6 lg:p-12 pt-20 lg:pt-12">
                    <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-12 animate-in">
                        <div>
                            <h2 className="text-2xl sm:text-3xl font-black tracking-tight">{TAB_LABELS[activeTab] ?? activeTab}</h2>
                            <p className="text-xs font-medium mt-1" style={{ color: 'var(--ink-muted)' }}>G-Taxi 868 — Trinidad & Tobago</p>
                        </div>
                        <div className="glass-panel px-4 py-2 rounded-full flex items-center gap-3">
                            <ShieldCheck size={14} style={{ color: 'var(--cyan)' }} />
                            <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--ink-muted)' }}>Authorized</span>
                        </div>
                    </header>

                    {syncError && (
                        <div className="error-banner mb-6 animate-in">
                            <span>{syncError}</span>
                            <button onClick={fetchData}>Retry</button>
                        </div>
                    )}
                    <div className="max-w-7xl animate-in" style={{ animationDelay: '0.1s' }}>
                        {activeTab === 'dashboard' && <Dashboard rides={rides} />}
                        {activeTab === 'fleet' && <FleetManager rides={rides} allUsers={allUsers} orders={orders} onRefresh={fetchData} />}
                        {activeTab === 'commander' && <CommanderManagement />}
                        {activeTab === 'approval' && <DriverApproval onRefresh={fetchData} />}
                        {activeTab === 'financials' && <Financials />}
                        {activeTab === 'nodes' && <NodeRegistry />}
                        {activeTab === 'rescue' && <RescueScreen />}
                        {activeTab === 'warchest' && <WarChest />}
                        {activeTab === 'platformcontrol' && <PlatformControl />}
                        {activeTab === 'travel' && <TravelPackages />}
                        {activeTab === 'escape' && <EscapeManagement />}
                        {activeTab === 'dealer' && <DealerBrokerage />}
                        {activeTab === 'intelligence' && <Intelligence />}
                        {activeTab === 'pricing' && <Pricing />}
                        {activeTab === 'merchants' && <MerchantNetwork />}
                        {activeTab === 'support' && <Support />}
                        {activeTab === 'progression' && <Progression />}
                        {activeTab === 'revshare' && <RevshareSettlement />}
                    </div>
                </main>

                <footer className="fixed bottom-0 left-0 lg:left-80 right-0 h-10 flex items-center justify-between z-30 px-4 lg:px-10" style={{ background: 'rgba(5,5,10,0.7)', backdropFilter: 'blur(16px)', borderTop: '1px solid var(--glass-border)' }}>
                    <div className="flex items-center gap-6">
                        <span className="text-[9px] font-bold uppercase tracking-[0.3em]" style={{ color: 'var(--ink-dim)' }}>Build V1.7.0</span>
                        <div style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--ink-dim)' }} />
                        <span className="text-[9px] font-bold uppercase tracking-[0.3em]" style={{ color: 'rgba(34,211,238,0.5)' }}>TLS Secured</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <Activity size={10} style={{ color: 'var(--green)' }} />
                        <span className="text-[9px] font-bold uppercase tracking-[0.3em]" style={{ color: 'var(--ink-dim)' }}>Realtime</span>
                    </div>
                </footer>
            </div>
        </AdminSecurityGate>
    );
}

const NavItem = ({ active, onClick, icon, label }: any) => (
    <button
        onClick={onClick}
        className="flex items-center gap-3 px-5 h-11 rounded-xl transition-all duration-200"
        style={{
            background: active ? 'var(--surface-active)' : 'transparent',
            color: active ? 'var(--ink)' : 'var(--ink-muted)',
            fontWeight: active ? 700 : 500,
            fontSize: '0.8125rem'
        }}
        onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'var(--surface-hover)'; }}
        onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
    >
        <span style={{ opacity: active ? 1 : 0.35 }}>{icon}</span>
        {label}
    </button>
);

export default App;
