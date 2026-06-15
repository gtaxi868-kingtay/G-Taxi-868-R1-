import { useEffect, useState, useCallback } from 'react';
import { supabase, adminFetch } from '../lib/supabase';
import { Car, RefreshCw, ChevronRight } from 'lucide-react';

interface Vehicle {
    id: string;
    make: string;
    model: string;
    year: number;
    color?: string;
    vehicle_type: string;
    price_cents: number;
    status: string;
    dealer?: { business_name: string; phone?: string };
}

interface Lead {
    id: string;
    vehicle_id: string;
    driver_id: string;
    status: string;
    notes?: string;
    created_at: string;
    vehicle?: { make: string; model: string; year: number };
    driver?: { name: string; phone?: string };
}

const fmt = (cents: number) => `$${(cents / 100).toLocaleString('en-TT', { minimumFractionDigits: 2 })} TTD`;

// Structural color tokens
const C = {
    text:        '#F1F5F9',
    muted:       'rgba(255,255,255,0.4)',
    faint:       'rgba(255,255,255,0.3)',
    surface:     'rgba(255,255,255,0.05)',
    surfaceHigh: 'rgba(255,255,255,0.08)',
    errorText:   '#EF4444',
    errorBg:     'rgba(239,68,68,0.15)',
    successText: '#22C55E',
    successBg:   'rgba(34,197,94,0.15)',
    amber:       '#F59E0B',
    amberBg:     'rgba(245,158,11,0.15)',
};

// Semantic pipeline status colors — encode lead stage, not decoration
const STATUS_COLORS: Record<string, string> = {
    lead:                 '#6B7280',
    test_drive_scheduled: '#3B82F6',
    financing_pending:    C.amber,
    approved:             C.successText,
    funded:               '#10B981',
    closed_won:           C.successText,
    closed_lost:          C.errorText,
};

const PIPELINE_STAGES = [
    { key: 'lead',                 label: 'Lead' },
    { key: 'test_drive_scheduled', label: 'Test drive' },
    { key: 'financing_pending',    label: 'Financing' },
    { key: 'approved',             label: 'Approved' },
    { key: 'funded',               label: 'Funded' },
];

function SkeletonCard() {
    return (
        <div style={{ background: C.surface, borderRadius: 20, padding: 20, display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ flex: 1 }}>
                <div style={{ height: 15, background: C.surfaceHigh, borderRadius: 6, width: '60%', marginBottom: 8 }} className="animate-pulse" />
                <div style={{ height: 12, background: C.surfaceHigh, borderRadius: 6, width: '40%' }} className="animate-pulse" />
            </div>
            <div style={{ width: 70, height: 26, background: C.surfaceHigh, borderRadius: 99 }} className="animate-pulse" />
        </div>
    );
}

