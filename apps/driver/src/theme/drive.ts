// The driver app's look, chosen by the founder 2026-10-27: its own dark,
// high-contrast look (drivers work at night and in midday glare), in the
// same G868 family as the rider app. Map first; a light game layer
// (streak, daily goal, small celebrations) that never covers the map.
//
// The shape matches the rider app's Mood so the shared kit works unchanged.

export type Mood = {
    key: 'day' | 'night';
    name: string;
    mapStyle: string;
    mapWash: string[];
    page: string;
    sheet: string[];
    sheetBorder: string;
    glow?: string[];
    ink: string; dim: string; faint: string;
    accent: string;
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

// Status colours, used the same way on every screen.
export const DRIVE_COLORS = {
    online: '#2FD08A',      // you are online / go
    onlineDeep: '#1E9E66',
    money: '#F4CE77',       // earnings, payouts (the driver "gold")
    moneyDeep: '#C9963A',
    streak: '#FF9F43',      // streak flame
    danger: '#FF5A5F',
    warn: '#FFC53D',
    cyan: '#3FD9E8',
    violet: '#8B7CFF',
} as const;

export const DRIVE: Mood = {
    key: 'night',
    name: 'Drive',
    mapStyle: 'navigation-night-v1',
    mapWash: ['rgba(8,9,13,0.70)', 'rgba(8,9,13,0.0)'],
    page: '#08090D',
    sheet: ['#151922', '#0E1117'],
    sheetBorder: 'rgba(255,255,255,0.10)',
    glow: ['rgba(139,124,255,0.0)', 'rgba(139,124,255,0.75)', 'rgba(63,217,232,0.6)', 'rgba(63,217,232,0.0)'],
    // Brighter text than the rider's night look: readable in sun glare.
    ink: '#F5F8FA', dim: 'rgba(245,248,250,0.74)', faint: 'rgba(245,248,250,0.50)',
    accent: '#3FD9E8',
    searchBg: '#151922', searchIcon: '#3FD9E8',
    field: 'rgba(255,255,255,0.08)',
    chip: 'rgba(255,255,255,0.06)', chipBorder: 'rgba(255,255,255,0.12)',
    tile: '#151922',
    trustBg: 'rgba(255,255,255,0.05)',
    statusBar: 'light',
    shadowOpacity: 0.5,
};

export function greetingFor(now: Date = new Date()): string {
    const h = now.getHours();
    if (h >= 5 && h < 12) return 'Good morning';
    if (h >= 12 && h < 18) return 'Good afternoon';
    return 'Good evening';
}

export const ttd = (cents: number | null | undefined, decimals = 2) =>
    `TT$${((cents ?? 0) / 100).toFixed(decimals)}`;
