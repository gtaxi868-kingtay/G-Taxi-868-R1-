import { useEffect, useState } from 'react';
import { supabase, adminFetch } from '../lib/supabase';
import { AlertTriangle, Radio, ShieldAlert, MapPin, User, CheckCircle, X, RefreshCw, Phone, MessageSquare } from 'lucide-react';

interface RescueAlert {
    id: string;
    event_type: string;
    tag_uid: string;
    profile_id: string;
    location_context: any;
    result_payload: any;
    created_at: string;
    reporter_name?: string;
}

interface TripRescue {
    ride_id: string;
    rider_name: string;
    rider_phone: string | null;
    status: string;
    created_at: string;
    pickup_address: string;
    dropoff_address: string;
}

export function RescueScreen() {
    const [alerts, setAlerts] = useState<RescueAlert[]>([]);
    const [tripRescues, setTripRescues] = useState<TripRescue[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'nodes' | 'trips'>('nodes');
    const [selectedAlert, setSelectedAlert] = useState<RescueAlert | null>(null);

    useEffect(() => {
        loadData();
        const channel = supabase
            .channel('rescue-alerts')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'nfc_event_logs' }, loadData)
            .subscribe();
        return () => { supabase.removeChannel(channel); };
    }, []);

    const loadData = async () => {
        setLoading(true);
        try {
            // A ride needs rescuing when it is STUCK: still searching after
            // 5 minutes, or assigned/arrived for over 45 minutes. (This list
            // used to be the last 20 finished rides, each painted as an
            // incident.)
            const result = await adminFetch('admin', { action: 'get_rides' });
            const now = Date.now();
            const ageMin = (r: any) => (now - new Date(r.updated_at || r.created_at).getTime()) / 60000;
            const stuck = (result?.data || []).filter((r: any) =>
                (r.status === 'searching' && ageMin(r) > 5) ||
                (['assigned', 'arrived'].includes(r.status) && ageMin(r) > 45)
            ).slice(0, 20);
            const riderIds = Array.from(new Set(stuck.map((r: any) => r.rider_id).filter(Boolean)));
            const people: Record<string, any> = {};
            if (riderIds.length) {
                const { data } = await supabase.rpc('admin_user_names', { p_ids: riderIds });
                for (const p of (data || []) as any[]) people[p.id] = p;
            }
            setTripRescues(stuck.map((r: any) => ({
                ride_id: r.id,
                rider_name: people[r.rider_id]?.full_name || 'Unknown',
                rider_phone: people[r.rider_id]?.phone_number || null,
                status: r.status,
                created_at: r.created_at,
                pickup_address: r.pickup_address || '—',
                dropoff_address: r.dropoff_address || '—',
            })));

            const { data: eventLogs } = await supabase
                .from('nfc_event_logs')
                .select('*')
                .in('event_type', ['BROKEN_NODE', 'TRIP_RESCUE'])
                .order('created_at', { ascending: false })
                .limit(50);

            if (eventLogs) {
                const open = eventLogs.filter((l: any) => !l.result_payload?.resolved);
                const ids = Array.from(new Set(open.map((l: any) => l.profile_id).filter(Boolean)));
                const names: Record<string, string> = {};
                if (ids.length) {
                    const { data } = await supabase.rpc('admin_user_names', { p_ids: ids });
                    for (const p of (data || []) as any[]) names[p.id] = p.full_name;
                }
                setAlerts(open.map((log: any) => ({ ...log, reporter_name: names[log.profile_id] || 'Unknown' })));
            }
        } catch (err) {
            console.error('Rescue load error:', err);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="space-y-8">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h2 className="text-2xl sm:text-3xl font-black text-white italic tracking-tight">RESCUE COMMAND</h2>
                    <p className="text-xs font-medium text-white/20 uppercase tracking-[0.4em] mt-1">Incident Response // Maintenance & Trip Recovery</p>
                </div>
                <button
                    onClick={loadData}
                    className="h-12 px-6 rounded-xl bg-white/5 border border-white/10 text-white/50 font-black text-xs uppercase tracking-widest hover:bg-white/10 transition-all flex items-center gap-3"
                >
                    <RefreshCw size={16} /> Refresh
                </button>
            </div>

            {/* Tab Switcher */}
            <div className="flex gap-2 bg-white/5 rounded-2xl p-1.5 w-fit">
                <button
                    onClick={() => setActiveTab('nodes')}
                    className={`px-6 py-3 rounded-xl font-black text-xs uppercase tracking-widest transition-all ${activeTab === 'nodes' ? 'bg-amber-500/20 text-amber-400' : 'text-white/30 hover:text-white/50'}`}
                >
                    <Radio size={14} className="inline mr-2" />Broken Nodes
                </button>
                <button
                    onClick={() => setActiveTab('trips')}
                    className={`px-6 py-3 rounded-xl font-black text-xs uppercase tracking-widest transition-all ${activeTab === 'trips' ? 'bg-red-500/20 text-red-400' : 'text-white/30 hover:text-white/50'}`}
                >
                    <ShieldAlert size={14} className="inline mr-2" />Trip Rescue
                </button>
            </div>

            {loading ? (
                <div className="py-32 text-center">
                    <div className="w-12 h-12 border-4 border-amber-400 border-t-transparent rounded-full animate-spin mx-auto mb-6" />
                    <p className="text-white/30 font-mono text-sm">Scanning for alerts...</p>
                </div>
            ) : activeTab === 'nodes' ? (
                /* Broken Node Alerts */
                alerts.length === 0 ? (
                    <div className="py-32 text-center bg-white/[0.02] rounded-[2rem] border border-dashed border-white/5">
                        <Radio size={48} className="mx-auto mb-4 text-white/40" />
                        <p className="text-white/60 font-black text-xs">All nodes operational</p>
                        <p className="text-white/40 text-sm mt-2">No broken node reports at this time.</p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {alerts.map(alert => (
                            <div
                                key={alert.id}
                                className="rounded-[1.5rem] border border-amber-500/20 bg-amber-500/5 p-6 hover:bg-amber-500/10 transition-all cursor-pointer"
                                onClick={() => setSelectedAlert(selectedAlert?.id === alert.id ? null : alert)}
                            >
                                <div className="flex items-start justify-between mb-3">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center">
                                            <AlertTriangle size={20} className="text-red-400" />
                                        </div>
                                        <div>
                                            <h3 className="text-white font-black text-sm">{alert.event_type.replace('_', ' ')}</h3>
                                            <p className="text-[10px] font-mono text-white/30">
                                                {new Date(alert.created_at).toLocaleString()}
                                            </p>
                                        </div>
                                    </div>
                                    <span className="px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-[10px] font-black text-amber-400 uppercase tracking-wider">Open</span>
                                </div>

                                <div className="flex flex-wrap gap-4 text-xs">
                                    <span className="text-white/50"><span className="text-white/30 font-mono">Tag:</span> {alert.tag_uid?.slice(0, 20)}</span>
                                    <span className="text-white/50"><span className="text-white/30 font-mono">Reporter:</span> {alert.reporter_name}</span>
                                    <span className="text-white/50"><span className="text-white/30 font-mono">Type:</span> {alert.location_context?.issue_type || '—'}</span>
                                </div>

                                {selectedAlert?.id === alert.id && (
                                    <div className="mt-4 pt-4 border-t border-white/10 space-y-4">
                                        <div className="bg-white/5 rounded-xl p-4">
                                            <p className="text-[10px] font-black text-white/20 uppercase tracking-widest mb-2">Description</p>
                                            <p className="text-sm text-white/70">{alert.location_context?.description || 'No description provided.'}</p>
                                        </div>
                                        {alert.location_context?.node_id && (
                                            <div className="bg-white/5 rounded-xl p-4">
                                                <p className="text-[10px] font-black text-white/20 uppercase tracking-widest mb-2">Node ID</p>
                                                <p className="text-sm font-mono text-cyan-400">{alert.location_context.node_id}</p>
                                            </div>
                                        )}
                                        <button
                                            onClick={async () => {
                                                const { data: { user } } = await supabase.auth.getUser();
                                                const { error } = await supabase.from('nfc_event_logs')
                                                    .update({ result_payload: { ...(alert.result_payload || {}), resolved: true, resolved_by: user?.id, resolved_at: new Date().toISOString() } })
                                                    .eq('id', alert.id);
                                                if (error) { window.alert('Could not resolve: ' + error.message); return; }
                                                setSelectedAlert(null);
                                                loadData();
                                            }}
                                            className="h-12 px-6 rounded-xl bg-green-500/10 border border-green-500/20 text-green-400 font-black text-[10px] uppercase tracking-widest hover:bg-green-500/20 transition-all"
                                        >
                                            Mark Resolved
                                        </button>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )
            ) : (
                /* Trip Rescue */
                <div className="space-y-4">
                    {tripRescues.map(trip => (
                        <div key={trip.ride_id} className="rounded-[1.5rem] border border-red-500/20 bg-red-500/5 p-6">
                            <div className="flex items-start justify-between mb-3">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center">
                                        <ShieldAlert size={20} className="text-red-400" />
                                    </div>
                                    <div>
                                        <h3 className="text-white font-black text-sm">Trip #{trip.ride_id.slice(0, 8).toUpperCase()}</h3>
                                        <p className="text-[10px] font-mono text-white/30">{new Date(trip.created_at).toLocaleString()}</p>
                                    </div>
                                </div>
                                <span className="px-3 py-1 rounded-full bg-red-500/10 border border-red-500/20 text-[10px] font-black text-red-400 uppercase tracking-wider">
                                    {trip.status}
                                </span>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                                <div className="bg-white/5 rounded-xl p-3 flex items-center gap-3">
                                    <MapPin size={14} className="text-cyan-400/60" />
                                    <div>
                                        <p className="text-[9px] font-black text-white/20 uppercase tracking-widest">Pickup</p>
                                        <p className="text-sm text-white/70">{trip.pickup_address}</p>
                                    </div>
                                </div>
                                <div className="bg-white/5 rounded-xl p-3 flex items-center gap-3">
                                    <MapPin size={14} className="text-red-400/60" />
                                    <div>
                                        <p className="text-[9px] font-black text-white/20 uppercase tracking-widest">Dropoff</p>
                                        <p className="text-sm text-white/70">{trip.dropoff_address}</p>
                                    </div>
                                </div>
                            </div>

                            <div className="flex items-center gap-2 mb-4">
                                <User size={14} className="text-white/30" />
                                <span className="text-sm text-white/50">{trip.rider_name}</span>
                            </div>

                            <div className="flex gap-3">
                                <button
                                    disabled={!trip.rider_phone}
                                    title={trip.rider_phone ? `Call ${trip.rider_phone}` : 'No phone on file'}
                                    onClick={() => trip.rider_phone && window.open(`tel:${trip.rider_phone.replace(/[^0-9+]/g, '')}`, '_blank')}
                                    className="h-11 px-4 rounded-xl bg-white/5 border border-white/10 text-white/50 font-black text-[10px] uppercase tracking-widest hover:bg-white/10 transition-all"
                                >
                                    <Phone size={14} />
                                </button>
                            </div>
                        </div>
                    ))}

                    {tripRescues.length === 0 && (
                        <div className="py-32 text-center bg-white/[0.02] rounded-[2rem] border border-dashed border-white/5">
                            <ShieldAlert size={48} className="mx-auto mb-4 text-white/40" />
                            <p className="text-white/60 font-black text-xs">No recent trips</p>
                            <p className="text-white/40 text-sm mt-2">No rides have been flagged for rescue.</p>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
