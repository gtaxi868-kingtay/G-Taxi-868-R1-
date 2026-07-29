import { useEffect, useState } from 'react';
import { supabase } from './lib/supabase';
import { 
  Package, MapPin, CheckCircle, Clock, AlertTriangle, LogOut, 
  Sparkles, Bell, ShieldCheck, Users, DollarSign, Scan,
  PlaneTakeoff, ShoppingBag, Scissors, CreditCard, Menu, X, Megaphone
} from 'lucide-react';
import { MerchantFinancials } from './pages/MerchantFinancials';
import { MerchantPromotions } from './pages/MerchantPromotions';
import { MerchantLogin } from './pages/MerchantLogin';
import { MerchantRegister } from './pages/MerchantRegister';
import { MerchantJoinWithCode } from './pages/MerchantJoinWithCode';

type MerchantMode = 'HOTEL' | 'RETAIL' | 'SERVICE' | 'AIRPORT';
type MerchantView = 'dashboard' | 'appointments' | 'financials' | 'promotions';

function App() {
  const [view, setView] = useState<'login' | 'register' | 'join' | 'app'>('login');
  const [activeTab, setActiveTab] = useState<MerchantView>('dashboard');
  const [merchant, setMerchant] = useState<any>(null);
  const [mode, setMode] = useState<MerchantMode>('SERVICE');
  const [orders, setOrders] = useState<any[]>([]);
  const [appointments, setAppointments] = useState<any[]>([]);
  const [selectedAppointment, setSelectedAppointment] = useState<any | null>(null);
  const [showDispatch, setShowDispatch] = useState(false);
  const [dispatchResult, setDispatchResult] = useState<any>(null);
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  const [soundEnabled, setSoundEnabled] = useState(localStorage.getItem('g_taxi_merchant_sound') !== 'false');
    const [sidebarOpen, setSidebarOpen] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState('');

  const checkSession = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      const { data: profile } = await supabase.from('profiles').select('*, merchant:merchant_id(*)').eq('id', session.user.id).single();
      if (profile?.merchant) {
        setMerchant(profile.merchant);
        determineMode(profile.merchant.category);
        setView('app');
        fetchData(profile.merchant.id);
        setupRealtime(profile.merchant.id);
      } else {
        await supabase.auth.signOut();
        setView('login');
      }
    }
  };

  let merchantOpsChannel: any = null;

  const setupRealtime = (mId: string) => {
    if (merchantOpsChannel) merchantOpsChannel.unsubscribe();
    merchantOpsChannel = supabase.channel('merchant_ops')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders', filter: `merchant_id=eq.${mId}` }, 
        () => { if(soundEnabled) playChime(); fetchData(mId); })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'merchant_appointments', filter: `merchant_id=eq.${mId}` }, 
        () => { if(soundEnabled) playChime(); fetchData(mId); })
      .subscribe();
  };

  useEffect(() => {
    return () => {
      if (merchantOpsChannel) merchantOpsChannel.unsubscribe();
    };
  }, []);

  const playChime = () => {
    const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
    audio.play().catch(() => {});
  };

  const determineMode = (category: string) => {
    const cat = category?.toUpperCase() || '';
    if (cat.includes('HOTEL')) setMode('HOTEL');
    else if (cat.includes('RETAIL') || cat.includes('GROCERY')) setMode('RETAIL');
    else if (cat.includes('AIRPORT')) setMode('AIRPORT');
    else setMode('SERVICE');
  };

  const fetchData = async (mId: string) => {
    const { data: ords } = await supabase.from('orders').select('*, rider:rider_id(full_name), order_items(*)').eq('merchant_id', mId).order('created_at', { ascending: false });
    setOrders(ords || []);
    const { data: apps } = await supabase.from('merchant_appointments').select('*, rider:rider_id(full_name), service:service_id(name)').eq('merchant_id', mId).order('scheduled_at', { ascending: true });
    setAppointments(apps || []);
  };

  const updateAppointment = async (id: string, status: string) => {
    const { error } = await supabase.from('merchant_appointments').update({ merchant_consent_status: status }).eq('id', id);
    if (!error) fetchData(merchant.id);
    setSelectedAppointment(null);
  };

  const handleNav = (tab: MerchantView) => {
    setActiveTab(tab);
    setSidebarOpen(false);
  };

  useEffect(() => { checkSession(); }, []);

  if (view === 'login') return (
    <MerchantLogin
      email={loginEmail} setEmail={setLoginEmail}
      password={loginPassword} setPassword={setLoginPassword}
      loading={loginLoading} error={loginError}
      onSubmit={async (e: React.FormEvent) => {
        e.preventDefault();
        setLoginError('');
        setLoginLoading(true);
        const { error } = await supabase.auth.signInWithPassword({ email: loginEmail, password: loginPassword });
        setLoginLoading(false);
        if (error) setLoginError(error.message);
        else checkSession();
      }}
      onGoRegister={() => setView('register')}
      onGoJoin={() => setView('join')}
    />
  );

  if (view === 'register') return (
    <MerchantRegister onDone={() => setView('login')} onBack={() => setView('login')} />
  );

  if (view === 'join') return (
    <MerchantJoinWithCode onDone={() => setView('login')} onBack={() => setView('login')} />
  );

  return (
    <div className="min-h-screen bg-[#0B0E12] text-[#F2F5F8] font-sans">
      <button
        onClick={() => setSidebarOpen(true)}
        className="fixed top-4 left-4 z-50 p-3 rounded-2xl bg-[#13171D] shadow-lg border border-[#007070]/20 lg:hidden"
      >
        <Menu size={22} className="text-[#0D9488]" />
      </button>

      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-[#0B0E12]/80 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <div className={`
        fixed left-0 top-0 bottom-0 z-50
        w-80 bg-[#13171D] border-r border-[#007070]/10 p-8 flex flex-col
        transition-transform duration-300
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        lg:translate-x-0
      `}>
          <div className="flex items-center justify-between gap-4 mb-16">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-[#007070] rounded-2xl flex items-center justify-center shadow-lg shadow-[#007070]/20">
                <Sparkles size={24} color="white" />
              </div>
              <div>
                  <h2 className="font-black text-xl tracking-tight text-white">G-TAXI</h2>
                  <p className="text-[9px] font-black text-[#5A5F66] uppercase tracking-widest">Partner Hub</p>
              </div>
            </div>
            <button onClick={() => setSidebarOpen(false)} className="lg:hidden p-2 text-[#5A5F66] hover:text-white">
              <X size={20} />
            </button>
          </div>

          <nav className="flex-1 space-y-3">
              <MerchantNavItem active={activeTab === 'dashboard'} onClick={() => handleNav('dashboard')} icon={<Package size={20}/>} label="Live Manifests" />
              <MerchantNavItem active={activeTab === 'appointments'} onClick={() => handleNav('appointments')} icon={<Clock size={20}/>} label="Guest Schedule" />
              <MerchantNavItem active={activeTab === 'financials'} onClick={() => handleNav('financials')} icon={<CreditCard size={20}/>} label="Financial Audit" />
              <MerchantNavItem active={activeTab === 'promotions'} onClick={() => handleNav('promotions')} icon={<Megaphone size={20}/>} label="Promotions" />
          </nav>

          <div className="mt-auto space-y-4">
            <button 
              onClick={() => { setSoundEnabled(!soundEnabled); localStorage.setItem('g_taxi_merchant_sound', (!soundEnabled).toString()); }}
              className="w-full h-12 flex items-center justify-center gap-2 rounded-xl border border-[#007070]/20 text-[#5A5F66] font-bold text-[10px] uppercase tracking-widest hover:bg-[#0B0E12] transition-all"
            >
              {soundEnabled ? <Bell size={14} className="text-[#0D9488]" /> : <Bell size={14} />}
              SOUND: {soundEnabled ? 'ON' : 'OFF'}
            </button>
            <button 
              onClick={() => supabase.auth.signOut().then(() => setView('login')).catch(() => alert('Could not sign out. Please try again.'))}
              className="w-full h-14 flex items-center justify-center gap-3 rounded-2xl border border-red-500/20 text-red-400 font-black text-xs uppercase tracking-widest hover:bg-red-500/10 transition-all"
            >
              <LogOut size={18} />
              END SESSION
            </button>
          </div>
      </div>

      <main className="lg:pl-80 p-4 sm:p-6 lg:p-12 pt-20 lg:pt-12 min-h-screen pb-20">
          <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-16">
              <div>
                  <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-white">{merchant?.name}</h1>
                  <p className="text-xs font-bold text-[#5A5F66] uppercase tracking-[0.3em] mt-2 italic">{mode} OPERATIONS COMMAND</p>
              </div>
              <div className="flex items-center gap-6">
                  <div className="bg-[#13171D] border border-[#007070]/20 px-6 py-3 rounded-full flex items-center gap-3">
                      <div className={`w-2 h-2 ${merchant?.is_active ? 'bg-green-500' : 'bg-red-500'} rounded-full animate-pulse`} />
                      <span className="text-[10px] font-black uppercase text-[#5A5F66] tracking-widest">{merchant?.is_active ? 'Online' : 'Diverted'}</span>
                  </div>
              </div>
          </header>

          <div className="max-w-6xl">
              {activeTab === 'dashboard' && (
                  <div className="grid grid-cols-1 gap-12">
                      {mode === 'HOTEL' && (
                          <div className="bg-gradient-to-br from-[#007070] to-[#004f4f] p-8 sm:p-12 rounded-[2.5rem] sm:rounded-[3.5rem] text-white shadow-2xl relative overflow-hidden group">
                              <div className="relative z-10">
                                  <h3 className="text-2xl sm:text-3xl font-black mb-4 italic">VIP GUEST SUMMON</h3>
                                  <p className="max-w-md text-white/70 mb-10 font-medium">Instantly dispatch a G-Taxi to your front door for arriving or departing guests.</p>
                                  <button onClick={() => setShowDispatch(true)} className="h-16 sm:h-18 px-8 sm:px-10 bg-white text-[#007070] rounded-2xl font-black text-base sm:text-lg shadow-xl hover:scale-105 transition-all flex items-center gap-4">
                                      <Users size={24} /> DISPATCH NOW
                                  </button>
                              </div>
                              <MapPin className="absolute top-0 right-0 p-12 opacity-10 rotate-12" size={300} />
                          </div>
                      )}

                      <div className="space-y-6">
                        <h3 className="text-xs font-black text-[#5A5F66] uppercase tracking-[0.4em] mb-8">Incoming Manifests</h3>
                        {orders.length === 0 ? (
                            <div className="py-20 text-center bg-[#13171D] border border-dashed border-[#007070]/20 rounded-[2.5rem]">
                                <Package className="mx-auto text-[#5A5F66] mb-4" size={48} />
                                <p className="text-[#5A5F66] font-bold uppercase text-[10px] tracking-widest">No Active Logistics</p>
                            </div>
                        ) : orders.map(order => (
                            <div key={order.id} className="bg-[#13171D] p-6 sm:p-8 rounded-[2rem] sm:rounded-[2.5rem] border border-[#007070]/20 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 hover:border-[#0D9488]/30 transition-all shadow-sm">
                                <div className="flex items-center gap-6 sm:gap-8">
                                    <div className="w-12 h-12 sm:w-14 sm:h-14 bg-[#0B0E12] rounded-2xl flex items-center justify-center border border-[#007070]/20">
                                        {mode === 'RETAIL' ? <ShoppingBag className="text-[#0D9488]" /> : <Package className="text-[#5A5F66]" />}
                                    </div>
                                    <div>
                                        <p className="text-[9px] font-black text-[#0D9488] uppercase tracking-widest">{order.status}</p>
                                        <h4 className="text-lg sm:text-xl font-black text-white">Order #{order.id.slice(0,6).toUpperCase()}</h4>
                                        <p className="text-xs font-bold text-[#5A5F66]">{order.rider?.full_name} · {order.order_items?.length} items</p>
                                    </div>
                                </div>
                                <button onClick={() => setSelectedOrder(order)} className="h-12 px-6 bg-[#007070] text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-[#004f4f] transition-all w-full sm:w-auto">MANIFEST DETAIL</button>
                            </div>
                        ))}
                      </div>
                  </div>
              )}

              {activeTab === 'appointments' && (
                  <div className="space-y-6">
                      <h3 className="text-xs font-black text-[#5A5F66] uppercase tracking-[0.4em] mb-8">Client Service Schedule</h3>
                      {appointments.length === 0 ? (
                          <div className="py-20 text-center bg-[#13171D] border border-dashed border-[#007070]/20 rounded-[2.5rem]">
                              <Clock className="mx-auto text-[#5A5F66] mb-4" size={48} />
                              <p className="text-[#5A5F66] font-bold uppercase text-[10px] tracking-widest">Schedule Empty</p>
                          </div>
                      ) : appointments.map(app => (
                          <div key={app.id} className="bg-[#13171D] p-6 sm:p-8 rounded-[2rem] sm:rounded-[2.5rem] border border-[#007070]/20 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 hover:border-[#0D9488]/30 transition-all shadow-sm">
                              <div className="flex items-center gap-6 sm:gap-8">
                                  <div className="w-12 h-12 sm:w-14 sm:h-14 bg-[#0B0E12] rounded-2xl flex items-center justify-center border border-[#007070]/20">
                                      <Scissors className="text-[#0D9488]" />
                                  </div>
                                  <div>
                                      <p className="text-[9px] font-black text-[#0D9488] uppercase tracking-widest">{new Date(app.scheduled_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {app.merchant_consent_status}</p>
                                      <h4 className="text-lg sm:text-xl font-black text-white">{app.rider?.full_name}</h4>
                                      <p className="text-xs font-bold text-[#5A5F66]">{app.service?.name}</p>
                                  </div>
                              </div>
                              {app.merchant_consent_status === 'pending' && (
                                  <button onClick={() => setSelectedAppointment(app)} className="h-12 px-8 bg-[#007070] text-white rounded-xl font-black text-[10px] uppercase tracking-widest shadow-lg shadow-[#007070]/20 w-full sm:w-auto">MANAGE</button>
                              )}
                          </div>
                      ))}
                  </div>
              )}

              {activeTab === 'financials' && <MerchantFinancials merchantId={merchant?.id} />}
              {activeTab === 'promotions' && <MerchantPromotions merchantId={merchant?.id} />}
          </div>

          {showDispatch && (
              <DispatchModal merchant={merchant} onClose={() => { setShowDispatch(false); setDispatchResult(null); }} onSuccess={(res: any) => { setDispatchResult(res); fetchData(merchant.id); }} result={dispatchResult} />
          )}

          {selectedOrder && (
              <div className="fixed inset-0 bg-[#0B0E12]/80 backdrop-blur-md z-[100] flex items-center justify-center sm:justify-end p-4 sm:p-6">
                  <div className="bg-[#13171D] w-full sm:max-w-xl h-full max-h-screen sm:max-h-[calc(100vh-3rem)] rounded-[2.5rem] sm:rounded-[3.5rem] p-8 sm:p-12 pb-8 shadow-2xl relative overflow-y-auto animate-in slide-in-from-right duration-500 border border-[#007070]/20">
                      <button onClick={() => setSelectedOrder(null)} className="absolute top-8 sm:top-12 right-8 sm:right-12 text-[#5A5F66] hover:text-white transition-colors"><CheckCircle size={28} /></button>
                      <h2 className="text-3xl sm:text-4xl font-black mb-2 italic text-white">MANIFEST</h2>
                      <p className="text-[#5A5F66] text-sm font-bold mb-12 uppercase tracking-widest">Order #{selectedOrder.id.toUpperCase()}</p>
                      
                      <div className="space-y-8">
                          <div className="bg-[#0B0E12] p-6 sm:p-8 rounded-2xl sm:rounded-3xl border border-[#007070]/20">
                              <h4 className="text-[10px] font-black text-[#5A5F66] uppercase tracking-[0.2em] mb-6">PICKING LIST</h4>
                              <div className="space-y-4">
                                {selectedOrder.order_items?.map((item: any) => (
                                    <div key={item.id} className={`p-4 rounded-2xl border transition-all ${item.picking_status === 'FOUND' ? 'bg-green-500/10 border-green-500/30' : item.picking_status === 'OUT' ? 'bg-red-500/10 border-red-500/30' : 'bg-[#13171D] border-[#007070]/20'}`}>
                                        <div className="flex items-center justify-between mb-4">
                                            <div className="flex items-center gap-4">
                                                <div className="w-8 h-8 bg-[#007070] text-white rounded-lg flex items-center justify-center text-xs font-black">{item.quantity}x</div>
                                                <span className="font-bold text-white">{item.product_name || 'Item'}</span>
                                            </div>
                                            <span className="font-black text-[#0D9488]">${(item.unit_price_cents/100).toFixed(2)}</span>
                                        </div>
                                        
                                        <div className="flex gap-2">
                                            <button 
                                                onClick={async () => {
                                                    const { error } = await supabase.from('order_items').update({ picking_status: 'FOUND' }).eq('id', item.id);
                                                    if (!error) fetchData(merchant.id);
                                                }}
                                                className={`flex-1 h-10 rounded-xl font-black text-[9px] uppercase tracking-widest transition-all ${item.picking_status === 'FOUND' ? 'bg-green-500 text-white' : 'bg-transparent border border-[#007070]/20 text-[#5A5F66] hover:bg-green-500/10'}`}
                                            >
                                                FOUND
                                            </button>
                                            <button 
                                                onClick={async () => {
                                                    const { error } = await supabase.from('order_items').update({ picking_status: 'OUT' }).eq('id', item.id);
                                                    if (!error) fetchData(merchant.id);
                                                }}
                                                className={`flex-1 h-10 rounded-xl font-black text-[9px] uppercase tracking-widest transition-all ${item.picking_status === 'OUT' ? 'bg-red-500 text-white' : 'bg-transparent border border-[#007070]/20 text-[#5A5F66] hover:bg-red-500/10'}`}
                                            >
                                                OUT OF STOCK
                                            </button>
                                        </div>
                                    </div>
                                ))}
                              </div>
                          </div>
                          
                          <div className="p-6 sm:p-8 bg-[#007070]/10 rounded-2xl sm:rounded-3xl border border-[#007070]/20">
                             <div className="flex justify-between items-center mb-2">
                                <span className="text-[10px] font-black text-[#0D9488] uppercase tracking-widest">Total Valuation</span>
                                <span className="text-2xl font-black text-[#0D9488]">${(selectedOrder.total_price_cents/100).toFixed(2)}</span>
                             </div>
                             <p className="text-[9px] font-bold text-[#5A5F66] uppercase tracking-widest italic">All prices in TTD · Includes VAT</p>
                          </div>

                          {selectedOrder.status === 'pending' && (
                            <div className="flex gap-4">
                              <button onClick={async () => {
                                const { error } = await supabase.functions.invoke('merchant', {
                                  body: { action: 'update_order_status', order_id: selectedOrder.id, new_status: 'confirmed' },
                                });
                                if (!error) { setSelectedOrder(null); fetchData(merchant.id); }
                              }} className="flex-1 h-16 sm:h-20 bg-[#007070] text-white rounded-[1.5rem] font-black text-base sm:text-lg shadow-2xl shadow-[#007070]/20 hover:scale-[1.02] active:scale-95 transition-all">ACCEPT ORDER</button>
                              <button onClick={async () => {
                                const { error } = await supabase.functions.invoke('merchant', {
                                  body: { action: 'update_order_status', order_id: selectedOrder.id, new_status: 'cancelled' },
                                });
                                if (!error) { setSelectedOrder(null); fetchData(merchant.id); }
                              }} className="flex-1 h-16 sm:h-20 bg-red-600 text-white rounded-[1.5rem] font-black text-base sm:text-lg shadow-2xl hover:scale-[1.02] active:scale-95 transition-all">REJECT</button>
                            </div>
                          )}
                          {selectedOrder.status !== 'pending' && (
                            <button onClick={async () => {
                              await supabase.from('orders').update({ status: 'ready_for_pickup' }).eq('id', selectedOrder.id);
                              setSelectedOrder(null);
                              fetchData(merchant.id);
                            }} className="w-full h-16 sm:h-20 bg-[#007070] text-white rounded-[1.5rem] font-black text-base sm:text-lg shadow-2xl shadow-[#007070]/20 hover:scale-[1.02] active:scale-95 transition-all">MARK AS READY FOR PICKUP</button>
                          )}
                      </div>
                  </div>
              </div>
          )}

          {selectedAppointment && (
              <div className="fixed inset-0 bg-[#0B0E12]/80 backdrop-blur-md z-[100] flex items-center justify-center p-4 sm:p-6">
                  <div className="bg-[#13171D] w-full max-w-md max-h-[80vh] overflow-y-auto rounded-[3rem] sm:rounded-[3.5rem] p-8 sm:p-12 text-center shadow-2xl relative animate-in zoom-in-95 border border-[#007070]/20">
                      <h3 className="text-2xl sm:text-3xl font-black mb-4 italic text-white">APPOINTMENT</h3>
                      <p className="text-[#5A5F66] font-bold mb-10">{selectedAppointment.rider?.full_name} for {selectedAppointment.service?.name}</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <button onClick={() => updateAppointment(selectedAppointment.id, 'rejected')} className="h-16 border border-red-500/20 text-red-400 font-black rounded-2xl uppercase tracking-widest text-xs hover:bg-red-500/10 transition-all">Decline</button>
                          <button onClick={() => updateAppointment(selectedAppointment.id, 'approved')} className="h-16 bg-[#007070] text-white font-black rounded-2xl uppercase tracking-widest text-xs shadow-xl shadow-[#007070]/20">Approve</button>
                      </div>
                  </div>
              </div>
          )}
      </main>

      <footer className="fixed bottom-0 left-0 lg:left-80 right-0 h-12 bg-[#13171D]/80 backdrop-blur-xl border-t border-[#007070]/20 px-4 lg:px-10 flex items-center justify-between">
          <div className="flex items-center gap-8">
              <span className="text-[9px] font-black text-[#5A5F66] uppercase tracking-widest italic">NODE_868_POS_ACTIVE</span>
              <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 bg-green-500 rounded-full" />
                  <span className="text-[9px] font-black text-[#5A5F66] uppercase tracking-widest">Quantum Link Secure</span>
              </div>
          </div>
          <span className="text-[9px] font-black text-[#0D9488] uppercase tracking-[0.4em]">G-TAXI PARTNER SUITE v1.2</span>
      </footer>
    </div>
  );
}

const MerchantNavItem = ({ active, onClick, icon, label }: any) => (
  <button 
    onClick={onClick}
    className={`w-full h-16 px-6 flex items-center gap-5 rounded-2xl transition-all ${active ? 'bg-[#007070] text-white shadow-xl' : 'text-[#5A5F66] hover:bg-[#0B0E12] hover:text-white'}`}
  >
    <div className={active ? 'text-white' : 'text-[#5A5F66]'}>{icon}</div>
    <span className="text-xs font-black uppercase tracking-widest">{label}</span>
  </button>
);

const DispatchModal = ({ merchant, onClose, onSuccess, result }: any) => {
    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');
    const [dest, setDest] = useState('');
    const [suggestions, setSuggestions] = useState<any[]>([]);
    const [selectedLoc, setSelectedLoc] = useState<any>(null);
    const [loading, setLoading] = useState(false);

    const searchDest = async (val: string) => {
        setDest(val);
        if (val.length < 3) return;
        const { data } = await supabase.functions.invoke('geocode', { body: { query: val } });
        if (data?.success) setSuggestions(data.data);
    };

    const handleDispatch = async () => {
        if (!selectedLoc) return alert("Select a valid destination");
        setLoading(true);
        try {
            const { data, error } = await supabase.functions.invoke('merchant', {
                body: {
                    action: 'concierge_dispatch',
                    guest_name: name,
                    guest_phone: phone,
                    destination_lat: selectedLoc.latitude,
                    destination_lng: selectedLoc.longitude,
                    destination_address: selectedLoc.address
                }
            });
            if (error) throw error;
            onSuccess(data);
        } catch (err: any) {
            alert(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleShare = () => {
        const text = encodeURIComponent(result.sms_message);
        window.open(`https://wa.me/${phone.replace(/\D/g, '')}?text=${text}`, '_blank');
    };

    return (
        <div className="fixed inset-0 bg-[#0B0E12]/60 backdrop-blur-md z-[100] flex items-center justify-center p-4 sm:p-6">
            <div className="bg-[#13171D] w-full max-w-xl max-h-[85vh] overflow-y-auto rounded-[2.5rem] sm:rounded-[3rem] p-8 sm:p-12 shadow-2xl animate-in zoom-in-95 duration-300 relative border border-[#007070]/20">
                <button onClick={onClose} className="absolute top-6 sm:top-8 right-6 sm:right-8 text-[#5A5F66] hover:text-white"><AlertTriangle size={24} /></button>
                
                {!result ? (
                    <>
                        <h2 className="text-2xl sm:text-3xl font-black mb-2 italic text-white">GUEST SUMMON</h2>
                        <p className="text-[#5A5F66] text-sm font-bold mb-10 uppercase tracking-widest">Node: {merchant?.name}</p>
                        
                        <div className="space-y-6">
                            <div className="space-y-4">
                                <label className="text-[10px] font-black uppercase tracking-widest text-[#5A5F66] pl-4">Guest Information</label>
                                <input value={name} onChange={e => setName(e.target.value)} placeholder="Full Name" className="w-full h-14 sm:h-16 bg-[#0B0E12] border border-[#007070]/20 rounded-2xl px-6 font-bold text-white focus:border-[#0D9488] outline-none transition-all placeholder-[#5A5F66]" />
                                <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Phone (e.g. +1868...)" className="w-full h-14 sm:h-16 bg-[#0B0E12] border border-[#007070]/20 rounded-2xl px-6 font-bold text-white focus:border-[#0D9488] outline-none transition-all placeholder-[#5A5F66]" />
                            </div>

                            <div className="space-y-4 relative">
                                <label className="text-[10px] font-black uppercase tracking-widest text-[#5A5F66] pl-4">Destination</label>
                                <input value={dest} onChange={e => searchDest(e.target.value)} placeholder="Where are they going?" className="w-full h-14 sm:h-16 bg-[#0B0E12] border border-[#007070]/20 rounded-2xl px-6 font-bold text-white focus:border-[#0D9488] outline-none transition-all placeholder-[#5A5F66]" />
                                
                                {suggestions.length > 0 && !selectedLoc && (
                                    <div className="absolute top-full left-0 right-0 bg-[#13171D] border border-[#007070]/20 rounded-2xl shadow-2xl mt-2 overflow-hidden z-50">
                                        {suggestions.map((s, i) => (
                                            <button key={i} onClick={() => { setSelectedLoc(s); setDest(s.address); setSuggestions([]); }} className="w-full p-4 sm:p-6 text-left hover:bg-[#0B0E12] border-b border-[#007070]/10 flex items-center gap-4">
                                                <MapPin size={18} className="text-[#0D9488]" />
                                                <div>
                                                    <p className="font-black text-sm text-white">{s.name}</p>
                                                    <p className="text-[10px] text-[#5A5F66] font-bold">{s.address}</p>
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                )}{selectedLoc && (
                                    <button onClick={() => setSelectedLoc(null)} className="absolute right-4 top-10 sm:top-11 p-2 bg-[#007070]/20 text-[#0D9488] rounded-lg"><CheckCircle size={16} /></button>
                                )}
                            </div>

                            <button 
                                onClick={handleDispatch}
                                disabled={loading}
                                className="w-full h-16 sm:h-20 bg-[#007070] text-white rounded-[1.5rem] font-black text-base sm:text-lg hover:scale-[1.02] active:scale-95 transition-all shadow-xl shadow-[#007070]/10 flex items-center justify-center gap-4"
                            >
                                {loading ? 'SIGNALING FLEET...' : 'CONFIRM DISPATCH'}
                            </button>
                        </div>
                    </>
                ) : (
                    <div className="text-center py-8">
                        <div className="w-20 h-20 sm:w-24 sm:h-24 bg-green-500 rounded-full mx-auto flex items-center justify-center shadow-2xl shadow-green-500/20 mb-8 border-4 border-[#13171D]">
                            <CheckCircle size={40} color="white" />
                        </div>
                        <h2 className="text-3xl sm:text-4xl font-black mb-4 italic text-white">READY FOR PICKUP</h2>
                        <p className="text-[#5A5F66] font-bold mb-10 max-w-sm mx-auto">Ride initialized. Now share the PIN and tracking link with the guest for zero cost.</p>
                        
                        <div className="space-y-4">
                            <button 
                                onClick={handleShare}
                                className="w-full h-16 sm:h-20 bg-[#25D366] text-white rounded-[1.5rem] font-black text-base sm:text-lg hover:scale-[1.02] flex items-center justify-center gap-4 transition-all shadow-xl shadow-green-500/10"
                            >
                                <Sparkles size={24} />
                                SHARE VIA WHATSAPP
                            </button>
                            <button onClick={onClose} className="text-xs font-black text-[#5A5F66] uppercase tracking-widest hover:text-white transition-all">Done</button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default App;
