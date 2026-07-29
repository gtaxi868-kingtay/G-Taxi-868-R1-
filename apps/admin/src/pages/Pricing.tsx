import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { RefreshCw, Zap, X, DollarSign, MapPin, Clock, Percent, Truck } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface PricingConfig {
    key: string;
    value_cents: number;
    description: string;
}

interface VehicleClass {
    key: string;
    label: string;
    description: string | null;
    icon: string;
    multiplier_x100: number;
    category: 'passenger' | 'heavy';
    is_active: boolean;
    sort_order: number;
    min_fare_cents: number | null;
    landed_cost_cents: number | null;
    cost_source: string | null;
    cost_updated_at: string | null;
    cost_notes: string | null;
}

interface SurgeZone {
    id: string;
    center_lat: number;
    center_lng: number;
    radius_meters: number;
    multiplier: number;
    reason: string;
    expires_at: string | null;
    is_active: boolean;
    created_at: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const LOCATION_PRESETS = [
    { name: 'Port of Spain CBD', lat: 10.6596, lng: -61.5086 },
    { name: 'Piarco Int\'l Airport', lat: 10.5954, lng: -61.3374 },
    { name: 'San Fernando', lat: 10.2796, lng: -61.4597 },
    { name: 'Chaguanas', lat: 10.5167, lng: -61.4000 },
    { name: 'St James', lat: 10.6469, lng: -61.5353 },
    { name: 'Custom', lat: 0, lng: 0 },
];

const RADIUS_OPTIONS = [
    { label: '500m', value: 500 },
    { label: '1 km', value: 1000 },
    { label: '2 km', value: 2000 },
    { label: '5 km', value: 5000 },
];

const MULTIPLIER_OPTIONS = [1.1, 1.2, 1.3, 1.5, 2.0];

const EXPIRY_OPTIONS = [
    { label: '30 min', minutes: 30 },
    { label: '1 hr', minutes: 60 },
    { label: '2 hrs', minutes: 120 },
    { label: '4 hrs', minutes: 240 },
    { label: '8 hrs', minutes: 480 },
    { label: 'Never', minutes: 0 },
];

const PRICING_LABELS: Record<string, { label: string; unit: string; hint: string }> = {
    BASE_FARE_CENTS: { label: 'Base Fare', unit: 'TTD', hint: 'Flat charge at start of every ride' },
    PER_KM_CENTS: { label: 'Per Kilometre', unit: 'TTD/km', hint: 'Distance rate applied to total route km' },
    PER_MIN_CENTS: { label: 'Per Minute', unit: 'TTD/min', hint: 'Time rate — applies while trip is active' },
    MIN_FARE_CENTS: { label: 'Minimum Fare', unit: 'TTD', hint: 'Floor — no ride can cost less than this' },
};

const KEY_ORDER = ['BASE_FARE_CENTS', 'PER_KM_CENTS', 'PER_MIN_CENTS', 'MIN_FARE_CENTS'];

const PLATFORM_RATE_LABELS: Record<string, { label: string; icon: string; color: string }> = {
    PLATFORM_RATE_CENTS_RIDE:     { label: 'Rides',      icon: '🚗',  color: 'text-cyan-400' },
    PLATFORM_RATE_CENTS_GROCERY:  { label: 'Grocery',    icon: '🛒',  color: 'text-green-400' },
    PLATFORM_RATE_CENTS_LAUNDRY:  { label: 'Laundry',    icon: '👕',  color: 'text-blue-400' },
    PLATFORM_RATE_CENTS_TRAVEL:   { label: 'G-Escape',   icon: '✈️',  color: 'text-purple-400' },
    PLATFORM_RATE_CENTS_DELIVERY: { label: 'Delivery',   icon: '📦',  color: 'text-amber-400' },
    PLATFORM_RATE_CENTS_FOOD:     { label: 'Food',       icon: '🍔',  color: 'text-orange-400' },
    PLATFORM_RATE_CENTS_B2B:      { label: 'B2B',        icon: '🏢',  color: 'text-rose-400' },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function centsToTTD(cents: number): string {
    return (cents / 100).toFixed(2);
}

function ttdToCents(ttd: string): number {
    return Math.round(parseFloat(ttd) * 100);
}

function previewFare(
    baseCents: number,
    perKmCents: number,
    perMinCents: number,
    minCents: number,
    distKm: number,
    durMin: number,
    surge: number,
): number {
    const raw = baseCents + Math.round(distKm * perKmCents) + Math.round(durMin * perMinCents);
    return Math.max(Math.round(raw * surge), minCents);
}

function formatExpiry(expiresAt: string | null): string {
    if (!expiresAt) return 'Never';
    const d = new Date(expiresAt);
    const diff = d.getTime() - Date.now();
    if (diff < 0) return 'Expired';
    const mins = Math.round(diff / 60000);
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    const rem = mins % 60;
    return rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`;
}

function coordLabel(lat: number, lng: number): string {
    const ns = lat >= 0 ? 'N' : 'S';
    const ew = lng >= 0 ? 'E' : 'W';
    return `${Math.abs(lat).toFixed(4)}°${ns}, ${Math.abs(lng).toFixed(4)}°${ew}`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function Pricing() {
    // ── Fare rates state ──────────────────────────────────────────────────────
    const [rates, setRates] = useState<PricingConfig[]>([]);
    const [editing, setEditing] = useState<Record<string, string>>({});
    const [saving, setSaving] = useState(false);
    const [previewDist, setPreviewDist] = useState('5');
    const [previewDur, setPreviewDur] = useState('12');
    const [previewSurge, setPreviewSurge] = useState('1.0');

    // ── Surge zones state ─────────────────────────────────────────────────────
    const [zones, setZones] = useState<SurgeZone[]>([]);
    const [loadingZones, setLoadingZones] = useState(true);
    const [deactivating, setDeactivating] = useState<string | null>(null);

    // ── Create zone form state ────────────────────────────────────────────────
    const [presetIdx, setPresetIdx] = useState(0);
    const [customLat, setCustomLat] = useState('');
    const [customLng, setCustomLng] = useState('');
    const [zoneRadius, setZoneRadius] = useState(2000);
    const [zoneMultiplier, setZoneMultiplier] = useState(1.3);
    const [customMultiplier, setCustomMultiplier] = useState('');
    const [zoneReason, setZoneReason] = useState('');
    const [zoneExpiry, setZoneExpiry] = useState(60);
    const [creatingZone, setCreatingZone] = useState(false);

    // ── Platform rates state ──────────────────────────────────────────────────
    const [platRates, setPlatRates] = useState<PricingConfig[]>([]);
    const [platEditing, setPlatEditing] = useState<Record<string, string>>({});
    const [savingPlat, setSavingPlat] = useState(false);

    // ── Vehicle classes state ─────────────────────────────────────────────────
    const [vehicleClasses, setVehicleClasses] = useState<VehicleClass[]>([]);
    const [vcEditing, setVcEditing] = useState<Record<string, { multiplier?: string; minFare?: string; landedCost?: string; costSource?: string }>>({});
    const [vcBusy, setVcBusy] = useState<string | null>(null);

    // ── Shared toast ──────────────────────────────────────────────────────────
    const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

    const flash = (text: string, ok: boolean) => {
        setMsg({ text, ok });
        setTimeout(() => setMsg(null), 3500);
    };

    // ── Load ──────────────────────────────────────────────────────────────────
    const loadRates = useCallback(async () => {
        const { data, error } = await supabase.rpc('admin_get_pricing');
        if (error) {
            flash(`Failed to load pricing: ${error.message}`, false);
        } else {
            setRates((data as PricingConfig[]) || []);
        }
    }, []);

    const loadZones = useCallback(async () => {
        setLoadingZones(true);
        const { data, error } = await supabase.rpc('admin_get_surge_zones');
        if (error) {
            flash(`Failed to load surge zones: ${error.message}`, false);
        } else {
            setZones((data as SurgeZone[]) || []);
        }
        setLoadingZones(false);
    }, []);

    const loadPlatRates = useCallback(async () => {
        const { data, error } = await supabase.rpc('admin_get_platform_rates');
        if (error) {
            flash(`Failed to load platform rates: ${error.message}`, false);
        } else {
            setPlatRates((data as PricingConfig[]) || []);
        }
    }, []);

    const loadVehicleClasses = useCallback(async () => {
        const { data, error } = await supabase.rpc('admin_get_vehicle_classes');
        if (error) {
            flash(`Failed to load vehicle classes: ${error.message}`, false);
        } else {
            setVehicleClasses((data as VehicleClass[]) || []);
        }
    }, []);

    useEffect(() => {
        loadRates();
        loadZones();
        loadPlatRates();
        loadVehicleClasses();
    }, [loadRates, loadZones, loadPlatRates, loadVehicleClasses]);

    // ── Fare rate save ────────────────────────────────────────────────────────
    const saveRates = async () => {
        const dirty = Object.entries(editing).filter(([key]) =>
            rates.some(r => r.key === key),
        );
        if (dirty.length === 0) {
            flash('No changes to save', false);
            return;
        }

        setSaving(true);
        let failed = false;

        for (const [key, rawVal] of dirty) {
            const cents = ttdToCents(rawVal);
            if (isNaN(cents) || cents < 1) {
                flash(`Invalid value for ${PRICING_LABELS[key]?.label ?? key}`, false);
                setSaving(false);
                return;
            }
            const { error } = await supabase.rpc('admin_set_pricing', {
                p_key: key,
                p_value_cents: cents,
            });
            if (error) {
                flash(`Failed to save ${PRICING_LABELS[key]?.label}: ${error.message}`, false);
                failed = true;
                break;
            }
        }

        if (!failed) {
            flash('Fare rates saved — estimate_fare will use these on next call', true);
            setEditing({});
            await loadRates();
        }
        setSaving(false);
    };

    // ── Surge zone actions ────────────────────────────────────────────────────
    const deactivateZone = async (zoneId: string) => {
        setDeactivating(zoneId);
        const { error } = await supabase.rpc('admin_deactivate_surge_zone', {
            p_zone_id: zoneId,
        });
        if (error) {
            flash(`Deactivate failed: ${error.message}`, false);
        } else {
            flash('Surge zone deactivated', true);
            await loadZones();
        }
        setDeactivating(null);
    };

    const createZone = async () => {
        const preset = LOCATION_PRESETS[presetIdx];
        const isCustom = preset.name === 'Custom';
        const lat = isCustom ? parseFloat(customLat) : preset.lat;
        const lng = isCustom ? parseFloat(customLng) : preset.lng;

        if (isNaN(lat) || isNaN(lng)) {
            flash('Enter valid coordinates', false);
            return;
        }
        if (!zoneReason.trim()) {
            flash('Reason is required', false);
            return;
        }

        const multiplierVal = customMultiplier
            ? parseFloat(customMultiplier)
            : zoneMultiplier;

        if (isNaN(multiplierVal) || multiplierVal < 1.0 || multiplierVal > 5.0) {
            flash('Multiplier must be 1.0–5.0', false);
            return;
        }

        const expiresAt = zoneExpiry > 0
            ? new Date(Date.now() + zoneExpiry * 60 * 1000).toISOString()
            : null;

        setCreatingZone(true);
        const { error } = await supabase.rpc('admin_create_surge_zone', {
            p_lat: lat,
            p_lng: lng,
            p_radius_m: zoneRadius,
            p_multiplier: multiplierVal,
            p_reason: zoneReason.trim(),
            p_expires_at: expiresAt,
        });

        if (error) {
            flash(`Create zone failed: ${error.message}`, false);
        } else {
            flash(`${multiplierVal}x surge active over ${preset.name !== 'Custom' ? preset.name : coordLabel(lat, lng)}`, true);
            setZoneReason('');
            setCustomLat('');
            setCustomLng('');
            setPresetIdx(0);
            setZoneMultiplier(1.3);
            setCustomMultiplier('');
            setZoneExpiry(60);
            await loadZones();
        }
        setCreatingZone(false);
    };

    // ── Derived preview values ────────────────────────────────────────────────
    const getRateValue = (key: string): number => {
        if (editing[key] !== undefined) {
            const v = ttdToCents(editing[key]);
            return isNaN(v) ? 0 : v;
        }
        return rates.find(r => r.key === key)?.value_cents ?? 0;
    };

    const previewFareCents = previewFare(
        getRateValue('BASE_FARE_CENTS'),
        getRateValue('PER_KM_CENTS'),
        getRateValue('PER_MIN_CENTS'),
        getRateValue('MIN_FARE_CENTS'),
        parseFloat(previewDist) || 0,
        parseFloat(previewDur) || 0,
        parseFloat(previewSurge) || 1.0,
    );

    // ── Platform rate save ────────────────────────────────────────────────────
    const savePlatRates = async () => {
        const dirty = Object.entries(platEditing).filter(([key]) =>
            platRates.some(r => r.key === key),
        );
        if (dirty.length === 0) {
            flash('No platform rate changes to save', false);
            return;
        }

        setSavingPlat(true);
        let failed = false;

        for (const [key, rawVal] of dirty) {
            const pct = parseFloat(rawVal);
            if (isNaN(pct) || pct < 0.5 || pct > 50) {
                flash(`Invalid percentage for ${PLATFORM_RATE_LABELS[key]?.label ?? key}`, false);
                setSavingPlat(false);
                return;
            }
            const cents = Math.round(pct * 100);
            const { error } = await supabase.rpc('admin_set_pricing', {
                p_key: key,
                p_value_cents: cents,
            });
            if (error) {
                flash(`Failed to save ${PLATFORM_RATE_LABELS[key]?.label}: ${error.message}`, false);
                failed = true;
                break;
            }
        }

        if (!failed) {
            flash('Platform rates saved — all verticals use these on next transaction', true);
            setPlatEditing({});
            await loadPlatRates();
        }
        setSavingPlat(false);
    };

    // ── Vehicle class actions ─────────────────────────────────────────────────
    const toggleVehicleClass = async (vc: VehicleClass) => {
        setVcBusy(vc.key);
        const { error } = await supabase.rpc('admin_set_vehicle_class', {
            p_key: vc.key,
            p_is_active: !vc.is_active,
        });
        if (error) {
            flash(`Toggle failed for ${vc.label}: ${error.message}`, false);
        } else {
            flash(
                !vc.is_active
                    ? `${vc.label} is now LIVE — riders can book it immediately`
                    : `${vc.label} switched off — hidden from riders`,
                true,
            );
            await loadVehicleClasses();
        }
        setVcBusy(null);
    };

    const saveVehicleClass = async (vc: VehicleClass) => {
        const edit = vcEditing[vc.key];
        if (!edit) return;

        const params: Record<string, unknown> = { p_key: vc.key };
        if (edit.multiplier !== undefined) {
            const m = Math.round(parseFloat(edit.multiplier) * 100);
            if (isNaN(m) || m < 100 || m > 1000) {
                flash(`Multiplier for ${vc.label} must be 1.0–10.0`, false);
                return;
            }
            params.p_multiplier_x100 = m;
        }
        if (edit.minFare !== undefined) {
            const f = edit.minFare === '' ? null : ttdToCents(edit.minFare);
            if (f !== null && (isNaN(f) || f < 0)) {
                flash(`Invalid minimum fare for ${vc.label}`, false);
                return;
            }
            if (f !== null) params.p_min_fare_cents = f;
        }
        if (edit.landedCost !== undefined && edit.landedCost !== '') {
            const c = ttdToCents(edit.landedCost);
            if (isNaN(c) || c < 0) {
                flash(`Invalid landed cost for ${vc.label}`, false);
                return;
            }
            const source = (edit.costSource ?? vc.cost_source ?? '').trim();
            if (!source) {
                flash(`A source is required for ${vc.label}'s landed cost — where did this number come from?`, false);
                return;
            }
            params.p_landed_cost_cents = c;
            params.p_cost_source = source;
        }

