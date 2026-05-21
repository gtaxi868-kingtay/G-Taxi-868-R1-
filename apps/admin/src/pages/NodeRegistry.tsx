import { useEffect, useState } from 'react';
import { supabase, adminFetch } from '../lib/supabase';
import { MapPin, Plus, Search, ToggleLeft, ToggleRight, Radio, AlertTriangle, X, CheckCircle } from 'lucide-react';

interface KioskNode {
    id: string;
    merchant_id: string | null;
    tag_uid: string;
    location_name: string;
    lat: number | null;
    lng: number | null;
    default_services: string[];
    is_active: boolean;
    created_at: string;
    merchant_name?: string;
}

interface Merchant {
    id: string;
    name: string;
    category: string;
}

export function NodeRegistry() {
    const [nodes, setNodes] = useState<KioskNode[]>([]);
    const [merchants, setMerchants] = useState<Merchant[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [showModal, setShowModal] = useState(false);
    const [editNode, setEditNode] = useState<Partial<KioskNode> | null>(null);
    const [saving, setSaving] = useState(false);
    const [dispatchOverride, setDispatchOverride] = useState<string | null>(null);
    const [overrideResult, setOverrideResult] = useState<any>(null);

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        setLoading(true);
        try {
            const { data: nodesData } = await supabase
                .from('kiosk_nodes')
                .select('*, merchant:merchant_id(name)')
                .order('created_at', { ascending: false });

            const mapped: KioskNode[] = (nodesData || []).map((n: any) => ({
                ...n,
                merchant_name: n.merchant?.name || 'Unlinked',
            }));
            setNodes(mapped);

            const result = await adminFetch('admin_get_users');
            if (result?.merchants) {
                setMerchants(result.merchants);
            } else {
                const { data: mData } = await supabase
                    .from('merchants')
                    .select('id, name, category')
                    .eq('is_active', true);
                setMerchants(mData || []);
            }
        } catch (err) {
            console.error('Failed to load nodes:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        if (!editNode?.tag_uid || !editNode?.location_name) return;
        setSaving(true);
        try {
            await supabase.functions.invoke('admin_manage_nodes', {
                body: {
                    action: 'upsert',
                    node: {
                        id: editNode.id || undefined,
                        tag_uid: editNode.tag_uid,
                        merchant_id: editNode.merchant_id || null,
                        location_name: editNode.location_name,
                        lat: editNode.lat || null,
                        lng: editNode.lng || null,
                        default_services: editNode.default_services || ['ride'],
                        is_active: editNode.is_active ?? true,
                    },
                },
            });
            setShowModal(false);
            setEditNode(null);
            loadData();
        } catch (err: any) {
            console.error('Save failed:', err);
            alert('Failed to save node: ' + err.message);
        } finally {
            setSaving(false);
        }
    };

    const toggleActive = async (node: KioskNode) => {
        try {
            await supabase.functions.invoke('admin_manage_nodes', {
                body: {
                    action: 'upsert',
                    node: { id: node.id, is_active: !node.is_active },
                },
            });
            loadData();
        } catch (err: any) {
            console.error('Toggle failed:', err);
        }
    };

    const handleVirtualDispatch = async (node: KioskNode) => {
        setDispatchOverride(node.id);
        setOverrideResult(null);
        try {
            const result = await adminFetch('admin_assign_driver', {
                ride_id: null,
                kiosk_node_id: node.id,
                location_name: node.location_name,
                lat: node.lat,
                lng: node.lng,
                virtual_override: true,
            });
            setOverrideResult(result);
            setTimeout(() => {
                setDispatchOverride(null);
                setOverrideResult(null);
            }, 3000);
        } catch (err: any) {
            setOverrideResult({ error: err.message });
            setTimeout(() => {
                setDispatchOverride(null);
                setOverrideResult(null);
            }, 3000);
        }
    };

    const filtered = nodes.filter(n =>
        n.location_name.toLowerCase().includes(search.toLowerCase()) ||
        (n.tag_uid || '').toLowerCase().includes(search.toLowerCase()) ||
        (n.merchant_name || '').toLowerCase().includes(search.toLowerCase())
    );

    return (
        <div className="space-y-8">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h2 className="text-2xl sm:text-3xl font-black text-white italic tracking-tight">SMART PUCK MAPPING</h2>
                    <p className="text-xs font-medium text-white/20 uppercase tracking-[0.4em] mt-1">Physical Node Registry // Kiosk Beacon Grid</p>
                </div>
                <button
                    onClick={() => { setEditNode({ is_active: true, default_services: ['ride'] }); setShowModal(true); }}
                    className="h-12 px-6 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 font-black text-xs uppercase tracking-widest hover:bg-cyan-500/20 transition-all flex items-center gap-3"
                >
                    <Plus size={18} /> Register Node
                </button>
            </div>

            {/* Search */}
            <div className="relative max-w-md">
                <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/20" />
                <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search by location, tag UID, or merchant..."
                    className="w-full h-14 pl-12 pr-4 rounded-2xl bg-white/5 border border-white/10 text-white placeholder-white/20 font-bold text-sm focus:border-cyan-500/30 focus:outline-none transition-all"
                />
            </div>

            {/* Node Grid */}
            {loading ? (
                <div className="py-32 text-center">
                    <div className="w-12 h-12 border-4 border-cyan-400 border-t-transparent rounded-full animate-spin mx-auto mb-6" />
                    <p className="text-white/30 font-mono text-sm">Scanning beacon grid...</p>
                </div>
            ) : filtered.length === 0 ? (
                <div className="py-32 text-center bg-white/[0.02] rounded-[2rem] border border-dashed border-white/5">
                    <Radio size={48} className="mx-auto mb-4 text-white/10" />
                    <p className="text-white/20 font-black uppercase tracking-widest text-xs">No Nodes Registered</p>
                    <p className="text-white/10 text-sm mt-2">Register the first Smart Puck to begin mapping.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                    {filtered.map(node => (
                        <div key={node.id} className={`rounded-[1.5rem] border p-6 transition-all ${node.is_active ? 'bg-white/5 border-white/10' : 'bg-white/[0.02] border-white/5 opacity-60'}`}>
                            <div className="flex items-start justify-between mb-4">
                                <div className="flex items-center gap-3">
                                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${node.is_active ? 'bg-green-500/10' : 'bg-white/5'}`}>
                                        <Radio size={20} className={node.is_active ? 'text-green-400' : 'text-white/20'} />
                                    </div>
                                    <div>
                                        <h3 className="text-white font-black text-sm">{node.location_name}</h3>
                                        <p className="text-[10px] font-mono text-white/30">{node.tag_uid?.slice(0, 16)}...</p>
                                    </div>
                                </div>
                                <button onClick={() => toggleActive(node)} className="p-2 hover:bg-white/5 rounded-lg transition-all">
                                    {node.is_active ? <ToggleRight size={22} className="text-cyan-400" /> : <ToggleLeft size={22} className="text-white/20" />}
                                </button>
                            </div>

                            {/* GPS Coordinates */}
                            <div className="flex items-center gap-2 mb-3 bg-white/5 rounded-xl px-4 py-3">
                                <MapPin size={14} className="text-cyan-400/60" />
                                <span className="text-xs font-mono text-white/50">
                                    {node.lat?.toFixed(6)}, {node.lng?.toFixed(6) || '—'}
                                </span>
                            </div>

                            {/* Merchant Link */}
                            <div className="mb-4">
                                <span className="text-[10px] font-black text-white/20 uppercase tracking-widest">Linked Merchant</span>
                                <p className="text-sm font-bold text-white/70 mt-1">{node.merchant_name || 'Unlinked'}</p>
                            </div>

                            {/* Services */}
                            <div className="flex flex-wrap gap-2 mb-6">
                                {(node.default_services || []).map(s => (
                                    <span key={s} className="px-3 py-1 rounded-full bg-purple-500/10 border border-purple-500/20 text-[10px] font-black text-purple-400 uppercase tracking-wider">{s}</span>
                                ))}
                            </div>

                            {/* Edit + Virtual Dispatch */}
                            <div className="flex gap-3">
                                <button
                                    onClick={() => { setEditNode(node); setShowModal(true); }}
                                    className="flex-1 h-11 rounded-xl border border-white/10 text-white/50 font-black text-[10px] uppercase tracking-widest hover:bg-white/5 transition-all"
                                >
                                    Edit Node
                                </button>
                                <button
                                    onClick={() => handleVirtualDispatch(node)}
                                    disabled={dispatchOverride === node.id}
                                    className="flex-1 h-11 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 font-black text-[10px] uppercase tracking-widest hover:bg-amber-500/20 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                                >
                                    {dispatchOverride === node.id ? (
                                        <div className="w-4 h-4 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
                                    ) : (
                                        <><AlertTriangle size={14} /> Virtual Dispatch</>
                                    )}
                                </button>
                            </div>

                            {overrideResult && dispatchOverride === node.id && (
                                <div className={`mt-3 p-3 rounded-xl text-xs font-bold ${overrideResult.error ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-green-500/10 text-green-400 border border-green-500/20'}`}>
                                    {overrideResult.error ? `Override Failed: ${overrideResult.error}` : '✅ Virtual dispatch signal sent.'}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {/* Register / Edit Modal */}
            {showModal && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[100] flex items-center justify-center p-4">
                    <div className="bg-[#0D0B1E] w-full max-w-xl rounded-[2rem] border border-white/10 p-8 shadow-2xl">
                        <div className="flex items-center justify-between mb-8">
                            <h3 className="text-xl font-black text-white italic">
                                {editNode?.id ? 'Edit Node' : 'Register New Node'}
                            </h3>
                            <button onClick={() => { setShowModal(false); setEditNode(null); }} className="p-2 hover:bg-white/5 rounded-lg">
                                <X size={20} className="text-white/40" />
                            </button>
                        </div>

                        <div className="space-y-5">
                            <div>
                                <label className="text-[10px] font-black text-white/30 uppercase tracking-widest mb-2 block">Tag UID (NFC Hardware ID)</label>
                                <input
                                    value={editNode?.tag_uid || ''}
                                    onChange={e => setEditNode(p => ({ ...p, tag_uid: e.target.value }))}
                                    placeholder="e.g. 04:9F:3E:2A:1B:7C:80"
                                    className="w-full h-14 px-5 rounded-2xl bg-white/5 border border-white/10 text-white font-bold text-sm focus:border-cyan-500/30 focus:outline-none placeholder-white/20"
                                />
                            </div>
                            <div>
                                <label className="text-[10px] font-black text-white/30 uppercase tracking-widest mb-2 block">Location Name</label>
                                <input
                                    value={editNode?.location_name || ''}
                                    onChange={e => setEditNode(p => ({ ...p, location_name: e.target.value }))}
                                    placeholder="e.g. Piarco Airport Terminal 1"
                                    className="w-full h-14 px-5 rounded-2xl bg-white/5 border border-white/10 text-white font-bold text-sm focus:border-cyan-500/30 focus:outline-none placeholder-white/20"
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-[10px] font-black text-white/30 uppercase tracking-widest mb-2 block">Latitude</label>
                                    <input
                                        type="number"
                                        step="any"
                                        value={editNode?.lat ?? ''}
                                        onChange={e => setEditNode(p => ({ ...p, lat: parseFloat(e.target.value) || null }))}
                                        placeholder="10.6918"
                                        className="w-full h-14 px-5 rounded-2xl bg-white/5 border border-white/10 text-white font-bold text-sm focus:border-cyan-500/30 focus:outline-none placeholder-white/20"
                                    />
                                </div>
                                <div>
                                    <label className="text-[10px] font-black text-white/30 uppercase tracking-widest mb-2 block">Longitude</label>
                                    <input
                                        type="number"
                                        step="any"
                                        value={editNode?.lng ?? ''}
                                        onChange={e => setEditNode(p => ({ ...p, lng: parseFloat(e.target.value) || null }))}
                                        placeholder="-61.5194"
                                        className="w-full h-14 px-5 rounded-2xl bg-white/5 border border-white/10 text-white font-bold text-sm focus:border-cyan-500/30 focus:outline-none placeholder-white/20"
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="text-[10px] font-black text-white/30 uppercase tracking-widest mb-2 block">Link Merchant</label>
                                <select
                                    value={editNode?.merchant_id || ''}
                                    onChange={e => setEditNode(p => ({ ...p, merchant_id: e.target.value || null }))}
                                    className="w-full h-14 px-5 rounded-2xl bg-white/5 border border-white/10 text-white font-bold text-sm focus:border-cyan-500/30 focus:outline-none appearance-none"
                                >
                                    <option value="">— Unlinked —</option>
                                    {merchants.map(m => (
                                        <option key={m.id} value={m.id}>{m.name} ({m.category})</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="text-[10px] font-black text-white/30 uppercase tracking-widest mb-2 block">Default Services (comma-separated)</label>
                                <input
                                    value={(editNode?.default_services || []).join(', ')}
                                    onChange={e => setEditNode(p => ({ ...p, default_services: e.target.value.split(',').map(s => s.trim()).filter(Boolean) }))}
                                    placeholder="ride, grocery, laundry"
                                    className="w-full h-14 px-5 rounded-2xl bg-white/5 border border-white/10 text-white font-bold text-sm focus:border-cyan-500/30 focus:outline-none placeholder-white/20"
                                />
                            </div>

                            <button
                                onClick={handleSave}
                                disabled={saving || !editNode?.tag_uid || !editNode?.location_name}
                                className="w-full h-16 rounded-2xl bg-gradient-to-r from-cyan-500 to-purple-600 text-white font-black text-sm tracking-widest disabled:opacity-30 hover:scale-[1.02] transition-all flex items-center justify-center gap-3"
                            >
                                {saving ? (
                                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                ) : (
                                    <><CheckCircle size={20} /> {editNode?.id ? 'UPDATE NODE' : 'REGISTER NODE'}</>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