export function DealerBrokerage() {
    const [vehicles, setVehicles] = useState<Vehicle[]>([]);
    const [leads, setLeads] = useState<Lead[]>([]);
    const [loading, setLoading] = useState(true);
    const [updatingLead, setUpdatingLead] = useState<string | null>(null);
    const [msg, setMsg] = useState('');
    const [tab, setTab] = useState<'inventory' | 'pipeline'>('pipeline');

    const load = useCallback(async () => {
        setLoading(true);
        const [vRes, lRes] = await Promise.all([
            supabase.from('vehicle_inventory')
                .select('*, dealer:dealer_partners(business_name, phone)')
                .order('created_at', { ascending: false }),
            supabase.from('vehicle_sales')
                .select(`*, vehicle:vehicle_inventory(make, model, year), driver:drivers(name, phone)`)
                .order('created_at', { ascending: false })
                .limit(100),
        ]);
        if (vRes.data) setVehicles(vRes.data as Vehicle[]);
        if (lRes.data) setLeads(lRes.data as Lead[]);
        setLoading(false);
    }, []);

    useEffect(() => { load(); }, [load]);

    const advanceLead = async (leadId: string, newStatus: string) => {
        setUpdatingLead(leadId);
        setMsg('');
        try {
            const { data: { session } } = await supabase.auth.getSession();
            const res = await adminFetch('/functions/v1/dealer_brokerage?action=update_lead_status', {
                method: 'POST',
                headers: { Authorization: `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ lead_id: leadId, status: newStatus }),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            setLeads(prev => prev.map(l => l.id === leadId ? { ...l, status: newStatus } : l));
            setMsg(`Lead moved to ${newStatus.replace(/_/g, ' ')}`);
        } catch (e: any) {
            setMsg(`Error: ${e.message}`);
        } finally {
            setUpdatingLead(null);
        }
    };

    const pipelineCounts = PIPELINE_STAGES.reduce<Record<string, number>>((acc, s) => {
        acc[s.key] = leads.filter(l => l.status === s.key).length;
        return acc;
    }, {});

    return (
        <div style={{ padding: 32, color: C.text, maxWidth: 1100, margin: '0 auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <Car size={28} color={C.amber} />
                    <div>
                        <h2 style={{ margin: 0, fontSize: 24, fontWeight: 800 }}>Dealer Brokerage</h2>
                        <p style={{ margin: 0, color: C.muted, fontSize: 13 }}>Vehicle financing pipeline for drivers</p>
                    </div>
                </div>
                <button
                    onClick={load}
                    style={{ background: C.surfaceHigh, border: 'none', color: C.text, borderRadius: 12, padding: '10px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                >
                    <RefreshCw size={16} /> Refresh
                </button>
            </div>

            {/* Pipeline stage summary */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 32, flexWrap: 'wrap' }}>
                {PIPELINE_STAGES.map(s => (
                    <div key={s.key} style={{ flex: 1, minWidth: 100, background: C.surface, borderRadius: 20, padding: '20px', textAlign: 'center', borderTop: `3px solid ${STATUS_COLORS[s.key]}` }}>
                        <div style={{ fontSize: 28, fontWeight: 800, color: STATUS_COLORS[s.key] }}>{pipelineCounts[s.key] || 0}</div>
                        <div style={{ color: C.muted, fontSize: 12, marginTop: 4 }}>{s.label}</div>
                    </div>
                ))}
            </div>

            {msg && (
                <div style={{ background: msg.startsWith('Error') ? C.errorBg : C.successBg, borderRadius: 12, padding: '12px 16px', marginBottom: 16, color: msg.startsWith('Error') ? C.errorText : C.successText, fontSize: 14 }}>
                    {msg}
                </div>
            )}

            {/* Tabs */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
                {(['pipeline', 'inventory'] as const).map(t => (
                    <button
                        key={t}
                        onClick={() => setTab(t)}
                        style={{ padding: '10px 20px', borderRadius: 12, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 14, background: tab === t ? C.amber : C.surfaceHigh, color: tab === t ? '#000' : C.muted }}
                    >
                        {t === 'pipeline' ? 'Sales pipeline' : 'Vehicle inventory'}
                    </button>
                ))}
            </div>

            {loading ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {[0, 1, 2, 3].map(i => <SkeletonCard key={i} />)}
                </div>
            ) : tab === 'pipeline' ? (
                <>
                    {leads.length === 0 ? (
                        <div style={{ textAlign: 'center', color: C.faint, padding: 60 }}>
                            <Car size={48} style={{ opacity: 0.3, marginBottom: 16 }} />
                            <p>No leads yet. Drivers submit interest from the app.</p>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                            {leads.map(lead => {
                                const currentIdx = PIPELINE_STAGES.findIndex(s => s.key === lead.status);
                                const nextStage = PIPELINE_STAGES[currentIdx + 1];
                                const statusColor = STATUS_COLORS[lead.status] || '#6B7280';
                                return (
                                    <div key={lead.id} style={{ background: C.surface, borderRadius: 20, padding: 20, display: 'flex', alignItems: 'center', gap: 16 }}>
                                        <div style={{ flex: 1 }}>
                                            <div style={{ fontWeight: 700, fontSize: 15 }}>
                                                {lead.vehicle ? `${lead.vehicle.year} ${lead.vehicle.make} ${lead.vehicle.model}` : 'Vehicle'}
                                            </div>
                                            <div style={{ color: C.muted, fontSize: 13, marginTop: 4 }}>
                                                Driver: {lead.driver?.name || lead.driver_id?.slice(0, 8)}
                                                {lead.driver?.phone && ` · ${lead.driver.phone}`}
                                            </div>
                                            {lead.notes && <div style={{ color: C.faint, fontSize: 12, marginTop: 4 }}>{lead.notes}</div>}
                                        </div>
                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
                                            <span style={{ background: statusColor + '26', color: statusColor, borderRadius: 99, padding: '4px 10px', fontSize: 12, fontWeight: 700 }}>
                                                {lead.status.replace(/_/g, ' ')}
                                            </span>
                                            {nextStage && (
                                                <button
                                                    onClick={() => advanceLead(lead.id, nextStage.key)}
                                                    disabled={updatingLead === lead.id}
                                                    style={{ background: C.amber, border: 'none', color: '#000', borderRadius: 10, padding: '6px 14px', cursor: 'pointer', fontWeight: 700, fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, opacity: updatingLead === lead.id ? 0.5 : 1 }}
                                                >
                                                    <ChevronRight size={14} /> {nextStage.label}
                                                </button>
                                            )}
                                            {lead.status !== 'closed_won' && lead.status !== 'closed_lost' && !nextStage && (
                                                <button
                                                    onClick={() => advanceLead(lead.id, 'closed_won')}
                                                    disabled={updatingLead === lead.id}
                                                    style={{ background: C.successText, border: 'none', color: '#FFF', borderRadius: 10, padding: '6px 14px', cursor: 'pointer', fontWeight: 700, fontSize: 12 }}
                                                >
                                                    Close won
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </>
            ) : (
                <>
                    {vehicles.length === 0 ? (
                        <div style={{ textAlign: 'center', color: C.faint, padding: 60 }}>
                            <Car size={48} style={{ opacity: 0.3, marginBottom: 16 }} />
                            <p>No vehicles in inventory. Add them via the dealer API.</p>
                        </div>
                    ) : (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
                            {vehicles.map(v => (
                                <div key={v.id} style={{ background: C.surface, borderRadius: 20, padding: 20 }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                                        <span style={{ background: C.amberBg, color: C.amber, borderRadius: 99, padding: '3px 10px', fontSize: 11, fontWeight: 700 }}>
                                            {v.vehicle_type}
                                        </span>
                                        <span style={{ color: C.amber, fontWeight: 800, fontSize: 16 }}>{fmt(v.price_cents)}</span>
                                    </div>
                                    <div style={{ fontWeight: 700, fontSize: 17 }}>{v.year} {v.make} {v.model}</div>
                                    {v.color && <div style={{ color: C.muted, fontSize: 13, marginTop: 4 }}>{v.color}</div>}
                                    {v.dealer && <div style={{ color: C.muted, fontSize: 12, marginTop: 6 }}>{v.dealer.business_name}</div>}
                                    <div style={{ marginTop: 12 }}>
                                        <span style={{ background: v.status === 'available' ? C.successBg : 'rgba(107,114,128,0.15)', color: v.status === 'available' ? C.successText : '#6B7280', borderRadius: 99, padding: '3px 10px', fontSize: 11, fontWeight: 700 }}>
                                            {v.status}
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