        setVcBusy(vc.key);
        const { error } = await supabase.rpc('admin_set_vehicle_class', params);
        if (error) {
            flash(`Save failed for ${vc.label}: ${error.message}`, false);
        } else {
            flash(`${vc.label} updated — fares use the new rate on next estimate`, true);
            setVcEditing(prev => {
                const next = { ...prev };
                delete next[vc.key];
                return next;
            });
            await loadVehicleClasses();
        }
        setVcBusy(null);
    };

    const isDirty = Object.keys(editing).some(k => rates.some(r => r.key === k));

    return (
        <div className="space-y-12">

            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-black text-white italic">PRICING</h2>
                    <p className="text-xs text-white/30 uppercase tracking-widest mt-1">
                        Fare Rates · Surge Zones · Live on next request
                    </p>
                </div>
                <button
                    onClick={() => { loadRates(); loadZones(); }}
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

            {/* ── Fare Rates ──────────────────────────────────────────────────── */}
            <section>
                <div className="flex items-center gap-3 mb-6">
                    <DollarSign size={18} className="text-cyan-400" />
                    <div>
                        <h3 className="font-black text-white uppercase tracking-wider text-sm">Fare Rates</h3>
                        <p className="text-[10px] text-white/30 uppercase tracking-widest">
                            Changes apply to new ride estimates immediately
                        </p>
                    </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                    {KEY_ORDER.map(key => {
                        const config = rates.find(r => r.key === key);
                        const meta = PRICING_LABELS[key];
                        const currentCents = config?.value_cents ?? 0;
                        const editVal = editing[key] ?? centsToTTD(currentCents);
                        const isDirtyField = editing[key] !== undefined &&
                            editing[key] !== centsToTTD(currentCents);

                        return (
                            <div key={key} className={`bg-white/5 rounded-2xl p-5 border transition-all ${
                                isDirtyField ? 'border-amber-400/30' : 'border-white/5'
                            }`}>
                                <p className="text-[10px] text-white/30 uppercase tracking-widest mb-1">
                                    {meta?.unit}
                                </p>
                                <p className="font-black text-white text-sm mb-1">{meta?.label}</p>
                                <p className="text-[10px] text-white/20 mb-4">{meta?.hint}</p>

                                <div className="flex items-center gap-2">
                                    <span className="text-white/40 text-sm font-mono">TTD$</span>
                                    <input
                                        type="number"
                                        min="0.01"
                                        step="0.01"
                                        value={editVal}
                                        onChange={e =>
                                            setEditing(prev => ({ ...prev, [key]: e.target.value }))
                                        }
                                        className="flex-1 bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-white font-mono text-lg font-bold focus:outline-none focus:border-cyan-400/50 transition-colors"
                                    />
                                </div>

                                {isDirtyField && (
                                    <p className="text-[10px] text-amber-400/70 mt-2">
                                        Changed from TTD${centsToTTD(currentCents)}
                                    </p>
                                )}
                            </div>
                        );
                    })}
                </div>

                {/* Preview calculator */}
                <div className="bg-white/3 rounded-2xl p-5 border border-white/5 mb-6">
                    <p className="text-[10px] font-black text-white/30 uppercase tracking-[0.4em] mb-4">
                        Fare Preview Calculator
                    </p>
                    <div className="flex flex-wrap gap-4 items-end">
                        <div>
                            <label className="text-[10px] text-white/30 uppercase tracking-widest block mb-1">
                                Distance (km)
                            </label>
                            <input
                                type="number"
                                min="0"
                                step="0.5"
                                value={previewDist}
                                onChange={e => setPreviewDist(e.target.value)}
                                className="w-24 bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-white font-mono text-sm focus:outline-none focus:border-cyan-400/50"
                            />
                        </div>
                        <div>
                            <label className="text-[10px] text-white/30 uppercase tracking-widest block mb-1">
                                Duration (min)
                            </label>
                            <input
                                type="number"
                                min="0"
                                step="1"
                                value={previewDur}
                                onChange={e => setPreviewDur(e.target.value)}
                                className="w-24 bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-white font-mono text-sm focus:outline-none focus:border-cyan-400/50"
                            />
                        </div>
                        <div>
                            <label className="text-[10px] text-white/30 uppercase tracking-widest block mb-1">
                                Surge
                            </label>
                            <input
                                type="number"
                                min="1.0"
                                max="5.0"
                                step="0.1"
                                value={previewSurge}
                                onChange={e => setPreviewSurge(e.target.value)}
                                className="w-20 bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-white font-mono text-sm focus:outline-none focus:border-cyan-400/50"
                            />
                        </div>
                        <div className="px-6 py-3 rounded-xl bg-cyan-400/10 border border-cyan-400/20">
                            <p className="text-[10px] text-cyan-400/60 uppercase tracking-widest">Est. Fare</p>
                            <p className="text-2xl font-black text-cyan-400 font-mono">
                                TTD ${centsToTTD(previewFareCents)}
                            </p>
                        </div>
                    </div>
                </div>

                <button
                    onClick={saveRates}
                    disabled={!isDirty || saving}
                    className={`h-12 px-8 rounded-xl font-black text-xs uppercase tracking-widest transition-all flex items-center gap-2 ${
                        isDirty && !saving
                            ? 'bg-cyan-400 text-black hover:bg-cyan-300'
                            : 'bg-white/5 text-white/20 cursor-not-allowed'
                    }`}
                >
                    {saving ? (
                        <div className="w-4 h-4 border-2 border-black/40 border-t-transparent rounded-full animate-spin" />
                    ) : null}
                    {saving ? 'Saving...' : isDirty ? 'Save Rates' : 'No Changes'}
                </button>
            </section>

            {/* ── Vehicle Classes ─────────────────────────────────────────────── */}
            <section>
                <div className="flex items-center gap-3 mb-6">
                    <Truck size={18} className="text-green-400" />
                    <div>
                        <h3 className="font-black text-white uppercase tracking-wider text-sm">Vehicle Classes</h3>
                        <p className="text-[10px] text-white/30 uppercase tracking-widest">
                            Toggle a class live and riders can book it instantly — heavy classes (truck / hiab / wrecker) ship OFF
                        </p>
                    </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {vehicleClasses.map(vc => {
                        const edit = vcEditing[vc.key] ?? {};
                        const multVal = edit.multiplier ?? (vc.multiplier_x100 / 100).toFixed(2);
                        const minFareVal = edit.minFare ?? (vc.min_fare_cents != null ? centsToTTD(vc.min_fare_cents) : '');
                        const landedCostVal = edit.landedCost ?? (vc.landed_cost_cents != null ? centsToTTD(vc.landed_cost_cents) : '');
                        const costSourceVal = edit.costSource ?? vc.cost_source ?? '';
                        const isDirtyVc = edit.multiplier !== undefined || edit.minFare !== undefined || edit.landedCost !== undefined || edit.costSource !== undefined;
                        const busy = vcBusy === vc.key;

                        return (
                            <div key={vc.key} className={`bg-white/5 rounded-2xl p-5 border transition-all ${
                                vc.is_active ? 'border-green-400/20' : 'border-white/5 opacity-80'
                            }`}>
                                <div className="flex items-center justify-between mb-1">
                                    <p className="font-black text-white text-sm">{vc.label}</p>
                                    <div className="flex items-center gap-2">
                                        {vc.category === 'heavy' && (
                                            <span className="px-2 py-0.5 rounded-lg bg-amber-400/10 border border-amber-400/20 text-amber-400 text-[9px] font-black uppercase tracking-widest">
                                                Heavy
                                            </span>
                                        )}
                                        <button
                                            onClick={() => toggleVehicleClass(vc)}
                                            disabled={busy}
                                            className={`px-3 py-1 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-40 ${
                                                vc.is_active
                                                    ? 'bg-green-400 text-black hover:bg-green-300'
                                                    : 'bg-white/5 border border-white/10 text-white/40 hover:text-white hover:bg-white/10'
                                            }`}
                                        >
                                            {busy ? '···' : vc.is_active ? 'Live' : 'Off'}
                                        </button>
                                    </div>
                                </div>
                                <p className="text-[10px] text-white/20 mb-4">{vc.description}</p>

                                <div className="flex gap-3">
                                    <div className="flex-1">
                                        <label className="text-[10px] text-white/30 uppercase tracking-widest block mb-1">
                                            Multiplier
                                        </label>
                                        <input
                                            type="number"
                                            min="1.0"
                                            max="10.0"
                                            step="0.05"
                                            value={multVal}
                                            onChange={e =>
                                                setVcEditing(prev => ({
                                                    ...prev,
                                                    [vc.key]: { ...prev[vc.key], multiplier: e.target.value },
                                                }))
                                            }
                                            className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-white font-mono text-sm font-bold focus:outline-none focus:border-green-400/50"
                                        />
                                    </div>
                                    <div className="flex-1">
                                        <label className="text-[10px] text-white/30 uppercase tracking-widest block mb-1">
                                            Min Fare TTD
                                        </label>
                                        <input
                                            type="number"
                                            min="0"
                                            step="1"
                                            placeholder="—"
                                            value={minFareVal}
                                            onChange={e =>
                                                setVcEditing(prev => ({
                                                    ...prev,
                                                    [vc.key]: { ...prev[vc.key], minFare: e.target.value },
                                                }))
                                            }
                                            className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-white font-mono text-sm font-bold placeholder:text-white/20 focus:outline-none focus:border-green-400/50"
                                        />
                                    </div>
                                </div>

                                <div className="mt-3 pt-3 border-t border-white/5">
                                    <label className="text-[10px] text-white/30 uppercase tracking-widest block mb-1">
                                        Real Landed Cost (TTD) — this is what G Garage payback math is missing without it
                                    </label>
                                    <div className="flex gap-2">
                                        <input
                                            type="number" min="0" step="1" placeholder="No real quote entered yet"
                                            value={landedCostVal}
                                            onChange={e =>
                                                setVcEditing(prev => ({
                                                    ...prev,
                                                    [vc.key]: { ...prev[vc.key], landedCost: e.target.value },
                                                }))
                                            }
                                            className="w-1/2 bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-white font-mono text-sm font-bold placeholder:text-white/20 focus:outline-none focus:border-cyan-400/50"
                                        />
                                        <input
                                            type="text" placeholder="Source (required), e.g. ATL Automotive quote 2026-08-01"
                                            value={costSourceVal}
                                            onChange={e =>
                                                setVcEditing(prev => ({
                                                    ...prev,
                                                    [vc.key]: { ...prev[vc.key], costSource: e.target.value },
                                                }))
                                            }
                                            className="w-1/2 bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-white text-xs placeholder:text-white/20 focus:outline-none focus:border-cyan-400/50"
                                        />
                                    </div>
                                    {vc.landed_cost_cents != null && (
                                        <p className="text-[9px] text-white/20 mt-1">
                                            {vc.cost_source} — entered {vc.cost_updated_at ? new Date(vc.cost_updated_at).toLocaleDateString() : ''}
                                        </p>
                                    )}
                                </div>

                                {isDirtyVc && (
                                    <button
                                        onClick={() => saveVehicleClass(vc)}
                                        disabled={busy}
                                        className="mt-3 w-full h-9 rounded-xl bg-green-400 text-black font-black text-[10px] uppercase tracking-widest hover:bg-green-300 disabled:opacity-40 transition-all"
                                    >
                                        {busy ? 'Saving…' : 'Save'}
                                    </button>
                                )}
                            </div>
                        );
                    })}
                </div>
            </section>

            {/* ── Surge Zones ─────────────────────────────────────────────────── */}
            <section>
                <div className="flex items-center gap-3 mb-6">
                    <Zap size={18} className="text-amber-400" />
                    <div>
                        <h3 className="font-black text-white uppercase tracking-wider text-sm">Surge Zones</h3>
                        <p className="text-[10px] text-white/30 uppercase tracking-widest">
                            Geographic multipliers — active riders in each zone pay the surge rate
                        </p>
                    </div>
                </div>

                {/* Active zones */}
                {loadingZones ? (
                    <div className="flex items-center gap-3 py-8 text-white/20">
                        <div className="w-5 h-5 border-2 border-white/20 border-t-transparent rounded-full animate-spin" />
                        <span className="text-xs font-mono uppercase tracking-widest">Loading zones</span>
                    </div>
                ) : zones.length === 0 ? (
                    <div className="py-8 px-5 rounded-2xl border border-dashed border-white/10 text-center mb-8">
                        <Zap size={24} className="text-white/40 mx-auto mb-2" />
                        <p className="text-sm text-white/60 font-bold">No active surge zones</p>
                        <p className="text-xs text-white/40 mt-1">Base pricing applies across all of TT</p>
                    </div>
                ) : (
                    <div className="space-y-3 mb-8">
                        {zones.map(zone => (
                            <div
                                key={zone.id}
                                className="bg-white/5 rounded-2xl p-5 border border-amber-400/15 flex items-start justify-between gap-4 flex-wrap"
                            >
                                <div className="space-y-1 min-w-0">
                                    <div className="flex items-center gap-3 flex-wrap">
                                        <span className="text-xl font-black text-amber-400 font-mono tabular-nums">
                                            {Number(zone.multiplier).toFixed(1)}x
                                        </span>
                                        <span className="text-[10px] font-mono text-white/30">
                                            {coordLabel(zone.center_lat, zone.center_lng)}
                                        </span>
                                        <span className="text-[10px] font-black text-white/20 uppercase tracking-widest">
                                            r={zone.radius_meters >= 1000
                                                ? `${(zone.radius_meters / 1000).toFixed(1)}km`
                                                : `${zone.radius_meters}m`}
                                        </span>
                                    </div>
                                    {zone.reason && (
                                        <p className="text-xs text-white/50">{zone.reason}</p>
                                    )}
                                    <div className="flex items-center gap-2">
                                        <Clock size={11} className="text-white/20" />
                                        <span className="text-[10px] text-white/20 font-mono">
                                            {zone.expires_at
                                                ? `Expires ${formatExpiry(zone.expires_at)}`
                                                : 'No expiry'
                                            }
                                        </span>
                                    </div>
                                </div>
                                <button
                                    onClick={() => deactivateZone(zone.id)}
                                    disabled={deactivating === zone.id}
                                    className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-red-500/20 text-red-400 text-[10px] font-black uppercase tracking-widest hover:bg-red-500/10 disabled:opacity-40 transition-all"
                                >
                                    {deactivating === zone.id ? (
                                        <div className="w-3.5 h-3.5 border-2 border-red-400 border-t-transparent rounded-full animate-spin" />
                                    ) : (
                                        <X size={12} />
                                    )}
                                    End
                                </button>
                            </div>
                        ))}
                    </div>
                )}

                {/* Create zone form */}
                <div className="bg-white/3 rounded-2xl p-6 border border-white/5">
                    <p className="text-[10px] font-black text-white/30 uppercase tracking-[0.4em] mb-5">
                        Create Surge Zone
                    </p>

                    {/* Location preset */}
                    <div className="mb-5">
                        <p className="text-[10px] text-white/30 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                            <MapPin size={11} /> Location
                        </p>
                        <div className="flex flex-wrap gap-2">
                            {LOCATION_PRESETS.map((p, i) => (
                                <button
                                    key={p.name}
                                    onClick={() => setPresetIdx(i)}
                                    className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                                        presetIdx === i
                                            ? 'bg-white text-black'
                                            : 'bg-white/5 border border-white/10 text-white/40 hover:text-white hover:bg-white/10'
                                    }`}
                                >
                                    {p.name}
                                </button>
                            ))}
                        </div>

                        {LOCATION_PRESETS[presetIdx]?.name === 'Custom' && (
                            <div className="flex gap-3 mt-3">
                                <input
                                    type="number"
                                    placeholder="Latitude (e.g. 10.6596)"
                                    value={customLat}
                                    onChange={e => setCustomLat(e.target.value)}
                                    className="flex-1 bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-white font-mono text-xs placeholder:text-white/20 focus:outline-none focus:border-cyan-400/50"
                                />
                                <input
                                    type="number"
                                    placeholder="Longitude (e.g. -61.5086)"
                                    value={customLng}
                                    onChange={e => setCustomLng(e.target.value)}
                                    className="flex-1 bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-white font-mono text-xs placeholder:text-white/20 focus:outline-none focus:border-cyan-400/50"
                                />
                            </div>
                        )}
                    </div>

                    {/* Radius */}
                    <div className="mb-5">
                        <p className="text-[10px] text-white/30 uppercase tracking-widest mb-2">Radius</p>
                        <div className="flex gap-2">
                            {RADIUS_OPTIONS.map(r => (
                                <button
                                    key={r.value}
                                    onClick={() => setZoneRadius(r.value)}
                                    className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                                        zoneRadius === r.value
                                            ? 'bg-white text-black'
                                            : 'bg-white/5 border border-white/10 text-white/40 hover:text-white hover:bg-white/10'
                                    }`}
                                >
                                    {r.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Multiplier */}
                    <div className="mb-5">
                        <p className="text-[10px] text-white/30 uppercase tracking-widest mb-2">Multiplier</p>
                        <div className="flex flex-wrap gap-2 items-center">
                            {MULTIPLIER_OPTIONS.map(m => (
                                <button
                                    key={m}
                                    onClick={() => { setZoneMultiplier(m); setCustomMultiplier(''); }}
                                    className={`px-3 py-1.5 rounded-xl text-[10px] font-black font-mono transition-all ${
                                        zoneMultiplier === m && !customMultiplier
                                            ? 'bg-amber-400 text-black'
                                            : 'bg-white/5 border border-white/10 text-white/40 hover:text-white hover:bg-white/10'
                                    }`}
                                >
                                    {m}x
                                </button>
                            ))}
                            <input
                                type="number"
                                placeholder="Custom"
                                min="1.0"
                                max="5.0"
                                step="0.05"
                                value={customMultiplier}
                                onChange={e => setCustomMultiplier(e.target.value)}
                                className="w-24 bg-black/40 border border-white/10 rounded-xl px-3 py-1.5 text-white font-mono text-xs placeholder:text-white/20 focus:outline-none focus:border-amber-400/50"
                            />
                        </div>
                    </div>

                    {/* Reason */}
                    <div className="mb-5">
                        <p className="text-[10px] text-white/30 uppercase tracking-widest mb-2">Reason</p>
                        <input
                            type="text"
                            placeholder="e.g. Carnival Monday traffic — North POS"
                            value={zoneReason}
                            onChange={e => setZoneReason(e.target.value)}
                            maxLength={120}
                            className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-cyan-400/50"
                        />
                    </div>

                    {/* Expiry */}
                    <div className="mb-6">
                        <p className="text-[10px] text-white/30 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                            <Clock size={11} /> Expires In
                        </p>
                        <div className="flex flex-wrap gap-2">
                            {EXPIRY_OPTIONS.map(e => (
                                <button
                                    key={e.label}
                                    onClick={() => setZoneExpiry(e.minutes)}
                                    className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                                        zoneExpiry === e.minutes
                                            ? 'bg-white text-black'
                                            : 'bg-white/5 border border-white/10 text-white/40 hover:text-white hover:bg-white/10'
                                    }`}
                                >
                                    {e.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    <button
                        onClick={createZone}
                        disabled={creatingZone}
                        className="h-12 px-8 rounded-xl bg-amber-400 text-black font-black text-xs uppercase tracking-widest hover:bg-amber-300 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-2"
                    >
                        {creatingZone ? (
                            <div className="w-4 h-4 border-2 border-black/40 border-t-transparent rounded-full animate-spin" />
                        ) : (
                            <Zap size={14} />
                        )}
                        {creatingZone ? 'Activating...' : 'Activate Surge Zone'}
                    </button>
                </div>
            </section>

            {/* ── Platform Rates ──────────────────────────────────────────────── */}
            <section>
                <div className="flex items-center gap-3 mb-6">
                    <Percent size={18} className="text-purple-400" />
                    <div>
                        <h3 className="font-black text-white uppercase tracking-wider text-sm">Platform Rates</h3>
                        <p className="text-[10px] text-white/30 uppercase tracking-widest">
                            Commission % per vertical — changes apply to next transaction
                        </p>
                    </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
                    {platRates.map(pr => {
                        const meta = PLATFORM_RATE_LABELS[pr.key] || { label: pr.key, icon: '📊', color: 'text-white' };
                        const currentPct = (pr.value_cents / 100).toFixed(1);
                        const editVal = platEditing[pr.key] ?? currentPct;
                        const isDirtyField = platEditing[pr.key] !== undefined &&
                            platEditing[pr.key] !== currentPct;

                        return (
                            <div key={pr.key} className={`bg-white/5 rounded-2xl p-5 border transition-all ${
                                isDirtyField ? 'border-purple-400/30' : 'border-white/5'
                            }`}>
                                <div className="flex items-center gap-2 mb-3">
                                    <span className="text-lg">{meta.icon}</span>
                                    <p className="font-black text-white text-sm">{meta.label}</p>
                                </div>
                                <p className="text-[10px] text-white/30 mb-3">{pr.description}</p>

                                <div className="flex items-center gap-2">
                                    <input
                                        type="number"
                                        min="0.5"
                                        max="50"
                                        step="0.1"
                                        value={editVal}
                                        onChange={e =>
                                            setPlatEditing(prev => ({ ...prev, [pr.key]: e.target.value }))
                                        }
                                        className="flex-1 bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-white font-mono text-lg font-bold focus:outline-none focus:border-purple-400/50 transition-colors"
                                    />
                                    <span className="text-white/40 text-sm font-mono">%</span>
                                </div>

                                {isDirtyField && (
                                    <p className="text-[10px] text-amber-400/70 mt-2">
                                        Changed from {currentPct}%
                                    </p>
                                )}
                            </div>
                        );
                    })}
                </div>

                <button
                    onClick={savePlatRates}
                    disabled={Object.keys(platEditing).length === 0 || savingPlat}
                    className={`h-12 px-8 rounded-xl font-black text-xs uppercase tracking-widest transition-all flex items-center gap-2 ${
                        Object.keys(platEditing).length > 0 && !savingPlat
                            ? 'bg-purple-400 text-black hover:bg-purple-300'
                            : 'bg-white/5 text-white/20 cursor-not-allowed'
                    }`}
                >
                    {savingPlat ? (
                        <div className="w-4 h-4 border-2 border-black/40 border-t-transparent rounded-full animate-spin" />
                    ) : null}
                    {savingPlat ? 'Saving...' : Object.keys(platEditing).length > 0 ? 'Save Rate Changes' : 'No Changes'}
                </button>
            </section>
        </div>
    );
}
