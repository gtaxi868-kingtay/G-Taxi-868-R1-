import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { ToggleLeft, ToggleRight, RefreshCw, ShieldAlert, Sliders, Car, ShoppingCart, Wind, Package, Truck, MessageCircle, type LucideProps } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Vertical {
    id: string;
    vertical_name: string;
    display_name: string;
    is_enabled: boolean;
    rollout_percentage: number;
    commission_rate_percent: number;
    driver_commission_percent: number;
    enabled_regions: string[];
}

interface FeatureFlag {
    id: string;
    is_active: boolean;
    description: string;
    applies_to: string;
    toggled_at: string | null;
}

// Contact / front-door config keys surfaced for editing here.
const CONTACT_KEYS: { key: string; label: string; hint: string }[] = [
    { key: 'support_whatsapp_number', label: 'Support WhatsApp', hint: 'Rider/driver support + QR/NFC front-door fallback' },
    { key: 'escape_whatsapp_number', label: 'G-Escape WhatsApp', hint: 'Travel concierge line' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

const VERTICAL_ICONS: Record<string, React.ComponentType<LucideProps>> = {
    ride_hailing:       Car,
    grocery:            ShoppingCart,
    laundry:            Wind,
    merchant_delivery:  Package,
    b2b_logistics:      Truck,
};

const FLAG_GROUP_ORDER = [
    'grocery_active', 'laundry_active', 'grocery_module', 'laundry_module',
    'grocery_vertical', 'laundry_vertical', 'pharma_vertical',
    'ai_assistant_active', 'opt_in_ai_routing', 'sponsored_stops',
    'promo_codes_active', 'scheduled_rides_enabled',
    'merchant_commission_enabled', 'kiosk_active',
    'driver_registration_active', 'airline_active', 'hotel_active',
];

function groupFlags(flags: FeatureFlag[]): Record<string, FeatureFlag[]> {
    const groups: Record<string, FeatureFlag[]> = {
        'Service Tiles': [],
        'AI & Routing': [],
        'Commerce': [],
        'Driver & Operations': [],
        'Other': [],
    };
    for (const f of flags) {
        if (['grocery_active', 'laundry_active', 'grocery_module', 'laundry_module',
            'grocery_vertical', 'laundry_vertical', 'pharma_vertical'].includes(f.id)) {
            groups['Service Tiles'].push(f);
        } else if (['ai_assistant_active', 'opt_in_ai_routing', 'sponsored_stops'].includes(f.id)) {
            groups['AI & Routing'].push(f);
        } else if (['promo_codes_active', 'merchant_commission_enabled', 'kiosk_active', 'wallet_active'].includes(f.id)) {
            groups['Commerce'].push(f);
        } else if (['driver_registration_active', 'scheduled_rides_enabled',
            'airline_active', 'hotel_active', 'commander_system_active'].includes(f.id)) {
            groups['Driver & Operations'].push(f);
        } else {
            groups['Other'].push(f);
        }
    }
    return groups;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function PlatformControl() {
    const [verticals, setVerticals] = useState<Vertical[]>([]);
    const [flags, setFlags] = useState<FeatureFlag[]>([]);
    const [loading, setLoading] = useState(true);
    const [togglingVertical, setTogglingVertical] = useState<string | null>(null);
    const [togglingFlag, setTogglingFlag] = useState<string | null>(null);
    const [rolloutEditing, setRolloutEditing] = useState<Record<string, string>>({});
    const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
    const [contact, setContact] = useState<Record<string, string>>({});
    const [contactEditing, setContactEditing] = useState<Record<string, string>>({});
    const [savingContact, setSavingContact] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        const [vRes, fRes, cRes] = await Promise.all([
            supabase.from('vertical_settings').select('*').order('sort_order'),
            supabase.from('system_feature_flags').select('*').order('id'),
            supabase.from('system_config').select('key, value').in('key', [...CONTACT_KEYS.map(c => c.key), 'maintenance_mode']),
        ]);
        setVerticals((vRes.data as Vertical[]) || []);

        const contactMap: Record<string, string> = {};
        for (const row of (cRes.data as { key: string; value: string }[] | null) || []) {
            contactMap[row.key] = row.value;
        }
        setContact(contactMap);
        
        let loadedFlags = (fRes.data as FeatureFlag[]) || [];
        const requiredFlags = [
            { id: 'wallet_active', description: 'Enable Wallet system across all apps', applies_to: 'global' },
            { id: 'commander_system_active', description: 'Enable Pod Commander hierarchy', applies_to: 'global' }
        ];
        
        for (const req of requiredFlags) {
            if (!loadedFlags.find(f => f.id === req.id)) {
                loadedFlags.push({ ...req, is_active: false, toggled_at: null });
            }
        }
        
        setFlags(loadedFlags);
        setLoading(false);
    }, []);

    useEffect(() => { load(); }, [load]);

    const flash = (text: string, ok: boolean) => {
        setMsg({ text, ok });
        setTimeout(() => setMsg(null), 3500);
    };

    const toggleVertical = async (v: Vertical) => {
        setTogglingVertical(v.id);
        const newEnabled = !v.is_enabled;
        const rollout = newEnabled ? 100 : 0;
        const { error } = await supabase.rpc('admin_update_vertical', {
            p_id: v.id,
            p_is_enabled: newEnabled,
            p_rollout: rollout,
        });
        if (error) {
            flash(`Failed to update ${v.display_name}: ${error.message}`, false);
        } else {
            flash(`${v.display_name} ${newEnabled ? 'ENABLED' : 'DISABLED'} — rider app will reflect this immediately`, true);
            await load();
        }
        setTogglingVertical(null);
    };

    const saveRollout = async (v: Vertical) => {
        const val = parseInt(rolloutEditing[v.id] ?? String(v.rollout_percentage), 10);
        if (isNaN(val) || val < 0 || val > 100) {
            flash('Rollout must be 0–100', false);
            return;
        }
        setTogglingVertical(v.id);
        const { error } = await supabase.rpc('admin_update_vertical', {
            p_id: v.id,
            p_is_enabled: v.is_enabled,
            p_rollout: val,
        });
        if (error) {
            flash(`Rollout update failed: ${error.message}`, false);
        } else {
            flash(`${v.display_name} rollout set to ${val}%`, true);
            setRolloutEditing(prev => { const n = { ...prev }; delete n[v.id]; return n; });
            await load();
        }
        setTogglingVertical(null);
    };

    const toggleFlag = async (f: FeatureFlag) => {
        setTogglingFlag(f.id);
        const newActive = !f.is_active;
        const { error } = await supabase.rpc('admin_toggle_feature_flag', {
            p_id: f.id,
            p_is_active: newActive,
        });
        if (error) {
            flash(`Failed to toggle ${f.id}: ${error.message}`, false);
        } else {
            flash(`${f.id} → ${newActive ? 'ON' : 'OFF'}`, true);
            setFlags(prev => prev.map(x => x.id === f.id ? { ...x, is_active: newActive } : x));
        }
        setTogglingFlag(null);
    };

    const saveContact = async (key: string) => {
        const raw = contactEditing[key] ?? contact[key] ?? '';
        const digits = raw.replace(/[^\d]/g, '');
        if (digits.length < 7) {
            flash('Enter a valid number (digits only, incl. country code, e.g. 18687031000)', false);
            return;
        }
        setSavingContact(key);
        const { error } = await supabase.rpc('admin_set_system_config', { p_key: key, p_value: digits });
        if (error) {
            flash(`Failed to save: ${error.message}`, false);
        } else {
            setContact(prev => ({ ...prev, [key]: digits }));
            setContactEditing(prev => { const n = { ...prev }; delete n[key]; return n; });
            flash('Saved — apps and the QR landing page will use the new number immediately', true);
        }
        setSavingContact(null);
    };

    const toggleMaintenance = async () => {
        const next = contact['maintenance_mode'] === 'true' ? 'false' : 'true';
        setSavingContact('maintenance_mode');
        const { error } = await supabase.rpc('admin_set_system_config', { p_key: 'maintenance_mode', p_value: next });
        if (error) {
            flash(`Failed to set maintenance mode: ${error.message}`, false);
        } else {
            setContact(prev => ({ ...prev, maintenance_mode: next }));
            flash(next === 'true'
                ? 'MAINTENANCE MODE ON — riders/drivers see the "be right back" screen'
                : 'Maintenance mode OFF — apps are live again', true);
        }
        setSavingContact(null);
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-96">
                <div className="w-10 h-10 border-4 border-cyan-400 border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    const flagGroups = groupFlags(flags);

    return (
        <div className="space-y-10">

            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-black text-white italic">PLATFORM CONTROL</h2>
                    <p className="text-xs text-white/30 uppercase tracking-widest mt-1">
                        Service Verticals · Feature Flags · Live rider app state
                    </p>
                </div>
                <button
                    onClick={load}
                    className="p-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-white/40 hover:text-white transition-all"
                >
                    <RefreshCw size={18} />
                </button>
            </div>

            {/* Toast */}
            {msg && (
                <div className={`px-5 py-3 rounded-xl border text-sm font-bold ${msg.ok
                    ? 'bg-green-500/10 border-green-500/30 text-green-400'
                    : 'bg-red-500/10 border-red-500/30 text-red-400'
                }`}>
                    {msg.text}
                </div>
            )}

            {/* ── Service Verticals ─────────────────────────────────────────── */}
            <section>
                <div className="flex items-center gap-3 mb-4">
                    <Sliders size={18} className="text-cyan-400" />
                    <div>
                        <h3 className="font-black text-white uppercase tracking-wider text-sm">Service Verticals</h3>
                        <p className="text-[10px] text-white/30 uppercase tracking-widest">
                            Controls which service tiles appear in the rider app HomeScreen
                        </p>
                    </div>
                </div>

                <div className="space-y-3">
                    {verticals.map(v => {
                        const busy = togglingVertical === v.id;
                        const rolloutVal = rolloutEditing[v.id] ?? String(v.rollout_percentage);
                        const isDirty = rolloutEditing[v.id] !== undefined &&
                            rolloutEditing[v.id] !== String(v.rollout_percentage);

                        return (
                            <div
                                key={v.id}
                                className={`bg-white/5 rounded-2xl p-5 border transition-all ${
                                    v.is_enabled ? 'border-cyan-400/20' : 'border-white/5'
                                }`}
                            >
                                <div className="flex items-center justify-between gap-4 flex-wrap">
                                    <div className="flex items-center gap-4">
                                        {(() => { const Icon = VERTICAL_ICONS[v.vertical_name] ?? Sliders; return <Icon size={22} className="text-white/60 flex-shrink-0" />; })()}
                                        <div>
                                            <p className="font-black text-white text-sm">{v.display_name}</p>
                                            <p className="text-[10px] text-white/30 uppercase tracking-widest mt-0.5">
                                                {v.vertical_name} · commission {v.commission_rate_percent}% ·
                                                driver {v.driver_commission_percent}%
                                            </p>
                                            {v.enabled_regions.length > 0 && (
                                                <p className="text-[10px] text-cyan-400/60 mt-0.5">
                                                    Regions: {v.enabled_regions.join(', ')}
                                                </p>
                                            )}
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-4">
                                        {/* Rollout % input */}
                                        <div className="flex items-center gap-2">
                                            <label className="text-[10px] text-white/30 uppercase tracking-widest whitespace-nowrap">
                                                Rollout %
                                            </label>
                                            <input
                                                type="number"
                                                min={0}
                                                max={100}
                                                value={rolloutVal}
                                                onChange={e => setRolloutEditing(prev => ({ ...prev, [v.id]: e.target.value }))}
                                                className="w-16 bg-black/40 border border-white/10 rounded-lg px-2 py-1 text-white text-xs font-mono text-center focus:outline-none focus:border-cyan-400/50"
                                            />
                                            {isDirty && (
                                                <button
                                                    onClick={() => saveRollout(v)}
                                                    disabled={busy}
                                                    className="px-3 py-1 bg-cyan-500/20 border border-cyan-400/30 text-cyan-400 text-[10px] font-black uppercase tracking-widest rounded-lg hover:bg-cyan-500/30 disabled:opacity-40"
                                                >
                                                    Save
                                                </button>
                                            )}
                                        </div>

                                        {/* Enable/disable toggle */}
                                        <button
                                            onClick={() => toggleVertical(v)}
                                            disabled={busy}
                                            className="flex items-center gap-2 disabled:opacity-40"
                                            title={v.is_enabled ? 'Disable this vertical' : 'Enable this vertical'}
                                        >
                                            {busy ? (
                                                <div className="w-5 h-5 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
                                            ) : v.is_enabled ? (
                                                <ToggleRight size={32} className="text-cyan-400" />
                                            ) : (
                                                <ToggleLeft size={32} className="text-white/20" />
                                            )}
                                            <span className={`text-xs font-black uppercase tracking-widest ${
                                                v.is_enabled ? 'text-cyan-400' : 'text-white/20'
                                            }`}>
                                                {v.is_enabled ? 'Live' : 'Off'}
                                            </span>
                                        </button>
                                    </div>
                                </div>

                                {/* Warning if disabled */}
                                {!v.is_enabled && (
                                    <div className="mt-3 flex items-center gap-2 text-[10px] text-yellow-400/60 uppercase tracking-widest">
                                        <ShieldAlert size={12} />
                                        Tile hidden from all riders — toggle Live to activate
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </section>

            {/* ── Maintenance kill-switch ───────────────────────────────────── */}
            <section>
                <div className={`rounded-2xl p-6 border transition-all ${
                    contact['maintenance_mode'] === 'true'
                        ? 'bg-red-500/10 border-red-500/40'
                        : 'bg-white/5 border-white/10'
                }`}>
                    <div className="flex items-center justify-between gap-4 flex-wrap">
                        <div className="flex items-center gap-3">
                            <ShieldAlert size={20} className={contact['maintenance_mode'] === 'true' ? 'text-red-400' : 'text-white/40'} />
                            <div>
                                <h3 className="font-black text-white uppercase tracking-wider text-sm">Maintenance Mode</h3>
                                <p className="text-[10px] text-white/40 uppercase tracking-widest mt-0.5">
                                    {contact['maintenance_mode'] === 'true'
                                        ? 'LIVE — all riders & drivers see the "be right back" screen'
                                        : 'Off — apps operate normally'}
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={toggleMaintenance}
                            disabled={savingContact === 'maintenance_mode'}
                            className="flex items-center gap-2 disabled:opacity-40"
                            title="Toggle platform maintenance mode"
                        >
                            {savingContact === 'maintenance_mode' ? (
                                <div className="w-5 h-5 border-2 border-red-400 border-t-transparent rounded-full animate-spin" />
                            ) : contact['maintenance_mode'] === 'true' ? (
                                <ToggleRight size={32} className="text-red-400" />
                            ) : (
                                <ToggleLeft size={32} className="text-white/20" />
                            )}
                            <span className={`text-xs font-black uppercase tracking-widest ${contact['maintenance_mode'] === 'true' ? 'text-red-400' : 'text-white/20'}`}>
                                {contact['maintenance_mode'] === 'true' ? 'ON' : 'Off'}
                            </span>
                        </button>
                    </div>
                </div>
            </section>

            {/* ── Contact & Front Door ──────────────────────────────────────── */}
            <section>
                <div className="flex items-center gap-3 mb-4">
                    <MessageCircle size={18} className="text-green-400" />
                    <div>
                        <h3 className="font-black text-white uppercase tracking-wider text-sm">Contact &amp; Front Door</h3>
                        <p className="text-[10px] text-white/30 uppercase tracking-widest">
                            Business WhatsApp numbers used by the apps and the QR/NFC landing page — no code change needed
                        </p>
                    </div>
                </div>

                <div className="space-y-3">
                    {CONTACT_KEYS.map(({ key, label, hint }) => {
                        const current = contact[key] ?? '';
                        const val = contactEditing[key] ?? current;
                        const isDirty = contactEditing[key] !== undefined && contactEditing[key] !== current;
                        const busy = savingContact === key;
                        return (
                            <div key={key} className="bg-white/5 rounded-2xl p-5 border border-white/5">
                                <div className="flex items-center justify-between gap-4 flex-wrap">
                                    <div>
                                        <p className="font-black text-white text-sm">{label}</p>
                                        <p className="text-[10px] text-white/30 uppercase tracking-widest mt-0.5">{hint}</p>
                                        <p className="text-[10px] text-white/20 font-mono mt-0.5">{key}</p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-white/20 text-sm font-mono">+</span>
                                        <input
                                            type="tel"
                                            inputMode="numeric"
                                            value={val}
                                            placeholder="18687031000"
                                            onChange={e => setContactEditing(prev => ({ ...prev, [key]: e.target.value }))}
                                            className="w-44 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-green-400/50"
                                        />
                                        <button
                                            onClick={() => saveContact(key)}
                                            disabled={busy || !isDirty}
                                            className="px-4 py-2 bg-green-500/20 border border-green-400/30 text-green-400 text-[10px] font-black uppercase tracking-widest rounded-lg hover:bg-green-500/30 disabled:opacity-30"
                                        >
                                            {busy ? 'Saving…' : 'Save'}
                                        </button>
                                    </div>
                                </div>
                                <p className="text-[10px] text-white/30 mt-3">
                                    Digits only, including country code (Trinidad &amp; Tobago = 1868…). Used to build{' '}
                                    <span className="font-mono text-white/40">wa.me/{current || '…'}</span> links.
                                </p>
                            </div>
                        );
                    })}
                </div>
            </section>

            {/* ── Feature Flags ─────────────────────────────────────────────── */}
            <section>
                <div className="flex items-center gap-3 mb-4">
                    <ShieldAlert size={18} className="text-purple-400" />
                    <div>
                        <h3 className="font-black text-white uppercase tracking-wider text-sm">Feature Flags</h3>
                        <p className="text-[10px] text-white/30 uppercase tracking-widest">
                            Platform behavior switches — independent of vertical_settings
                        </p>
                    </div>
                </div>

                <div className="space-y-8">
                    {Object.entries(flagGroups).map(([groupName, groupFlags]) => {
                        if (groupFlags.length === 0) return null;
                        return (
                            <div key={groupName}>
                                <p className="text-[10px] font-black text-white/20 uppercase tracking-[0.4em] mb-3">
                                    {groupName}
                                </p>
                                <div className="space-y-2">
                                    {groupFlags.map(f => {
                                        const busy = togglingFlag === f.id;
                                        return (
                                            <div
                                                key={f.id}
                                                className={`flex items-center justify-between gap-4 px-5 py-4 rounded-xl border transition-all ${
                                                    f.is_active
                                                        ? 'bg-white/5 border-purple-400/10'
                                                        : 'bg-black/20 border-white/5'
                                                }`}
                                            >
                                                <div className="min-w-0">
                                                    <p className={`text-xs font-black font-mono ${
                                                        f.is_active ? 'text-white' : 'text-white/30'
                                                    }`}>
                                                        {f.id}
                                                    </p>
                                                    {f.description && (
                                                        <p className="text-[10px] text-white/20 mt-0.5 truncate max-w-md">
                                                            {f.description}
                                                        </p>
                                                    )}
                                                    {f.toggled_at && (
                                                        <p className="text-[10px] text-white/40 mt-0.5">
                                                            Last toggled {new Date(f.toggled_at).toLocaleString()}
                                                        </p>
                                                    )}
                                                </div>
                                                <button
                                                    onClick={() => toggleFlag(f)}
                                                    disabled={busy}
                                                    className="flex-shrink-0 flex items-center gap-2 disabled:opacity-40"
                                                >
                                                    {busy ? (
                                                        <div className="w-5 h-5 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
                                                    ) : f.is_active ? (
                                                        <ToggleRight size={28} className="text-purple-400" />
                                                    ) : (
                                                        <ToggleLeft size={28} className="text-white/20" />
                                                    )}
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </section>

        </div>
    );
}
