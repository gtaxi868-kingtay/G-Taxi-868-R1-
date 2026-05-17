import { useEffect, useState } from 'react';
import { supabase } from './lib/supabase'; // Using the standard lib
import { 
  Package, MapPin, CheckCircle, Clock, AlertTriangle, LogOut, 
  Sparkles, Bell, ShieldCheck, Users, DollarSign, Scan,
  PlaneTakeoff, ShoppingBag, Scissors, CreditCard
} from 'lucide-react';
import { MerchantFinancials } from './pages/MerchantFinancials';

type MerchantMode = 'HOTEL' | 'RETAIL' | 'SERVICE' | 'AIRPORT';
type MerchantView = 'dashboard' | 'appointments' | 'financials';

function App() {
  const [view, setView] = useState<'login' | 'app'>('login');
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

  const setupRealtime = (mId: string) => {
    supabase.channel('merchant_ops')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders', filter: `merchant_id=eq.${mId}` }, 
        () => { if(soundEnabled) playChime(); fetchData(mId); })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'merchant_appointments', filter: `merchant_id=eq.${mId}` }, 
        () => { if(soundEnabled) playChime(); fetchData(mId); })
      .subscribe();
  };

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

  useEffect(() => { checkSession(); }, []);

  if (view === 'login') return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6 text-slate-900">
      <div className="w-full max-w-md bg-white rounded-[3.5rem] p-12 text-center shadow-2xl border border-slate-100">
        <div className="w-24 h-24 bg-purple-600 rounded-[2rem] mx-auto flex items-center justify-center shadow-xl mb-12 rotate-3">
          <ShieldCheck size={48} color="white" />
        </div>
        <h1 className="text-4xl font-black text-slate-900 mb-2 italic">G-TAXI</h1>
        <p className="text-purple-600 font-black text-[10px] uppercase tracking-[0.3em] mb-12">Universal Partner Terminal</p>
        <button 
          onClick={async () => {
            const email = window.prompt("Partner Email:");
            const pass = window.prompt("Security Key:");
            if (email && pass) {
              const { error } = await supabase.auth.signInWithPassword({ email, password: pass });
              if (error) alert(error.message); else checkSession();
            }
          }}
          className="w-full h-20 bg-slate-950 text-white rounded-[1.5rem] font-black text-lg hover:scale-[1.02] transition-all flex items-center justify-center gap-4"
        >
          <Scan size={24} />
          AUTHORIZE SESSION
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans selection:bg-purple-100">
      {/* SIDEBAR NAVIGATION */}
      <div className="fixed left-0 top-0 bottom-0 w-80 bg-white border-r border-slate-200 p-8 flex flex-col z-50">
          <div className="flex items-center gap-4 mb-16">
              <div className="w-12 h-12 bg-purple-600 rounded-2xl flex items-center justify-center shadow-lg shadow-purple-500/20">
                <Sparkles size={24} color="white" />
              </div>
              <div>
                  <h2 className="font-black text-xl tracking-tight">G-TAXI</h2>
                  <p className="text-[9px] font-black text-slate-300 uppercase tracking-widest">Partner Hub</p>
              </div>
          </div>

          <nav className="flex-1 space-y-3">
              <MerchantNavItem active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} icon={<Package size={20}/>} label="Live Manifests" />
              <MerchantNavItem active={activeTab === 'appointments'} onClick={() => setActiveTab('appointments')} icon={<Clock size={20}/>} label="Guest Schedule" />
              <MerchantNavItem active={activeTab === 'financials'} onClick={() => setActiveTab('financials')} icon={<CreditCard size={20}/>} label="Financial Audit" />
          </nav>

          <div className="mt-auto space-y-4">
            <button 
              onClick={() => { setSoundEnabled(!soundEnabled); localStorage.setItem('g_taxi_merchant_sound', (!soundEnabled).toString()); }}
              className="w-full h-12 flex items-center justify-center gap-2 rounded-xl border border-slate-100 text-slate-400 font-bold text-[10px] uppercase tracking-widest hover:bg-slate-50 transition-all"
            >
              {soundEnabled ? <Bell size={14} className="text-purple-500" /> : <Bell size={14} />}
              SOUND: {soundEnabled ? 'ON' : 'OFF'}
            </button>
            <button 
              onClick={() => supabase.auth.signOut().then(() => setView('login'))}
              className="w-full h-14 flex items-center justify-center gap-3 rounded-2xl border border-red-100 text-red-500 font-black text-xs uppercase tracking-widest hover:bg-red-50 transition-all"
            >
              <LogOut size={18} />
              END SESSION
            </button>
          </div>
      </div>

      <main className="pl-80 p-12 min-h-screen">
          <header className="flex justify-between items-center mb-16">
              <div>
                  <h1 className="text-4xl font-black tracking-tight">{merchant?.name}</h1>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-[0.3em] mt-2 italic">{mode} OPERATIONS COMMAND</p>
              </div>
              <div className="flex items-center gap-6">
                  <div className="bg-white border border-slate-200 px-6 py-3 rounded-full flex items-center gap-3">
                      <div className={`w-2 h-2 ${merchant?.is_active ? 'bg-green-500' : 'bg-red-500'} rounded-full animate-pulse`} />
                      <span className="text-[10px] font-black uppercase text-slate-400 tracking-widest">{merchant?.is_active ? 'Online' : 'Diverted'}</span>
                  </div>
              </div>
          </header>

          <div className="max-w-6xl">
              {activeTab === 'dashboard' && (
                  <div className="grid grid-cols-1 gap-12">
                      {mode === 'HOTEL' && (
                          <div className="bg-gradient-to-br from-indigo-600 to-purple-700 p-12 rounded-[3.5rem] text-white shadow-2xl relative overflow-hidden group">
                              <div className="relative z-10">
                                  <h3 className="text-3xl font-black mb-4 italic">VIP GUEST SUMMON</h3>
                                  <p className="max-w-md text-white/70 mb-10 font-medium">Instantly dispatch a G-Taxi to your front door for arriving or departing guests.</p>
                                  <button onClick={() => setShowDispatch(true)} className="h-18 px-10 bg-white text-purple-700 rounded-2xl font-black text-lg shadow-xl hover:scale-105 transition-all flex items-center gap-4">
                                      <Users size={24} /> DISPATCH NOW
                                  </button>
                              </div>
                              <MapPin className="absolute top-0 right-0 p-12 opacity-10 rotate-12" size={300} />
                          </div>
                      )}

                      <div className="space-y-6">
                        <h3 className="text-xs font-black text-slate-300 uppercase tracking-[0.4em] mb-8">Incoming Manifests</h3>
                        {orders.length === 0 ? (
                            <div className="py-20 text-center bg-white border border-dashed border-slate-200 rounded-[2.5rem]">
                                <Package className="mx-auto text-slate-200 mb-4" size={48} />
                                <p className="text-slate-400 font-bold uppercase text-[10px] tracking-widest">No Active Logistics</p>
                            </div>
                        ) : orders.map(order => (
                            <div key={order.id} className="bg-white p-8 rounded-[2.5rem] border border-slate-200 flex items-center justify-between hover:border-purple-500/20 transition-all shadow-sm">
                                <div className="flex items-center gap-8">
                                    <div className="w-14 h-14 bg-slate-50 rounded-2xl flex items-center justify-center border border-slate-100">
                                        {mode === 'RETAIL' ? <ShoppingBag className="text-purple-400" /> : <Package className="text-slate-400" />}
                                    </div>
                                    <div>
                                        <p className="text-[9px] font-black text-purple-600 uppercase tracking-widest">{order.status}</p>
                                        <h4 className="text-xl font-black">Order #{order.id.slice(0,6).toUpperCase()}</h4>
                                        <p className="text-xs font-bold text-slate-400">{order.rider?.full_name} · {order.order_items?.length} items</p>
                                    </div>
                                </div>
                                <button onClick={() => setSelectedOrder(order)} className="h-12 px-6 bg-slate-900 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-black transition-all">MANIFEST DETAIL</button>
                            </div>
                        ))}
                      </div>
                  </div>
              )}

              {activeTab === 'appointments' && (
                  <div className="space-y-6">
                      <h3 className="text-xs font-black text-slate-300 uppercase tracking-[0.4em] mb-8">Client Service Schedule</h3>
                      {appointments.length === 0 ? (
                          <div className="py-20 text-center bg-white border border-dashed border-slate-200 rounded-[2.5rem]">
                              <Clock className="mx-auto text-slate-200 mb-4" size={48} />
                              <p className="text-slate-400 font-bold uppercase text-[10px] tracking-widest">Schedule Empty</p>
                          </div>
                      ) : appointments.map(app => (
                          <div key={app.id} className="bg-white p-8 rounded-[2.5rem] border border-slate-200 flex items-center justify-between hover:shadow-xl transition-all">
                              <div className="flex items-center gap-8">
                                  <div className="w-14 h-14 bg-purple-50 rounded-2xl flex items-center justify-center border border-purple-100">
                                      <Scissors className="text-purple-600" />
                                  </div>
                                  <div>
                                      <p className="text-[9px] font-black text-purple-600 uppercase tracking-widest">{new Date(app.scheduled_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {app.merchant_consent_status}</p>
                                      <h4 className="text-xl font-black">{app.rider?.full_name}</h4>
                                      <p className="text-xs font-bold text-slate-400">{app.service?.name}</p>
                                  </div>
                              </div>
                              {app.merchant_consent_status === 'pending' && (
                                  <button onClick={() => setSelectedAppointment(app)} className="h-12 px-8 bg-purple-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest shadow-lg shadow-purple-500/20">MANAGE</button>
                              )}
                          </div>
                      ))}
                  </div>
              )}

              {activeTab === 'financials' && <MerchantFinancials merchantId={merchant?.id} />}
          </div>

          {/* OVERLAYS */}
          {showDispatch && (
              <DispatchModal merchant={merchant} onClose={() => { setShowDispatch(false); setDispatchResult(null); }} onSuccess={(res: any) => { setDispatchResult(res); fetchData(merchant.id); }} result={dispatchResult} />
          )}

          {selectedOrder && (
              <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[100] flex items-center justify-end p-6">
                  <div className="bg-white w-full max-w-xl h-full rounded-[3.5rem] p-12 shadow-2xl relative overflow-y-auto animate-in slide-in-from-right duration-500">
                      <button onClick={() => setSelectedOrder(null)} className="absolute top-12 right-12 text-slate-300 hover:text-slate-900 transition-colors"><CheckCircle size={32} /></button>
                      <h2 className="text-4xl font-black mb-2 italic">MANIFEST</h2>
                      <p className="text-slate-400 text-sm font-bold mb-12 uppercase tracking-widest">Order #{selectedOrder.id.toUpperCase()}</p>
                      
                      <div className="space-y-8">
                          <div className="bg-slate-50 p-8 rounded-3xl border border-slate-100">
                              <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-6">PICKING LIST</h4>
                              <div className="space-y-4">
                                {selectedOrder.order_items?.map((item: any) => (
                                    <div key={item.id} className={`p-4 rounded-2xl border transition-all ${item.picking_status === 'FOUND' ? 'bg-green-50 border-green-100' : item.picking_status === 'OUT' ? 'bg-red-50 border-red-100' : 'bg-white border-slate-100'}`}>
                                        <div className="flex items-center justify-between mb-4">
                                            <div className="flex items-center gap-4">
                                                <div className="w-8 h-8 bg-slate-900 text-white rounded-lg flex items-center justify-center text-xs font-black">{item.quantity}x</div>
                                                <span className="font-bold text-slate-900">{item.product_name || 'Item'}</span>
                                            </div>
                                            <span className="font-black text-purple-600">${(item.unit_price_cents/100).toFixed(2)}</span>
                                        </div>
                                        
                                        <div className="flex gap-2">
                                            <button 
                                                onClick={async () => {
                                                    const { error } = await supabase.from('order_items').update({ picking_status: 'FOUND' }).eq('id', item.id);
                                                    if (!error) fetchData(merchant.id);
                                                }}
                                                className={`flex-1 h-10 rounded-xl font-black text-[9px] uppercase tracking-widest transition-all ${item.picking_status === 'FOUND' ? 'bg-green-500 text-white' : 'bg-white border border-slate-200 text-slate-400 hover:bg-green-50'}`}
                                            >
                                                FOUND
                                            </button>
                                            <button 
                                                onClick={async () => {
                                                    const { error } = await supabase.from('order_items').update({ picking_status: 'OUT' }).eq('id', item.id);
                                                    if (!error) fetchData(merchant.id);
                                                }}
                                                className={`flex-1 h-10 rounded-xl font-black text-[9px] uppercase tracking-widest transition-all ${item.picking_status === 'OUT' ? 'bg-red-500 text-white' : 'bg-white border border-slate-200 text-slate-400 hover:bg-red-50'}`}
                                            >
                                                OUT OF STOCK
                                            </button>
                                        </div>
                                    </div>
                                ))}
                              </div>
                          </div>
                          
                          <div className="p-8 bg-purple-50 rounded-3xl border border-purple-100">
                             <div className="flex justify-between items-center mb-2">
                                <span className="text-[10px] font-black text-purple-400 uppercase tracking-widest">Total Valuation</span>
                                <span className="text-2xl font-black text-purple-600">${(selectedOrder.total_price_cents/100).toFixed(2)}</span>
                             </div>
                             <p className="text-[9px] font-bold text-purple-300 uppercase tracking-widest italic">All prices in TTD · Includes VAT</p>
                          </div>

                          <button onClick={async () => {
                              await supabase.from('orders').update({ status: 'ready' }).eq('id', selectedOrder.id);
                              setSelectedOrder(null);
                              fetchData(merchant.id);
                          }} className="w-full h-20 bg-slate-900 text-white rounded-[1.5rem] font-black text-lg shadow-2xl shadow-slate-900/20 hover:scale-[1.02] active:scale-95 transition-all">MARK AS READY FOR PICKUP</button>
                      </div>
                  </div>
              </div>
          )}

          {selectedAppointment && (
              <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[100] flex items-center justify-center p-6">
                  <div className="bg-white w-full max-w-md rounded-[3.5rem] p-12 text-center shadow-2xl relative animate-in zoom-in-95">
                      <h3 className="text-3xl font-black mb-4 italic">APPOINTMENT</h3>
                      <p className="text-slate-400 font-bold mb-10">{selectedAppointment.rider?.full_name} for {selectedAppointment.service?.name}</p>
                      <div className="grid grid-cols-2 gap-4">
                          <button onClick={() => updateAppointment(selectedAppointment.id, 'rejected')} className="h-16 border border-slate-100 text-slate-400 font-black rounded-2xl uppercase tracking-widest text-xs hover:bg-red-50 hover:text-red-500 transition-all">Decline</button>
                          <button onClick={() => updateAppointment(selectedAppointment.id, 'approved')} className="h-16 bg-purple-600 text-white font-black rounded-2xl uppercase tracking-widest text-xs shadow-xl shadow-purple-500/20">Approve</button>
                      </div>
                  </div>
              </div>
          )}
      </main>

      <footer className="fixed bottom-0 left-80 right-0 h-12 bg-white/80 backdrop-blur-xl border-t border-slate-200 px-10 flex items-center justify-between">
          <div className="flex items-center gap-8">
              <span className="text-[9px] font-black text-slate-300 uppercase tracking-widest italic">NODE_868_POS_ACTIVE</span>
              <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 bg-green-500 rounded-full" />
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Quantum Link Secure</span>
              </div>
          </div>
          <span className="text-[9px] font-black text-purple-500 uppercase tracking-[0.4em]">G-TAXI PARTNER SUITE v1.2</span>
      </footer>
    </div>
  );
}

