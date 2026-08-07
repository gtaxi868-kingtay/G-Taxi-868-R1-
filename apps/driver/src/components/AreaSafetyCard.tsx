// Reads back the safety map that drivers' own check-ins build.
//
// This is the payoff for "mark yourself safe". Until now the tap went into a
// column and died there. get_area_safety returns what the last 30 days of
// check-ins, missed check-ins and alarms say about wherever the driver is
// standing right now.
//
// PRIVACY: the RPC returns COUNTS AND A STATUS WORD ONLY — never a point,
// never a driver, never a ride. The underlying zone_safety_events table is
// revoked from authenticated outright, so this component could not read raw
// points even if it tried. Do not "improve" this by querying that table.
//
// TONE: an observation count is not a verdict on a neighbourhood. The copy
// below is deliberately flat — it reports what was logged and stops. Anything
// that reads like "bad area" would be both unfair and wrong, since the counts
// reflect where drivers happen to have worked, not where danger is.

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@gtaxi/core';

type Safety = {
    status: 'incident_reported' | 'check_in_missed' | 'routine' | 'limited_data' | 'no_data';
    drops: number;
    marked_safe: number;
    check_ins_missed: number;
    sos_events: number;
    lookback_days: number;
    radius_m: number;
};

const PRESENTATION: Record<Safety['status'], { label: string; note: string; colour: string; icon: string }> = {
    incident_reported: {
        label: 'Alert raised here recently',
        note: 'Someone raised an emergency alert in this area. Take the usual care.',
        colour: '#EF4444', icon: 'warning-outline',
    },
    check_in_missed: {
        label: 'A check-in was missed here',
        note: 'A driver did not confirm they were safe after a drop nearby.',
        colour: '#F59E0B', icon: 'alert-circle-outline',
    },
    routine: {
        label: 'Routine',
        note: 'Drops here have been followed by safe check-ins.',
        colour: '#22C55E', icon: 'shield-checkmark-outline',
    },
    limited_data: {
        label: 'Limited check-ins',
        note: 'Drops logged here, but few drivers confirmed afterwards.',
        colour: '#94A3B8', icon: 'help-circle-outline',
    },
    no_data: {
        label: 'No history yet',
        note: 'Nothing has been logged around here. Your check-ins build this.',
        colour: '#94A3B8', icon: 'ellipse-outline',
    },
};

export function AreaSafetyCard({ lat, lng }: { lat?: number | null; lng?: number | null }) {
    const [data, setData] = useState<Safety | null>(null);
    const [loading, setLoading] = useState(false);

    const load = useCallback(async () => {
        if (lat == null || lng == null) return;
        setLoading(true);
        // .then(ok, err): supabase.rpc returns a thenable with no .catch.
        const { data: res, error } = await supabase
            .rpc('get_area_safety', { p_lat: lat, p_lng: lng, p_radius_m: 2000 })
            .then((r: any) => r, (e: any) => ({ data: null, error: e }));
        setLoading(false);
        if (!error && res && !res.error) setData(res as Safety);
    }, [lat, lng]);

    useEffect(() => { load(); }, [load]);

    // A safety readout that shows a spinner or an error where a driver expects
    // information is worse than showing nothing. Stay silent until it is real.
    if (!data) return null;

    const p = PRESENTATION[data.status] ?? PRESENTATION.no_data;

    return (
        <TouchableOpacity
            style={[s.card, { borderColor: p.colour + '33' }]}
            onPress={load}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={`Area safety: ${p.label}. Tap to refresh.`}
        >
            <View style={s.row}>
                <View style={[s.icon, { backgroundColor: p.colour + '1A' }]}>
                    <Ionicons name={p.icon as any} size={18} color={p.colour} />
                </View>
                <View style={{ flex: 1 }}>
                    <Text style={[s.title, { color: p.colour }]}>{p.label}</Text>
                    <Text style={s.note}>{p.note}</Text>
                    <Text style={s.counts}>
                        Within 2 km, last {data.lookback_days} days · {data.drops} drops
                        {' · '}{data.marked_safe} safe check-ins
                        {data.check_ins_missed > 0 ? ` · ${data.check_ins_missed} missed` : ''}
                        {data.sos_events > 0 ? ` · ${data.sos_events} alerts` : ''}
                    </Text>
                </View>
                {loading
                    ? <ActivityIndicator size="small" color={p.colour} />
                    : <Ionicons name="refresh-outline" size={14} color="rgba(255,255,255,0.25)" />}
            </View>
        </TouchableOpacity>
    );
}

const s = StyleSheet.create({
    card: {
        backgroundColor: 'rgba(255,255,255,0.05)',
        borderRadius: 20, borderWidth: 1, padding: 14, marginTop: 12,
    },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    icon: { width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
    title: { fontSize: 14, fontWeight: '800' },
    note: { fontSize: 12, color: 'rgba(255,255,255,0.55)', marginTop: 2, lineHeight: 16 },
    counts: { fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 6 },
});
