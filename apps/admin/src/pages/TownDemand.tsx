import { useEffect, useMemo, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { Loader2, MapPin, MessageCircle, RefreshCw } from 'lucide-react';

// Who is asking for G 868 in each town, and which waitlist drivers are closest.
// You send the messages yourself: each button only opens WhatsApp with a draft.
// Drivers come from the waitlist because this page cannot read the drivers table.

export type WaitlistEntry = {
    id: string;
    full_name: string;
    phone: string | null;
    user_type: string | null;
    status: string | null;
    community: string | null;
    source: string | null;
    details: { area?: string; town_lat?: number; town_lng?: number } | null;
};

export type NearbyDriver = { id: string; name: string; phone: string | null; town: string; km: number };

export type TownRow = {
    key: string;
    town: string;
    area: string | null;
    approximate: boolean;
    riders: number;
    shops: number;
    drivers: NearbyDriver[];
};

// Sign-ups from before the town search only named one of these areas.
const AREA_CENTRES: Record<string, [number, number]> = {
    'Port of Spain': [10.657, -61.518],
    'San Fernando': [10.281, -61.465],
    'Chaguanas': [10.515, -61.408],
    'Arima': [10.637, -61.283],
    'Diego Martin / Westmoorings': [10.736, -61.558],
    'Tunapuna / St. Augustine': [10.645, -61.395],
    'Couva / Point Lisas': [10.41, -61.47],
    'Sangre Grande': [10.587, -61.128],
    'Princes Town / Debe': [10.24, -61.41],
    'Tobago': [11.185, -60.735],
};

const SHOWN_DRIVERS = 5;

export function kmBetween(a: [number, number], b: [number, number]) {
    const midLat = ((a[0] + b[0]) / 2) * (Math.PI / 180);
    return Math.hypot(a[0] - b[0], (a[1] - b[1]) * Math.cos(midLat)) * 111.2;
}

function position(r: WaitlistEntry): { at: [number, number]; approximate: boolean } | null {
    const lat = r.details?.town_lat;
    const lng = r.details?.town_lng;
    if (typeof lat === 'number' && typeof lng === 'number') return { at: [lat, lng], approximate: false };
    const centre = r.community ? AREA_CENTRES[r.community] : undefined;
    return centre ? { at: centre, approximate: true } : null;
}

export function buildTownDemand(rows: WaitlistEntry[]): { towns: TownRow[]; unplaced: number } {
    const live = rows.filter((r) => r.status !== 'rejected');
    const drivers = live
        .filter((r) => r.source === 'g868:Driver')
        .map((r) => ({ r, pos: position(r) }))
        .filter((d) => d.pos);

    const towns = new Map<string, TownRow & { at: [number, number] }>();
    let unplaced = 0;
    for (const r of live) {
        if (r.user_type !== 'ride' && r.user_type !== 'sell') continue;
        const pos = position(r);
        if (!pos || !r.community) { unplaced += 1; continue; }
        const key = `${r.community}|${pos.at.join(',')}`;
        const row = towns.get(key) ?? {
            key, town: r.community, area: r.details?.area ?? null, approximate: pos.approximate,
            riders: 0, shops: 0, drivers: [], at: pos.at,
        };
        if (r.user_type === 'ride') row.riders += 1; else row.shops += 1;
        towns.set(key, row);
    }

    const list = [...towns.values()].map(({ at, ...row }) => ({
        ...row,
        drivers: drivers
            .map(({ r, pos }) => ({
                id: r.id, name: r.full_name, phone: r.phone, town: r.community ?? '',
                km: kmBetween(at, pos!.at),
            }))
            .sort((a, b) => a.km - b.km)
            .slice(0, SHOWN_DRIVERS),
    }));
    list.sort((a, b) => b.riders - a.riders || b.shops - a.shops || a.town.localeCompare(b.town));
    return { towns: list, unplaced };
}

// 868 numbers as WhatsApp wants them. Null when it is not a T&T number.
export function whatsAppNumber(phone: string | null) {
    const digits = (phone ?? '').replace(/\D/g, '');
    if (digits.length === 7) return `1868${digits}`;
    if (digits.length === 10 && digits.startsWith('868')) return `1${digits}`;
    if (digits.length === 11 && digits.startsWith('1868')) return digits;
    return null;
}

export function draftMessage(driver: string, town: string, riders: number) {
    const who = riders === 1 ? '1 person' : `${riders} people`;
    return `Hi ${driver.split(' ')[0]}, this is G 868. ${who} near ${town} signed up for rides. You are one of the closest drivers. Are you interested in driving that area when it opens?`;
}

export function TownDemand() {
    const [rows, setRows] = useState<WaitlistEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true); setError(null);
        const { data, error: err } = await supabase
            .from('waitlist')
            .select('id, full_name, phone, user_type, status, community, source, details');
        if (err) setError('Could not load the waitlist. Refresh to try again.');
        setRows((data as WaitlistEntry[]) || []);
        setLoading(false);
    }, []);
    useEffect(() => { load(); }, [load]);

    const { towns, unplaced } = useMemo(() => buildTownDemand(rows), [rows]);

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-xl font-black text-white">Town demand</h2>
                    <p className="text-xs text-white/40 mt-1">Who is asking in each town, and the waitlist drivers closest to them.</p>
                </div>
                <button onClick={load} className="h-10 px-4 rounded-xl bg-white/5 border border-white/10 text-white/50 text-xs font-bold flex items-center gap-2"><RefreshCw size={14} /> Refresh</button>
            </div>

            {error && <p role="alert" className="text-sm text-red-400">{error}</p>}

            {loading ? (
                <div className="py-16 text-center"><Loader2 className="animate-spin mx-auto text-white/30" size={28} /></div>
            ) : towns.length === 0 ? (
                <div className="py-16 text-center rounded-3xl border border-dashed border-white/10">
                    <MapPin size={36} className="mx-auto mb-3 text-white/20" />
                    <p className="text-white/50 text-sm">Nobody has signed up with a town yet.</p>
                </div>
            ) : (
                <div className="space-y-4">
                    {towns.map((t) => (
                        <section key={t.key} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                            <div className="flex flex-wrap items-baseline justify-between gap-2">
                                <div>
                                    <h3 className="text-lg font-black text-white">{t.town}</h3>
                                    {t.area && <p className="text-xs text-white/40">{t.area}</p>}
                                    {t.approximate && <p className="text-xs text-amber-300/80">Signed up before town search, so distances are measured from the area's centre.</p>}
                                </div>
                                <p className="text-sm text-white/70">
                                    <span className="font-black text-white">{t.riders}</span> {t.riders === 1 ? 'rider' : 'riders'}
                                    {' · '}
                                    <span className="font-black text-white">{t.shops}</span> {t.shops === 1 ? 'shop' : 'shops'}
                                </p>
                            </div>

                            {t.drivers.length === 0 ? (
                                <p className="mt-3 text-sm text-white/40">No drivers on the waitlist yet.</p>
                            ) : (
                                <ul className="mt-3 divide-y divide-white/10">
                                    {t.drivers.map((d) => {
                                        const number = whatsAppNumber(d.phone);
                                        return (
                                            <li key={d.id} className="py-2.5 flex flex-wrap items-center justify-between gap-3">
                                                <div className="min-w-0">
                                                    <p className="text-sm font-bold text-white">{d.name}</p>
                                                    <p className="text-xs text-white/40">{d.km < 1 ? 'Under 1 km' : `${Math.round(d.km)} km`} away · {d.town} · {d.phone || 'No number'}</p>
                                                </div>
                                                {number ? (
                                                    <a
                                                        href={`https://wa.me/${number}?text=${encodeURIComponent(draftMessage(d.name, t.town, t.riders))}`}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        className="h-9 px-3 rounded-xl bg-emerald-500/15 border border-emerald-400/30 text-emerald-300 text-xs font-bold flex items-center gap-2"
                                                    >
                                                        <MessageCircle size={14} /> Draft WhatsApp
                                                    </a>
                                                ) : (
                                                    <span className="text-xs text-white/30">Check this number</span>
                                                )}
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </section>
                    ))}
                    {unplaced > 0 && <p className="text-xs text-white/40">{unplaced} sign-up{unplaced === 1 ? '' : 's'} left out because no town was given.</p>}
                </div>
            )}
        </div>
    );
}
