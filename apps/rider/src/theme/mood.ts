import { useEffect, useState } from 'react';

// The rider app's look, chosen by the founder 2026-10-24:
//   Pearl by day (light, airy, hotel-lobby calm)
//   Aurora by night (deep night sky, brand glow, champagne details)
// Same layout, type and brand accents in both, so it stays one app.
// The switch follows the clock: Trinidad sits near the equator, so sunrise
// and sunset stay close to 6:00 and 18:00 all year.

export type Mood = {
    key: 'day' | 'night';
    name: string;
    mapStyle: string;           // Mapbox style id
    mapWash: string[];          // gradient over the map, top -> bottom
    page: string;               // behind everything
    sheet: string[];            // bottom sheet gradient, top -> bottom
    sheetBorder: string;
    glow?: string[];            // brand light behind the sheet's top edge (night only)
    ink: string; dim: string; faint: string;
    accent: string;             // small detail colour (greeting, chip icons)
    searchBg: string; searchIcon: string;
    field: string;
    chip: string; chipBorder: string;
    tile: string;
    trustBg: string;
    statusBar: 'light' | 'dark';
    shadowOpacity: number;
};

export const BRAND_GRADIENT: [string, string] = ['#8B7CFF', '#3FD9E8'];
export const SERIF = 'CormorantGaramond_600SemiBold';

export const DAY: Mood = {
    key: 'day',
    name: 'Pearl',
    mapStyle: 'light-v11',
    mapWash: ['rgba(255,255,255,0.65)', 'rgba(240,234,255,0.10)', 'rgba(255,255,255,0.0)'],
    page: '#F4F1EE',
    sheet: ['#FFFFFF', '#FBF9F7'],
    sheetBorder: 'rgba(43,25,60,0.06)',
    ink: '#21152E', dim: 'rgba(33,21,46,0.62)', faint: 'rgba(33,21,46,0.40)',
    accent: '#7A5CFF',
    searchBg: '#FFFFFF', searchIcon: '#7A5CFF',
    field: '#F3F0F7',
    chip: '#FFFFFF', chipBorder: 'rgba(33,21,46,0.10)',
    tile: '#F3F0F7',
    trustBg: '#F6F3FA',
    statusBar: 'dark',
    shadowOpacity: 0.10,
};

export const NIGHT: Mood = {
    key: 'night',
    name: 'Aurora',
    mapStyle: 'navigation-night-v1',
    mapWash: ['rgba(12,8,24,0.75)', 'rgba(20,10,40,0.15)', 'rgba(12,8,24,0.0)'],
    page: '#0B0814',
    sheet: ['rgba(30,22,48,0.92)', 'rgba(15,11,24,0.98)'],
    sheetBorder: 'rgba(185,174,255,0.22)',
    glow: ['rgba(139,124,255,0.0)', 'rgba(139,124,255,0.85)', 'rgba(63,217,232,0.6)', 'rgba(63,217,232,0.0)'],
    ink: '#F6F0E8', dim: 'rgba(246,240,232,0.68)', faint: 'rgba(246,240,232,0.42)',
    accent: '#E9CFA6',
    searchBg: '#15111F', searchIcon: '#B9AEFF',
    field: 'rgba(255,255,255,0.07)',
    chip: 'rgba(255,255,255,0.04)', chipBorder: 'rgba(233,207,166,0.22)',
    tile: 'rgba(255,255,255,0.06)',
    trustBg: 'rgba(255,255,255,0.05)',
    statusBar: 'light',
    shadowOpacity: 0.5,
};

export function isNight(now: Date = new Date()): boolean {
    const h = now.getHours();
    return h >= 18 || h < 6;
}

export function moodFor(now: Date = new Date()): Mood {
    return isNight(now) ? NIGHT : DAY;
}

// Greeting words that match the hour.
export function greetingFor(now: Date = new Date()): { hello: string; when: string; icon: 'sunny' | 'partly-sunny' | 'moon' } {
    const h = now.getHours();
    if (h >= 5 && h < 12) return { hello: 'Good morning', when: 'today', icon: 'sunny' };
    if (h >= 12 && h < 18) return { hello: 'Good afternoon', when: 'today', icon: 'partly-sunny' };
    return { hello: 'Good evening', when: 'tonight', icon: 'moon' };
}

// The current mood, re-checked every minute so the app turns to night at 18:00
// without a restart. `force` pins one (design review, or a future setting).
export function useMood(force?: 'day' | 'night'): Mood {
    const [mood, setMood] = useState<Mood>(() => (force === 'day' ? DAY : force === 'night' ? NIGHT : moodFor()));
    useEffect(() => {
        if (force) { setMood(force === 'day' ? DAY : NIGHT); return; }
        setMood(moodFor());
        const id = setInterval(() => setMood(moodFor()), 60_000);
        return () => clearInterval(id);
    }, [force]);
    return mood;
}
