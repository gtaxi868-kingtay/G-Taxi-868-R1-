import { useEffect, useState, useCallback } from 'react';
import { supabase, adminFetch } from '../lib/supabase';
import { AlertOctagon, CheckCircle, Clock, RefreshCw, MapPin } from 'lucide-react';

interface SystemAlert {
    id: string;
    type: string;
    severity: 'INFO' | 'LOW' | 'MEDIUM' | 'WARNING' | 'HIGH' | 'CRITICAL';
    title: string;
    details: Record<string, any> | null;
    resolved_at: string | null;
    created_at: string;
}

const SEVERITY_COLORS: Record<string, string> = {
    CRITICAL: 'text-red-400 bg-red-500/10 border-red-500/20',
    HIGH: 'text-orange-400 bg-orange-500/10 border-orange-500/20',
    WARNING: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
    MEDIUM: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
    LOW: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20',
    INFO: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20',
};

// This inbox exists because a real SOS used to reach exactly zero G-Taxi
// humans: handle_sos correctly filed a CRITICAL row in system_alerts and
// tried a push to admin devices with a saved push_token, but no admin page
// anywhere read system_alerts, and no admin account had a push_token set.
// A rider's own emergency contact still got a WhatsApp message — no one on
// the platform side did. See project memory "Safety/SOS + NFC Audit".
export function SosAlerts() {
    const [alerts, setAlerts] = useState<SystemAlert[]>([]);
    const [loading, setLoading] = useState(true);
    const [showResolved, setShowResolved] = useState(false);
    const [resolvingId, setResolvingId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const { data, error: fetchError } = await adminFetch('admin', { action: 'get_alerts' });
            if (fetchError) throw fetchError;
            setAlerts(data || []);
        } catch (err) {
            console.error('SOS alerts load error:', err);
            setError(err instanceof Error ? err.message : 'Failed to load alerts');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
        // system_alerts INSERT only happens via SECURITY DEFINER functions
        // (raise_admin_alert) with service-role privileges, so this realtime
        // subscription is the only way a live SOS shows up without a manual
        // refresh — polling would mean an admin missing an emergency because
        // they hadn't clicked back to this tab yet.
        const channel = supabase
            .channel('sos-alerts')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'system_alerts' }, load)
            .subscribe();
        return () => { supabase.removeChannel(channel); };
    }, [load]);

    const handleResolve = async (id: string) => {
        setResolvingId(id);
        try {
            const { error: resolveError } = await adminFetch('admin', { action: 'resolve_alert', id });
            if (resolveError) throw resolveError;
            await load();
        } catch (err) {
            alert('Could not resolve alert: ' + (err instanceof Error ? err.message : 'unknown error'));
        } finally {
            setResolvingId(null);
        }
    };

    const sosAlerts = alerts.filter((a) => a.type === 'EMERGENCY_SOS' || a.type === 'AREA_SAFETY_CONCERN');
    const otherAlerts = alerts.filter((a) => a.type !== 'EMERGENCY_SOS' && a.type !== 'AREA_SAFETY_CONCERN');
    const visible = (list: SystemAlert[]) => showResolved ? list : list.filter((a) => !a.resolved_at);

    const openSosCount = sosAlerts.filter((a) => !a.resolved_at).length;

    if (loading) {
        return (
            <div className="flex items-center justify-center py-24">
                <RefreshCw size={24} className="animate-spin" style={{ color: 'var(--ink-dim)' }} />
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-8">
            {error && (
                <div className="error-banner">
                    <span>{error}</span>
                    <button onClick={load}>Retry</button>
                </div>
            )}

            <div
                className="glass-panel p-6 rounded-2xl flex items-center justify-between"
                style={{
                    borderColor: openSosCount > 0 ? 'rgba(239,68,68,0.4)' : undefined,
                    background: openSosCount > 0 ? 'rgba(239,68,68,0.06)' : undefined,
                }}
            >
                <div className="flex items-center gap-4">
                    <AlertOctagon size={28} style={{ color: openSosCount > 0 ? '#EF4444' : 'var(--ink-dim)' }} />
                    <div>
                        <p className="text-2xl font-black">{openSosCount}</p>
                        <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--ink-muted)' }}>
                            Open SOS / safety alert{openSosCount === 1 ? '' : 's'}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 text-xs font-bold" style={{ color: 'var(--ink-muted)' }}>
                        <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
                        Show resolved
                    </label>
                    <button onClick={load} className="glass-btn glass-btn-ghost h-9 px-4 text-xs">
                        <RefreshCw size={14} /> Refresh
                    </button>
                </div>
            </div>

            <section>
                <h3 className="text-sm font-black uppercase tracking-widest mb-4" style={{ color: 'var(--ink-muted)' }}>
                    SOS &amp; Safety
                </h3>
                <AlertList
                    alerts={visible(sosAlerts)}
                    onResolve={handleResolve}
                    resolvingId={resolvingId}
                    emptyLabel="No SOS or safety alerts."
                />
            </section>

            <section>
                <h3 className="text-sm font-black uppercase tracking-widest mb-4" style={{ color: 'var(--ink-muted)' }}>
                    Other System Alerts
                </h3>
                <AlertList
                    alerts={visible(otherAlerts)}
                    onResolve={handleResolve}
                    resolvingId={resolvingId}
                    emptyLabel="No other alerts."
                />
            </section>
        </div>
    );
}