const MerchantNavItem = ({ active, onClick, icon, label }: any) => (
  <button 
    onClick={onClick}
    className={`w-full h-16 px-6 flex items-center gap-5 rounded-2xl transition-all ${active ? 'bg-slate-900 text-white shadow-xl' : 'text-slate-400 hover:bg-slate-50 hover:text-slate-900'}`}
  >
    <div className={active ? 'text-white' : 'text-slate-300'}>{icon}</div>
    <span className="text-xs font-black uppercase tracking-widest">{label}</span>
  </button>
);

// --- COMPONENTS ---

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
            const { data, error } = await supabase.functions.invoke('concierge_dispatch', {
                body: {
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
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-md z-[100] flex items-center justify-center p-6">
            <div className="bg-white w-full max-w-xl rounded-[3rem] p-12 shadow-2xl animate-in zoom-in-95 duration-300 relative">
                <button onClick={onClose} className="absolute top-8 right-8 text-slate-300 hover:text-slate-900"><AlertTriangle size={24} /></button>
                
                {!result ? (
                    <>
                        <h2 className="text-3xl font-black mb-2 italic">GUEST SUMMON</h2>
                        <p className="text-slate-400 text-sm font-bold mb-10 uppercase tracking-widest">Node: {merchant?.name}</p>
                        
                        <div className="space-y-6">
                            <div className="space-y-4">
                                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 pl-4">Guest Information</label>
                                <input value={name} onChange={e => setName(e.target.value)} placeholder="Full Name" className="w-full h-16 bg-slate-50 border border-slate-100 rounded-2xl px-6 font-bold focus:border-purple-500 outline-none transition-all" />
                                <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Phone (e.g. +1868...)" className="w-full h-16 bg-slate-50 border border-slate-100 rounded-2xl px-6 font-bold focus:border-purple-500 outline-none transition-all" />
                            </div>

                            <div className="space-y-4 relative">
                                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 pl-4">Destination</label>
                                <input value={dest} onChange={e => searchDest(e.target.value)} placeholder="Where are they going?" className="w-full h-16 bg-slate-50 border border-slate-100 rounded-2xl px-6 font-bold focus:border-purple-500 outline-none transition-all" />
                                
                                {suggestions.length > 0 && !selectedLoc && (
                                    <div className="absolute top-full left-0 right-0 bg-white border border-slate-100 rounded-2xl shadow-2xl mt-2 overflow-hidden z-50">
                                        {suggestions.map((s, i) => (
                                            <button key={i} onClick={() => { setSelectedLoc(s); setDest(s.address); setSuggestions([]); }} className="w-full p-6 text-left hover:bg-slate-50 border-b border-slate-50 flex items-center gap-4">
                                                <MapPin size={18} className="text-purple-400" />
                                                <div>
                                                    <p className="font-black text-sm">{s.name}</p>
                                                    <p className="text-[10px] text-slate-400 font-bold">{s.address}</p>
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                )}{selectedLoc && (
                                    <button onClick={() => setSelectedLoc(null)} className="absolute right-4 top-11 p-2 bg-purple-100 text-purple-600 rounded-lg"><CheckCircle size={16} /></button>
                                )}
                            </div>

                            <button 
                                onClick={handleDispatch}
                                disabled={loading}
                                className="w-full h-20 bg-slate-900 text-white rounded-[1.5rem] font-black text-lg hover:scale-[1.02] active:scale-95 transition-all shadow-xl shadow-slate-900/10 flex items-center justify-center gap-4"
                            >
                                {loading ? 'SIGNALING FLEET...' : 'CONFIRM DISPATCH'}
                            </button>
                        </div>
                    </>
                ) : (
                    <div className="text-center py-8">
                        <div className="w-24 h-24 bg-green-500 rounded-full mx-auto flex items-center justify-center shadow-2xl shadow-green-500/20 mb-8 border-4 border-white">
                            <CheckCircle size={48} color="white" />
                        </div>
                        <h2 className="text-4xl font-black mb-4 italic">READY FOR PICKUP</h2>
                        <p className="text-slate-400 font-bold mb-10 max-w-sm mx-auto">Ride initialized. Now share the PIN and tracking link with the guest for zero cost.</p>
                        
                        <div className="space-y-4">
                            <button 
                                onClick={handleShare}
                                className="w-full h-20 bg-[#25D366] text-white rounded-[1.5rem] font-black text-lg hover:scale-[1.02] flex items-center justify-center gap-4 transition-all shadow-xl shadow-green-500/10"
                            >
                                <Sparkles size={24} />
                                SHARE VIA WHATSAPP
                            </button>
                            <button onClick={onClose} className="text-xs font-black text-slate-300 uppercase tracking-widest hover:text-slate-900 transition-all">Done</button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default App;

