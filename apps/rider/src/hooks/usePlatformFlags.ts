// Platform-wide ON/OFF switches, read from system_feature_flags.
//
// WHY THIS EXISTS
// Nine of the fourteen switches on the admin's Platform Control page did
// nothing. An operator could turn "AI Assistant" or "Promo Codes" off, get a
// success toast, and the rider app would carry on exactly as before, because
// no code ever read the flag. This hook is the read side that makes those
// switches real.
//
// NOT the same thing as vertical_settings. That governs which VERTICALS a
// rider can see (rides, grocery, laundry, escape) and is enforced server-side
// in get_rider_progress by intersecting what the rider earned with what the
// admin allows. This governs platform BEHAVIOUR inside those verticals.
// Keep the two separate; conflating them is what produced three contradictory
// switches per vertical in the first place.
//
// One query for every flag, not one query per flag. HomeScreen previously
// fired three separate round-trips for kiosk/carnival/events; adding four more
// that way would have meant seven.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@gtaxi/core';

export interface PlatformFlags {
    aiAssistant: boolean;
    promoCodes: boolean;
    scheduledRides: boolean;
    aiRoutingOffered: boolean;
    kiosk: boolean;
    carnival: boolean;
    events: boolean;
    airline: boolean;
    hotel: boolean;
    driverRegistration: boolean;
}

// Fail OPEN, not closed. If the flags table cannot be read we show the app as
// it was rather than blanking features the rider legitimately has. An admin
// switch failing to apply for one load is a far smaller harm than a rider
// opening the app to find half of it missing because one query timed out.
const DEFAULTS: PlatformFlags = {
    aiAssistant: true,
    promoCodes: true,
    scheduledRides: true,
    aiRoutingOffered: true,
    kiosk: true,
    carnival: true,
    events: true,
    airline: true,
    hotel: true,
    driverRegistration: true,
};

const FLAG_IDS: Record<keyof PlatformFlags, string> = {
    aiAssistant:        'ai_assistant_active',
    promoCodes:         'promo_codes_active',
    scheduledRides:     'scheduled_rides_enabled',
    aiRoutingOffered:   'opt_in_ai_routing',
    kiosk:              'kiosk_active',
    carnival:           'carnival_active',
    events:             'events_active',
    airline:            'airline_active',
    hotel:              'hotel_active',
    driverRegistration: 'driver_registration_active',
};

export function usePlatformFlags() {
    const [flags, setFlags] = useState<PlatformFlags>(DEFAULTS);
    const [loaded, setLoaded] = useState(false);

    const load = useCallback(async () => {
        // .then(ok, err): a Supabase query builder is a THENABLE with no
        // .catch — calling .catch on it throws TypeError at runtime.
        const { data, error } = await supabase
            .from('system_feature_flags')
            .select('id, is_active')
            .then((r: any) => r, (e: any) => ({ data: null, error: e }));

        if (error || !data) {
            setLoaded(true);
            return; // keep DEFAULTS — see fail-open note above
        }

        const byId: Record<string, boolean> = {};
        for (const row of data as { id: string; is_active: boolean }[]) {
            byId[row.id] = row.is_active === true;
        }

        const next = { ...DEFAULTS };
        (Object.keys(FLAG_IDS) as (keyof PlatformFlags)[]).forEach((key) => {
            const dbValue = byId[FLAG_IDS[key]];
            // A missing row means "not governed", which stays at the default.
            // Only an explicit false switches something off.
            if (typeof dbValue === 'boolean') next[key] = dbValue;
        });

        setFlags(next);
        setLoaded(true);
    }, []);

    useEffect(() => {
        load();

        // An admin flipping a switch should reach a phone already open, not
        // only the next cold start.
        const channel = supabase
            .channel('platform-flags')
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'system_feature_flags' },
                () => { load(); },
            )
            .subscribe();

        return () => { supabase.removeChannel(channel); };
    }, [load]);

    return { flags, flagsLoaded: loaded, reloadFlags: load };
}
