import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { 
  Package, 
  MapPin, 
  CheckCircle, 
  Clock, 
  AlertTriangle, 
  LogOut, 
  Sparkles, 
  Bell, 
  ShieldCheck, 
  Users, 
  DollarSign, 
  Scan,
  PlaneTakeoff,
  ShoppingBag,
  Scissors
} from 'lucide-react';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

type MerchantMode = 'HOTEL' | 'RETAIL' | 'SERVICE' | 'AIRPORT';

interface Order {
  id: string;
  status: string;
  created_at: string;
  total_cents: number;
  rider_id: string;
  rider: { full_name: string };
  order_items: any[];
}

function App() {
  const [view, setView] = useState<'login' | 'dashboard' | 'appointments'>('login');
  const [merchant, setMerchant] = useState<any>(null);
  const [mode, setMode] = useState<MerchantMode>('SERVICE');
  const [orders, setOrders] = useState<Order[]>([]);
  const [appointments, setAppointments] = useState<any[]>([]); // Phase 8A
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(() => {
    const saved = localStorage.getItem('g_taxi_merchant_sound');
    return saved !== null ? JSON.parse(saved) : true;
  });
  const [pin, setPin] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const fileInputRef = import.meta.env.PROD ? null : { current: null }; // Mock or use ref
  const [uploading, setUploading] = useState(false);
  
  // Phase 8B: Concierge Protocol
  const [showSummonModal, setShowSummonModal] = useState(false);
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [guestDestination, setGuestDestination] = useState('');

  const [declineTimers, setDeclineTimers] = useState<Record<string, number>>({});

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        checkMerchantSession(session.user.id);
        setupRealtime(session.user.id);
      }
    });
  }, []);

  const setupRealtime = (userId: string) => {
    const channel = supabase
      .channel('merchant_notifications')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'merchant_appointments' },
        (payload) => {
          if (payload.new.merchant_id === merchant?.id) {
            handleNewAppointment(payload.new);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  };

  const handleNewAppointment = (app: any) => {
    if (app.ride_requested && app.merchant_consent_status === 'pending') {
      // 1. Play Alert Tone (if enabled)
      if (soundEnabled) {
        const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3'); 
        audio.play().catch(e => console.log("Audio play failed:", e));
      }

      // 2. Start Auto-Decline Timer (60s)
      setDeclineTimers(prev => ({ ...prev, [app.id]: 60 }));
      fetchOrders(merchant.id);
    }
  };

  // Timer Countdown Effect
  useEffect(() => {
    const interval = setInterval(() => {
      setDeclineTimers(prev => {
        const next = { ...prev };
        let changed = false;
        Object.keys(next).forEach(id => {
          if (next[id] > 0) {
            next[id] -= 1;
            changed = true;
          } else if (next[id] === 0) {
            autoDecline(id);
            delete next[id];
            changed = true;
          }
        });
        return changed ? next : prev;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [merchant]);

  const autoDecline = async (appId: string) => {
    try {
      await supabase
        .from('merchant_appointments')
        .update({ merchant_consent_status: 'denied', status: 'cancelled' })
        .eq('id', appId);
      setMsg("Appointment auto-declined due to inactivity.");
      fetchOrders(merchant.id);
    } catch (err) {
      console.error("Auto-decline failed:", err);
    }
  };

  const checkMerchantSession = async (userId: string) => {
    const { data: profile } = await supabase
      .from('profiles')
      .select('*, merchant:merchant_id(*)')
      .eq('id', userId)
      .single();

    if (profile?.merchant) {
      setMerchant(profile.merchant);
      const cat = profile.merchant.category?.toUpperCase() || 'SERVICE';
      if (cat.includes('HOTEL')) setMode('HOTEL');
      else if (cat.includes('GROCERY') || cat.includes('RETAIL')) setMode('RETAIL');
      else if (cat.includes('AIRPORT')) setMode('AIRPORT');
      else if (cat.includes('LAUNDRY')) setMode('RETAIL'); // Use retail flows for laundry manifest
      else setMode('SERVICE');
      
      setView('dashboard');
      fetchOrders(profile.merchant.id);
    } else {
      await supabase.auth.signOut();
      setView('login');
    }
  };

  const fetchOrders = async (merchantId: string) => {
    const { data } = await supabase
      .from('orders')
      .select('*, rider:rider_id(full_name), order_items(*)')
      .eq('merchant_id', merchantId)
      .order('created_at', { ascending: false });
    if (data) setOrders(data);

    // Phase 8A: Fetch Appointments
    const { data: apps } = await supabase
      .from('merchant_appointments')
      .select('*, rider:rider_id(full_name), service:service_id(name)')
      .eq('merchant_id', merchantId)
      .order('scheduled_at', { ascending: true });
    if (apps) setAppointments(apps);
  };

  const handleUpdateItem = async (itemId: string, status: string, substitutionId?: string) => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('merchant_order_picker', {
        body: { 
          action: 'update_item', 
          order_id: selectedOrder?.id, 
          item_id: itemId, 
          status,
          substitution_id: substitutionId
        }
      });
      if (error) throw error;
      setMsg(`Item marked as ${status}. Syncing with Rider...`);
      fetchOrders(merchant.id);
    } catch (err: any) {
      setMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateStatus = async (orderId: string, newStatus: string) => {
    setLoading(true);
    try {
      const { error } = await supabase
        .from('orders')
        .update({ status: newStatus })
        .eq('id', orderId);
      if (error) throw error;
      setMsg(`Status updated to ${newStatus}. Rider notified.`);
      fetchOrders(merchant.id);
    } catch (err: any) {
      setMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleWeightEntry = async (orderId: string, weightKg: number) => {
    setLoading(true);
    try {
      const surchargeCents = Math.round(weightKg * 1000);
      const { error } = await supabase.functions.invoke('update_order_price', {
        body: { order_id: orderId, weight_kg: weightKg, surcharge_cents: surchargeCents }
      });
      if (error) throw error;
      setMsg(`Weight recorded: ${weightKg}kg. Bill updated.`);
      fetchOrders(merchant.id);
    } catch (err: any) {
      setMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleTakePhoto = async (orderId: string) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (e: any) => {
      const file = e.target.files[0];
      if (!file) return;
      
      setUploading(true);
      try {
        const filePath = `${merchant.id}/${orderId}/${Date.now()}.jpg`;
        const { error: uploadError } = await supabase.storage
          .from('merchant-intake-photos')
          .upload(filePath, file);

        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = supabase.storage
          .from('merchant-intake-photos')
          .getPublicUrl(filePath);

        // Record in Trust Layer Ledger
        const { error: logError } = await supabase
          .from('merchant_intake_logs')
          .insert({
            order_id: orderId,
            merchant_id: merchant.id,
            items: selectedOrder?.order_items || [],
            photo_urls: [publicUrl]
          });

        if (logError) throw logError;
        setMsg("Intake Photo Uploaded. Trust Layer Synchronized.");
        setPhotos([publicUrl]);
      } catch (err: any) {
        setMsg(err.message);
      } finally {
        setUploading(false);
      }
    };
    input.click();
  };

  const handleSummon = async () => {
    if (!guestName || !guestPhone || !guestDestination) {
      setMsg("Please fill out all guest details.");
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('concierge_dispatch', {
        body: { 
          guest_name: guestName,
          guest_phone: guestPhone,
          destination_lat: 10.6586, // Use a dynamic fallback or geocoding service here
          destination_lng: -61.5186, 
          destination_address: guestDestination,
          vehicle_type: 'Standard'
        }
      });
      if (error) throw error;
      setMsg(`Ride summoned for ${guestName}. SMS Tracking Sent.`);
      setShowSummonModal(false);
      setGuestName('');
      setGuestPhone('');
      setGuestDestination('');
    } catch (err: any) {
      setMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleGrantConsent = async (appointmentId: string) => {
    setLoading(true);
    try {
      const { error } = await supabase
        .from('merchant_appointments')
        .update({ merchant_consent_status: 'granted' })
        .eq('id', appointmentId);
      if (error) throw error;
      
      // Trigger the actual ride creation
      await supabase.functions.invoke('process_merchant_consent', {
        body: { appointment_id: appointmentId }
      });
      
      setMsg("Permission Granted. G-Taxi dispatched to Client.");
      fetchOrders(merchant.id);
    } catch (err: any) {
      setMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (view === 'login') return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6 font-sans">
      <div className="w-full max-w-md bg-white rounded-[3rem] p-12 text-center shadow-xl border border-slate-100">
        <div className="w-24 h-24 bg-purple-600 rounded-[2rem] mx-auto flex items-center justify-center shadow-lg shadow-purple-500/20 mb-10 rotate-3">
          <ShieldCheck size={48} color="white" />
        </div>
        <h1 className="text-4xl font-black text-slate-900 mb-2 tracking-tight">G-TAXI</h1>
        <p className="text-purple-600 font-bold text-xs uppercase tracking-[0.2em] mb-12">Universal Partner Hub</p>
        
        <div className="space-y-4">
          <button 
            onClick={async () => {
              const email = window.prompt("Email:");
              const pass = window.prompt("Pass:");
              if (email && pass) {
                const { data, error } = await supabase.auth.signInWithPassword({ email, password: pass });
                if (error) alert(error.message);
                else if (data.session) checkMerchantSession(data.session.user.id);
              }
            }}
            className="w-full h-18 bg-white text-black rounded-2xl font-black text-lg hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-3"
          >
            <Scan size={20} />
            ACCESS TERMINAL
          </button>

          <button 
            onClick={() => setMsg("CEO QR SCANNER ACTIVATED. Align with Partner QR to Link.")}
            className="w-full h-14 bg-slate-50 text-purple-400 border border-purple-500/20 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-purple-500/10 transition-all flex items-center justify-center gap-3"
          >
            <Sparkles size={16} />
            CEO PARTNER ONBOARDING
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans selection:bg-purple-100">
      {/* GLOBAL HEADER */}
      <header className="h-24 border-b border-slate-200 px-10 flex items-center justify-between sticky top-0 bg-slate-50/80 backdrop-blur-3xl z-50">
        <div className="flex items-center gap-6">
          <div className="w-14 h-14 bg-purple-600 rounded-2xl flex items-center justify-center shadow-lg shadow-purple-500/20">
            {mode === 'HOTEL' && <MapPin size={28} color="white" />}
            {mode === 'RETAIL' && <ShoppingBag size={28} color="white" />}
            {mode === 'SERVICE' && <Scissors size={28} color="white" />}
            {mode === 'AIRPORT' && <PlaneTakeoff size={28} color="white" />}
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tight">{merchant?.name}</h1>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-slate-400 uppercase tracking-widest font-black">{merchant?.is_active ? 'ONLINE' : 'OFFLINE'}</span>
                <div className={`w-1.5 h-1.5 ${merchant?.is_active ? 'bg-green-500' : 'bg-red-500'} rounded-full ${merchant?.is_active ? 'animate-pulse' : ''}`} />
              </div>
              <button 
                onClick={async () => {
                  const newState = !merchant.is_active;
                  const { error } = await supabase.from('merchants').update({ is_active: newState }).eq('id', merchant.id);
                  if (!error) setMerchant({ ...merchant, is_active: newState });
                }}
                className={`text-[9px] font-black px-2 py-0.5 rounded border transition-all ${merchant?.is_active ? 'bg-red-50 text-red-500 border-red-500/20' : 'bg-green-50 text-green-500 border-green-500/20'}`}
              >
                {merchant?.is_active ? 'GO AWAY' : 'GO READY'}
              </button>
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
           <button 
            onClick={() => {
              const next = !soundEnabled;
              setSoundEnabled(next);
              localStorage.setItem('g_taxi_merchant_sound', JSON.stringify(next));
            }}
            className={`p-4 rounded-2xl border transition-all ${soundEnabled ? 'bg-purple-50 border-purple-500/20 text-purple-600' : 'bg-slate-50 border-slate-200 text-slate-400'}`}
           >
             <Bell size={20} className={soundEnabled ? 'animate-bounce' : ''} />
           </button>
           <div className="hidden md:flex flex-col items-end px-6 border-r border-slate-200">
              <span className="text-[10px] text-slate-900/20 font-black tracking-widest uppercase">Referral Credit</span>
              <span className="text-xl font-black text-green-400">$482.50 <span className="text-xs">TTD</span></span>
           </div>
           <button onClick={() => setView('login')} className="p-4 bg-slate-50 rounded-2xl border border-slate-200 hover:bg-red-500/10 transition-all">
             <LogOut size={20} className="text-slate-900/40" />
           </button>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto p-10 grid grid-cols-12 gap-10">
        
        {/* LEFT COLUMN: PRIMARY ACTION */}
        <section className="col-span-12 lg:col-span-8 space-y-10">
          
          {/* TRANSFORMER PANEL */}
          {mode === 'HOTEL' && (
            <div className="bg-gradient-to-br from-purple-600 to-indigo-700 rounded-[3.5rem] p-12 shadow-2xl relative overflow-hidden group">
               <div className="absolute top-0 right-0 p-12 opacity-10 group-hover:scale-110 transition-transform">
                  <MapPin size={200} />
               </div>
               <div className="relative z-10 max-w-lg">
                  <h2 className="text-4xl font-black mb-4 leading-tight italic text-white flex justify-between">
                    <div>VIP CONCIERGE<br/>SUMMON</div>
                    {showSummonModal && <button onClick={() => setShowSummonModal(false)} className="text-sm font-bold opacity-50 hover:opacity-100">CANCEL</button>}
                  </h2>
                  <p className="text-slate-100/70 text-lg mb-10 leading-relaxed font-medium transition-all group-hover:text-slate-100">Summon a G-Taxi vehicle for your guest instantly. No app required for guest caller.</p>
                  
                  {showSummonModal ? (
                    <div className="space-y-4 mb-6">
                      <input 
                        type="text" 
                        placeholder="Guest Name (e.g. John Doe)" 
                        value={guestName} onChange={e => setGuestName(e.target.value)}
                        className="w-full h-14 bg-white/10 text-white placeholder-white/40 border border-white/20 rounded-2xl px-6 font-bold outline-none focus:border-white transition-all"
                      />
                      <input 
                        type="tel" 
                        placeholder="Guest Mobile Number (+1868...)" 
                        value={guestPhone} onChange={e => setGuestPhone(e.target.value)}
                        className="w-full h-14 bg-white/10 text-white placeholder-white/40 border border-white/20 rounded-2xl px-6 font-bold outline-none focus:border-white transition-all"
                      />
                      <input 
                        type="text" 
                        placeholder="Destination Address" 
                        value={guestDestination} onChange={e => setGuestDestination(e.target.value)}
                        className="w-full h-14 bg-white/10 text-white placeholder-white/40 border border-white/20 rounded-2xl px-6 font-bold outline-none focus:border-white transition-all"
                      />
                      
                      <button 
                        onClick={handleSummon}
                        disabled={loading || !guestName || !guestPhone || !guestDestination}
                        className={`mt-4 w-full h-16 rounded-[1.5rem] font-black text-xl transition-all flex items-center justify-center gap-4 ${guestName && guestPhone && guestDestination ? 'bg-white text-purple-700 shadow-xl hover:scale-[1.02]' : 'bg-white/20 text-white/40'}`}
                      >
                        {loading ? 'DISPATCHING...' : 'DISPATCH TO GUEST VIA SMS'}
                      </button>
                    </div>
                  ) : (
                    <button 
                      onClick={() => setShowSummonModal(true)}
                      className="h-20 px-12 bg-white text-black rounded-[1.5rem] font-black text-xl shadow-xl hover:scale-105 active:scale-95 transition-all flex items-center gap-4"
                    >
                      <Users size={24} />
                      SUMMON G-TAXI NOW
                    </button>
                  )}
               </div>
            </div>
          )}

          {mode === 'SERVICE' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
               {/* PERMISSION TRAY */}
               <div className="bg-white shadow-sm border border-slate-200 rounded-[3rem] p-10">
                  <div className="flex items-center justify-between mb-8">
                    <div className="w-12 h-12 bg-blue-500/10 rounded-xl flex items-center justify-center border border-blue-500/20">
                       <ShieldCheck size={24} className="text-blue-400" />
                    </div>
                    <span className="text-[10px] font-black text-blue-400 bg-blue-400/10 px-3 py-1 rounded-full">ACTION REQUIRED</span>
                  </div>
                  <h3 className="text-2xl font-black mb-6">PERMISSION REQUESTS</h3>
                  <div className="space-y-4">
                     {appointments.filter(a => a.ride_requested && a.merchant_consent_status === 'pending').map(app => (
                        <div key={app.id} className="p-6 bg-blue-50/50 rounded-2xl border border-blue-100">
                           <div className="flex items-center justify-between mb-4">
                              <div>
                                 <p className="font-bold text-slate-900">{app.rider?.full_name || 'Guest'}</p>
                                 <p className="text-[10px] text-blue-400 font-bold uppercase">{app.service?.name || 'Service'}</p>
                              </div>
                              <div className="flex flex-col items-end">
                                 <span className="text-[10px] font-black opacity-30 uppercase">Auto-Cancel</span>
                                 <span className={`text-sm font-black ${declineTimers[app.id] < 15 ? 'text-red-500 animate-pulse' : 'text-blue-500'}`}>
                                    {declineTimers[app.id] ?? 60}s
                                 </span>
                              </div>
                           </div>
                           <button 
                            onClick={() => handleGrantConsent(app.id)}
                            className="w-full h-12 bg-blue-500 text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-blue-600 transition-all">
                              GRANT PICKUP PERMISSION
                           </button>
                        </div>
                     ))}
                     {appointments.filter(a => a.ride_requested && a.merchant_consent_status === 'pending').length === 0 && (
                        <div className="py-10 text-center opacity-20 italic text-sm">No Pending Permission Requests</div>
                     )}
                  </div>
               </div>

               {/* SERVICE DASHBOARD */}
               <div className="bg-white shadow-sm border border-slate-200 rounded-[3rem] p-10 flex flex-col justify-between">
                  <div>
                    <div className="w-12 h-12 bg-purple-500/10 rounded-xl flex items-center justify-center mb-6 border border-purple-500/20">
                       <Clock size={24} className="text-purple-400" />
                    </div>
                    <h3 className="text-2xl font-black mb-2 tracking-tight">TODAY'S BOOKINGS</h3>
                    <div className="space-y-3 mt-6">
                      {appointments.slice(0, 3).map(app => (
                        <div key={app.id} className="flex items-center justify-between p-4 bg-slate-50 rounded-xl">
                          <span className="font-bold text-sm">{app.rider?.full_name}</span>
                          <span className="text-[10px] bg-slate-200 px-2 py-1 rounded text-slate-500 font-bold">{new Date(app.scheduled_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <button onClick={() => setView('appointments')} className="w-full h-16 bg-slate-900 text-white font-black rounded-2xl hover:bg-black transition-all mt-8">
                    OPEN FULL CALENDAR
                  </button>
               </div>
            </div>
          )}

          {/* SHARED QUEUE HUD */}
          <div className="bg-slate-50 border border-slate-200 rounded-[3.5rem] p-10">
             <div className="flex justify-between items-center mb-10">
                <h3 className="text-sm font-black uppercase tracking-[0.2em] text-slate-900/30">Active Manifests</h3>
                <div className="flex gap-2">
                   <div className="w-2 h-2 bg-purple-500 rounded-full animate-pulse" />
                   <span className="text-[10px] font-black uppercase">Live Data</span>
                </div>
             </div>

             <div className="grid gap-6">
               {orders.map(order => (
                 <button 
                  key={order.id} 
                  onClick={() => setSelectedOrder(order)}
                  className={`p-8 rounded-3xl border transition-all flex items-center justify-between group ${selectedOrder?.id === order.id ? 'bg-white text-black border-white' : 'bg-slate-50 border-slate-200 hover:border-white/20'}`}
                 >
                   <div className="flex items-center gap-8">
                      <div className={`w-14 h-14 rounded-2xl flex items-center justify-center ${selectedOrder?.id === order.id ? 'bg-black text-slate-900' : 'bg-white/10'}`}>
                         <Package size={28} />
                      </div>
                      <div>
                        <p className={`text-[10px] font-black uppercase tracking-widest ${selectedOrder?.id === order.id ? 'text-black/40' : 'text-purple-400'}`}>{order.status}</p>
                        <h4 className="text-2xl font-black">Order #{order.id.slice(0,6)}</h4>
                      </div>
                   </div>
                   <div className="text-right">
                      <p className="text-xs opacity-40 font-bold uppercase">{new Date(order.created_at).toLocaleTimeString()}</p>
                      <p className="font-black text-lg">${(order.total_cents/100).toFixed(2)}</p>
                   </div>
                 </button>
               ))}
               {orders.length === 0 && <div className="py-20 text-center opacity-20 italic">No Active Manifests Found</div>}
             </div>
          </div>
        </section>

        {/* RIGHT COLUMN: ACTION HUD */}
        <section className="col-span-12 lg:col-span-4 translate-y-[-100px] lg:translate-y-0">
          <div className="sticky top-32">
             {!selectedOrder ? (
                <div className="bg-slate-50 border border-slate-200 rounded-[3rem] p-12 text-center">
                   <div className="w-20 h-20 bg-slate-50 rounded-full mx-auto flex items-center justify-center mb-8 border border-slate-200">
                      <CheckCircle size={32} className="text-slate-900/20" />
                   </div>
                   <h3 className="text-2xl font-black mb-4 tracking-tight uppercase">Ready for<br/>Intake</h3>
                   <p className="text-slate-900/30 text-sm leading-relaxed">System standby. Select an active manifest to begin verification protocols.</p>
                </div>
             ) : (
                <div className="bg-white shadow-sm border border-slate-200 border border-white/20 rounded-[4rem] p-12 shadow-3xl">
                   <div className="flex justify-between items-center mb-10">
                      <span className="text-[10px] font-black uppercase tracking-widest text-purple-400 bg-purple-500/10 px-3 py-1 rounded-full border border-purple-500/20">Manifest Active</span>
                      <button onClick={() => setSelectedOrder(null)} className="text-[10px] font-black uppercase tracking-widest opacity-30 hover:opacity-100 transition-opacity">Dismiss</button>
                   </div>

                   <h3 className="text-4xl font-black mb-10 leading-tight">ORDER<br/>INTAKE</h3>

                   {/* Trust Layer: Intake Photo Bridge */}
                    {mode === 'RETAIL' && (
                       <button 
                        onClick={() => handleTakePhoto(selectedOrder.id)}
                        disabled={uploading}
                        className={`w-full p-8 mb-8 ${photos.length > 0 ? 'bg-green-600/10 border-green-500/20' : 'bg-blue-600/10 border-blue-500/20'} rounded-3xl flex items-center gap-6 hover:bg-blue-600/20 transition-all group`}
                       >
                          <div className={`w-16 h-16 ${photos.length > 0 ? 'bg-green-500' : 'bg-blue-500'} rounded-2xl flex items-center justify-center group-hover:scale-110 transition-all`}>
                             {photos.length > 0 ? <CheckCircle size={28} className="text-black" /> : <Scan size={28} className="text-black" />}
                          </div>
                          <div className="flex-1 text-left">
                             <p className="text-[10px] font-black uppercase tracking-widest opacity-40 mb-1">Trust Layer</p>
                             <p className="text-xl font-bold">{uploading ? 'UPLOADING...' : (photos.length > 0 ? 'Photo Captured' : 'Take Intake Photo')}</p>
                          </div>
                          <div className={`px-4 py-2 ${photos.length > 0 ? 'bg-green-500/20' : 'bg-blue-500/20'} rounded-xl`}>
                             <span className={`${photos.length > 0 ? 'text-green-500' : 'text-blue-500'} font-black text-xs`}>{photos.length > 0 ? 'VERIFIED' : 'REQUIRED'}</span>
                          </div>
                       </button>
                    )}

                   {/* Laundry/Grocery Weight HUD */}
                   {mode === 'RETAIL' && (
                      <div className="mb-12 p-8 bg-purple-500/10 border border-purple-500/20 rounded-3xl">
                         <div className="flex items-center gap-6">
                            <div className="w-16 h-16 bg-purple-500 rounded-2xl flex items-center justify-center">
                               <Package size={28} className="text-black" />
                            </div>
                            <div className="flex-1">
                               <p className="text-[10px] font-black uppercase tracking-widest opacity-40 mb-1">Weight Intake Engine</p>
                               <p className="text-xl font-bold">Record Weight & Sync Bill</p>
                            </div>
                            <div className="flex items-center gap-2 bg-black/40 p-2 rounded-2xl border border-slate-200">
                               <input 
                                 type="number" 
                                 placeholder="KG" 
                                 className="bg-transparent text-2xl font-black w-20 text-center outline-none"
                                 onBlur={(e) => handleWeightEntry(selectedOrder.id, parseFloat(e.target.value))}
                               />
                               <span className="font-black opacity-30 mr-2">KG</span>
                            </div>
                         </div>
                      </div>
                   )}

                   {/* Status Pipeline */}
                   <div className="grid grid-cols-4 gap-4 mb-12">
                      {['RECEIVED', 'PENDING', 'PICKING', 'READY'].map((s) => (
                         <button 
                            key={s}
                            onClick={() => handleUpdateStatus(selectedOrder.id, s)}
                            className={`p-6 rounded-3xl border transition-all ${selectedOrder.status === s ? 'bg-white text-black border-white' : 'bg-slate-50 border-slate-200 opacity-40'}`}
                         >
                            <p className="text-[10px] font-black uppercase mb-1">{s}</p>
                            <div className="h-1 bg-current opacity-20 rounded-full" />
                         </button>
                      ))}
                   </div>
                   
                   <div className="space-y-4 mb-12">
                      {selectedOrder.order_items.map((item, i) => (
                         <div key={i} className={`p-5 rounded-2xl flex items-center gap-4 border transition-all ${item.picking_status === 'FOUND' ? 'bg-green-500/10 border-green-500/20' : 'bg-slate-50 border-slate-200'}`}>
                            <Package size={18} className={item.picking_status === 'FOUND' ? 'text-green-500' : 'text-slate-900/40'} />
                            <div className="flex-1">
                               <p className="font-bold">{item.product_name || 'Stock Item'}</p>
                               <p className="text-[10px] opacity-30 font-black uppercase tracking-widest">{item.picking_status || 'PENDING'}</p>
                            </div>
                            <div className="flex gap-2">
                               {item.picking_status !== 'FOUND' && (
                                  <button onClick={() => handleUpdateItem(item.id, 'FOUND')} className="p-2 bg-green-500 rounded-lg text-black hover:scale-110 transition-transform"><CheckCircle size={16} /></button>
                               )}
                               {item.picking_status === 'PENDING' && (
                                  <button onClick={() => handleUpdateItem(item.id, 'OUT')} className="p-2 bg-red-500/20 text-red-500 rounded-lg hover:bg-red-500/40 transition-colors"><AlertTriangle size={16} /></button>
                                )}
                            </div>
                         </div>
                      ))}
                   </div>

                   {/* VERIFICATION PAD */}
                   <div className="bg-white rounded-[2.5rem] p-10 -mx-4 -mb-4">
                      <h4 className="text-black font-black text-xs uppercase tracking-widest mb-6 opacity-30">Driver Verification</h4>
                      <div className="flex items-center gap-6 mb-10">
                         <div className="flex-1">
                            <p className="text-black text-lg font-black leading-tight">PIN ENTRY</p>
                            <p className="text-black/40 text-[10px] font-bold uppercase tracking-wide">Ask driver for code</p>
                         </div>
                         <input 
                           type="text" 
                           maxLength={4}
                           placeholder="0000"
                           value={pin}
                           onChange={e => setPin(e.target.value)}
                           className="w-28 h-20 bg-black/5 rounded-[1.5rem] text-center text-3xl font-black text-black border-2 border-black/5 focus:border-purple-600 outline-none transition-all shadow-inner"
                         />
                      </div>

                      <button 
                        disabled={loading || pin.length !== 4}
                        className={`w-full h-20 rounded-[1.5rem] font-black text-xl transition-all ${pin.length === 4 ? 'bg-black text-slate-900 hover:bg-neutral-800 shadow-xl' : 'bg-black/5 text-black/10'}`}
                      >
                         VERIFY HANDOFF
                      </button>
                   </div>
                </div>
             )}
          </div>
        </section>
      </main>

      {/* SYSTEM HUD FOOTER */}
      <footer className="fixed bottom-0 left-0 right-0 h-16 bg-white/90 backdrop-blur-2xl border-t border-slate-200 px-10 flex items-center justify-between">
         <div className="flex items-center gap-10">
            <div className="flex items-center gap-3">
               <div className="w-2 h-2 bg-green-500 rounded-full" />
               <span className="text-[10px] font-black uppercase tracking-widest text-slate-900/40 italic">System Ready: 868_NODE_POS</span>
            </div>
            <div className="hidden sm:flex items-center gap-3">
               <Clock size={12} className="text-slate-900/20" />
               <span className="text-[10px] font-black uppercase tracking-widest text-slate-900/40 uppercase">{new Date().toLocaleDateString()}</span>
            </div>
         </div>
         <div className="text-[10px] font-black text-purple-500 uppercase tracking-[0.3em]">G-TAXI MERCHANT v1.1.0</div>
      </footer>
    </div>
  );
}

export default App;

