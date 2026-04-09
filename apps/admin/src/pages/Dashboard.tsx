import { DriverMap } from '../components/DriverMap';
import { Activity, Zap, ShieldAlert, TrendingUp } from 'lucide-react';

export const Dashboard = ({ rides, stats }: any) => {
    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* REALTIME MAP HUD */}
            <div className="bg-white/5 border border-white/10 rounded-[3rem] overflow-hidden shadow-2xl relative h-[500px]">
                <div className="absolute top-8 left-8 z-10 space-y-3">
                    <div className="bg-black/60 backdrop-blur-xl border border-white/10 rounded-2xl p-4 flex items-center gap-4">
                        <div className="w-3 h-3 bg-cyan-400 rounded-full animate-ping" />
                        <div>
                            <p className="text-[10px] font-black text-white/40 uppercase tracking-widest">Global Telemetry</p>
                            <p className="text-sm font-black text-white">Live Fleet Active</p>
                        </div>
                    </div>
                </div>
                <div className="absolute top-8 right-8 z-10">
                    <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-2xl p-4 flex gap-6">
                        <MiniStat icon={<Zap size={14} className="text-yellow-400" />} label="Avg. Wait" value="4.2m" />
                        <MiniStat icon={<ShieldAlert size={14} className="text-red-400" />} label="Active SOS" value="0" />
                    </div>
                </div>
                <DriverMap />
            </div>

            {/* LIVE FEED GRID */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 bg-white/5 border border-white/10 rounded-[2.5rem] p-8">
                   <div className="flex justify-between items-center mb-8">
                      <h2 className="font-orbitron text-xs font-black tracking-[0.3em] text-white/40 uppercase">Operational Velocity</h2>
                      <TrendingUp className="text-cyan-400" size={18} />
                   </div>
                   <div className="space-y-4">
                       {rides.slice(0, 5).map((ride: any) => (
                           <div key={ride.id} className="flex items-center justify-between p-4 bg-white/[0.02] border border-white/5 rounded-2xl">
                               <div className="flex items-center gap-4">
                                  <div className="w-10 h-10 bg-white/5 rounded-xl flex items-center justify-center border border-white/5">
                                     <Activity size={16} className="text-white/40" />
                                  </div>
                                  <div>
                                     <p className="text-xs font-black text-white">{ride.pickup_address.split(',')[0]}</p>
                                     <p className="text-[9px] text-white/20 font-bold uppercase tracking-tighter">Event Trace #{ride.id.slice(0,6)}</p>
                                  </div>
                               </div>
                               <div className="text-right">
                                  <p className="text-[10px] font-black text-cyan-400 uppercase tracking-widest">{ride.status}</p>
                                  <p className="text-[9px] text-white/20 mt-1">{new Date(ride.created_at).toLocaleTimeString()}</p>
                               </div>
                           </div>
                       ))}
                   </div>
                </div>

                <div className="bg-gradient-to-br from-purple-500/20 to-blue-500/20 border border-white/20 rounded-[2.5rem] p-10 flex flex-col justify-between overflow-hidden relative">
                   <div className="relative z-10">
                      <h3 className="text-2xl font-black text-white mb-2 italic">G-TAXI<br/>ELITE AI</h3>
                      <p className="text-[10px] font-black text-white/40 uppercase tracking-[0.2em] mb-8">Dynamic Pricing & Demand</p>
                      
                      <div className="space-y-6">
                         <div className="flex justify-between border-b border-white/10 pb-4">
                            <span className="text-[10px] font-black text-white/40 uppercase">Surge Multiplier</span>
                            <span className="text-sm font-black text-cyan-400">1.25x</span>
                         </div>
                         <div className="flex justify-between border-b border-white/10 pb-4">
                            <span className="text-[10px] font-black text-white/40 uppercase">Active Clusters</span>
                            <span className="text-sm font-black text-white">4 Sites</span>
                         </div>
                      </div>
                   </div>
                   <button className="relative z-10 mt-12 w-full h-14 bg-white text-black rounded-2xl font-black text-xs uppercase tracking-widest hover:scale-[1.02] transition-all">MANAGE AI POLICY</button>
                   <div className="absolute -bottom-10 -right-10 opacity-10">
                      <Zap size={200} className="text-white" />
                   </div>
                </div>
            </div>
        </div>
    );
};

const MiniStat = ({ icon, label, value }: any) => (
    <div className="flex items-center gap-3">
        <div className="p-2 bg-white/5 rounded-lg border border-white/10">{icon}</div>
        <div>
            <p className="text-[8px] font-black text-white/20 uppercase tracking-widest">{label}</p>
            <p className="text-xs font-black text-white">{value}</p>
        </div>
    </div>
);