function AlertList({
    alerts, onResolve, resolvingId, emptyLabel,
}: {
    alerts: SystemAlert[];
    onResolve: (id: string) => void;
    resolvingId: string | null;
    emptyLabel: string;
}) {
    if (alerts.length === 0) {
        return (
            <div className="glass-card p-6 text-center text-xs font-bold" style={{ color: 'var(--ink-dim)' }}>
                {emptyLabel}
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-3">
            {alerts.map((alert) => {
                const details = alert.details || {};
                const body = typeof details.body === 'string' ? details.body : null;
                const lat = details.lat;
                const lng = details.lng;
                return (
                    <div key={alert.id} className="glass-card p-5 rounded-xl flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-2 flex-wrap">
                                <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-full border ${SEVERITY_COLORS[alert.severity] || SEVERITY_COLORS.INFO}`}>
                                    {alert.severity}
                                </span>
                                <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--ink-dim)' }}>
                                    {alert.type}
                                </span>
                                {alert.resolved_at && (
                                    <span className="text-[10px] font-bold uppercase tracking-widest flex items-center gap-1" style={{ color: 'var(--green, #10B981)' }}>
                                        <CheckCircle size={12} /> Resolved
                                    </span>
                                )}
                            </div>
                            <p className="font-bold text-sm mb-1">{alert.title}</p>
                            {body && <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>{body}</p>}
                            <div className="flex items-center gap-4 mt-3 flex-wrap">
                                <span className="text-[10px] flex items-center gap-1" style={{ color: 'var(--ink-dim)' }}>
                                    <Clock size={12} /> {new Date(alert.created_at).toLocaleString()}
                                </span>
                                {typeof lat === 'number' && typeof lng === 'number' && (
                                    <a
                                        href={`https://www.google.com/maps?q=${lat},${lng}`}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-[10px] flex items-center gap-1 underline"
                                        style={{ color: 'var(--cyan)' }}
                                    >
                                        <MapPin size={12} /> View location
                                    </a>
                                )}
                                {details.ride_id && (
                                    <span className="text-[10px]" style={{ color: 'var(--ink-dim)' }}>
                                        Ride {String(details.ride_id).slice(0, 8)}
                                    </span>
                                )}
                            </div>
                        </div>
                        {!alert.resolved_at && (
                            <button
                                onClick={() => onResolve(alert.id)}
                                disabled={resolvingId === alert.id}
                                className="glass-btn h-9 px-4 text-xs shrink-0"
                            >
                                {resolvingId === alert.id ? 'Resolving…' : 'Mark resolved'}
                            </button>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
