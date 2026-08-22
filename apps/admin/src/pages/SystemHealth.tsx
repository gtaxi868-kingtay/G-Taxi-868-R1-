import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { HeartPulse, RefreshCw, CheckCircle2, AlertTriangle, AlertOctagon, Bell } from 'lucide-react';

interface HealthCheck {
    check_name: string;
    status: 'ok' | 'warning' | 'critical';
    detail: string;
}

interface Alert {
    id: string;
    type: string;
    severity: string;
    title: string;
    details: Record<string, unknown>;
    resolved_at: string | null;
    created_at: string;
}

const C = {
    text: '#F1F5F9',
    muted: 'rgba(255,255,255,0.4)',
    faint: 'rgba(255,255,255,0.3)',
    body: 'rgba(255,255,255,0.8)',
    surface: 'rgba(255,255,255,0.05)',
    surfaceHigh: 'rgba(255,255,255,0.08)',
    accent: '#A78BFA',
    ok: '#10B981',
    warning: '#F59E0B',
    critical: '#EF4444',
};

const STATUS_META: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
    ok: { color: C.ok, icon: <CheckCircle2 size={18} />, label: 'OK' },
    warning: { color: C.warning, icon: <AlertTriangle size={18} />, label: 'Warning' },
    critical: { color: C.critical, icon: <AlertOctagon size={18} />, label: 'Critical' },
};

const CHECK_LABELS: Record<string, string> = {
    cron_failures: 'Scheduled jobs',
    event_queue_backlog: 'Event processing',
    unresolved_critical_alerts: 'Open critical alerts',
    llm_budget: "G's daily AI budget",
};

const fmt = (iso: string) => new Date(iso).toLocaleString('en-TT', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
});

export function SystemHealth() {
    const [checks, setChecks] = useState<HealthCheck[]>([]);
    const [alerts, setAlerts] = useState<Alert[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        const [checksRes, alertsRes] = await Promise.all([
            supabase.rpc('g_system_health_summary'),
            supabase
                .from('system_alerts')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(30),
        ]);
        if (checksRes.error) setError(checksRes.error.message);
        else setChecks(checksRes.data as HealthCheck[]);
        if (alertsRes.data) setAlerts(alertsRes.data as Alert[]);
        setLoading(false);
    }, []);

    useEffect(() => {
        load();
        const interval = setInterval(load, 60_000);
        return () => clearInterval(interval);
    }, [load]);

    const overallStatus = checks.some(c => c.status === 'critical') ? 'critical'
        : checks.some(c => c.status === 'warning') ? 'warning'
        : 'ok';

    const openAlerts = alerts.filter(a => !a.resolved_at);

    return (
        <div style={{ padding: 32, color: C.text, maxWidth: 1100, margin: '0 auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{
                        width: 52, height: 52, borderRadius: 16,
                        background: `linear-gradient(135deg, ${STATUS_META[overallStatus].color}33, ${STATUS_META[overallStatus].color}11)`,
                        border: `1px solid ${STATUS_META[overallStatus].color}55`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                        <HeartPulse size={26} color={STATUS_META[overallStatus].color} />
                    </div>
                    <div>
                        <h2 style={{ margin: 0, fontSize: 24, fontWeight: 800 }}>System Health</h2>
                        <p style={{ margin: 0, color: C.muted, fontSize: 13 }}>
                            G checks this every 5 minutes — cron jobs, queue backlog, critical alerts, AI budget
                        </p>
                    </div>
                </div>
                <button
                    onClick={load}
                    style={{ background: C.surfaceHigh, border: 'none', color: C.text, borderRadius: 12, padding: '10px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                >
                    <RefreshCw size={16} /> Refresh
                </button>
            </div>

            {error && (
                <div style={{ background: 'rgba(239,68,68,0.15)', borderRadius: 12, padding: '12px 16px', marginBottom: 20, color: C.critical, fontSize: 14 }}>
                    {error === 'Forbidden: admin only' ? 'Admin access required to view system health.' : error}
                </div>
            )}

            {loading ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {[0, 1, 2, 3].map(i => (
                        <div key={i} style={{ background: C.surface, borderRadius: 16, padding: 18, height: 60 }} className="animate-pulse" />
                    ))}
                </div>
            ) : (
                <>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16, marginBottom: 28 }}>
                        {checks.map(c => {
                            const meta = STATUS_META[c.status];
                            return (
                                <div key={c.check_name} style={{ background: C.surface, borderRadius: 20, padding: 20, borderTop: `3px solid ${meta.color}` }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                                        <span style={{ color: meta.color }}>{meta.icon}</span>
                                        <span style={{ fontWeight: 700, fontSize: 14 }}>{CHECK_LABELS[c.check_name] ?? c.check_name}</span>
                                        <span style={{ marginLeft: 'auto', background: meta.color + '22', color: meta.color, borderRadius: 99, padding: '2px 10px', fontSize: 11, fontWeight: 700 }}>
                                            {meta.label}
                                        </span>
                                    </div>
                                    <p style={{ margin: 0, color: C.body, fontSize: 13 }}>{c.detail}</p>
                                </div>
                            );
                        })}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                        <Bell size={16} color={C.muted} />
                        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
                            Alerts {openAlerts.length > 0 && `(${openAlerts.length} open)`}
                        </h3>
                    </div>

                    {alerts.length === 0 ? (
                        <div style={{ textAlign: 'center', color: C.faint, padding: 40 }}>No alerts recorded.</div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                            {alerts.map(a => {
                                const sevColor =
                                    a.severity === 'CRITICAL' ? C.critical :
                                    a.severity === 'HIGH' ? C.warning : C.muted;
                                return (
                                    <div key={a.id} style={{
                                        background: C.surface, borderRadius: 16, padding: 16,
                                        opacity: a.resolved_at ? 0.5 : 1,
                                        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16,
                                    }}>
                                        <div style={{ flex: 1 }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                                                <span style={{ background: sevColor + '22', color: sevColor, borderRadius: 99, padding: '2px 10px', fontSize: 11, fontWeight: 700 }}>
                                                    {a.severity}
                                                </span>
                                                {a.resolved_at && <span style={{ color: C.ok, fontSize: 11, fontWeight: 700 }}>Resolved</span>}
                                            </div>
                                            <div style={{ fontWeight: 600, fontSize: 14 }}>{a.title}</div>
                                            {typeof a.details?.detail === 'string' && (
                                                <div style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>{a.details.detail}</div>
                                            )}
                                        </div>
                                        <div style={{ fontSize: 11, color: C.faint, whiteSpace: 'nowrap' }}>{fmt(a.created_at)}</div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
