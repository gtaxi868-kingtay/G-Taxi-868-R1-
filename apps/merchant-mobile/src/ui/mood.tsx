import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { TextStyle } from 'react-native';

// The merchant look, chosen by the founder 2026-11-01: pearl white and gold by
// day, pearl black and gold by night. Warm, never grey. Same layout in both, and
// it follows the clock in Trinidad, where sunrise and sunset stay near 6 and 18.
export type Mood = {
    key: 'day' | 'night';
    page: string;
    pearl: string[];        // storefront face, top to bottom
    sheen: string[];        // the faint pearl shimmer laid across it
    card: string;
    raised: string;         // a card's lower lip, so it sits up off the page
    line: string;
    ink: string;
    dim: string;
    onPearl: string;        // text over the storefront face
    onPearlDim: string;
    gold: string;           // gold as text and icons, tuned for this page
    goldFace: string[];     // a gold key, lit to deep
    goldLip: string;
    onGold: string;
    goldWash: string;
    bar: string;
    danger: string;
    statusBar: 'light' | 'dark';
};

export const NIGHT: Mood = {
    key: 'night',
    page: '#100E0A',
    pearl: ['#3A3220', '#221D13', '#100E0A'],
    sheen: ['rgba(255,228,214,0.16)', 'rgba(214,236,255,0.06)', 'rgba(255,240,200,0)'],
    card: '#1E1A12',
    raised: '#0A0906',
    line: 'rgba(245,214,128,0.20)',
    ink: '#FFF8E8',
    dim: 'rgba(255,248,232,0.70)',
    onPearl: '#FFF8E8',
    onPearlDim: 'rgba(255,248,232,0.78)',
    gold: '#F2CC60',
    goldFace: ['#FBE389', '#EDBE45', '#CF9A22'],
    goldLip: '#946A10',
    onGold: '#2B1E04',
    goldWash: 'rgba(242,204,96,0.14)',
    bar: '#17140E',
    danger: '#FF6B5E',
    statusBar: 'light',
};

export const DAY: Mood = {
    key: 'day',
    page: '#FBF7EE',
    pearl: ['#FFFDF8', '#FAF1DE', '#F6E8CC'],
    sheen: ['rgba(255,214,226,0.45)', 'rgba(206,232,255,0.30)', 'rgba(255,255,255,0)'],
    card: '#FFFFFF',
    raised: '#EADFC6',
    line: 'rgba(150,108,20,0.20)',
    ink: '#2A200C',
    dim: 'rgba(42,32,12,0.68)',
    onPearl: '#2A200C',
    onPearlDim: 'rgba(42,32,12,0.72)',
    gold: '#A97A12',
    goldFace: ['#FBE389', '#EDBE45', '#CF9A22'],
    goldLip: '#A87A14',
    onGold: '#2B1E04',
    goldWash: 'rgba(201,151,43,0.14)',
    bar: '#FFFFFF',
    danger: '#D93A2B',
    statusBar: 'dark',
};

export const SERIF = 'CormorantGaramond_600SemiBold';
export const ROUND = 'Nunito_800ExtraBold';
export const ROUND_BLACK = 'Nunito_900Black';

export const type = {
    title: { fontFamily: ROUND_BLACK, fontSize: 30, lineHeight: 36 } as TextStyle,
    heading: { fontFamily: ROUND_BLACK, fontSize: 18, lineHeight: 24 } as TextStyle,
    strong: { fontFamily: ROUND, fontSize: 15.5, lineHeight: 21 } as TextStyle,
    body: { fontFamily: 'Nunito_700Bold', fontSize: 14, lineHeight: 20 } as TextStyle,
    small: { fontFamily: 'Nunito_700Bold', fontSize: 12.5, lineHeight: 17 } as TextStyle,
};

function moodNow(): Mood {
    const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Port_of_Spain', hour: 'numeric', hour12: false }).format(new Date()));
    return hour >= 6 && hour < 18 ? DAY : NIGHT;
}

const MoodContext = createContext<Mood>(NIGHT);

export function MoodProvider({ children, force }: { children: React.ReactNode; force?: 'day' | 'night' }) {
    const [mood, setMood] = useState<Mood>(() => (force ? (force === 'day' ? DAY : NIGHT) : moodNow()));
    useEffect(() => {
        if (force) return;
        const timer = setInterval(() => setMood(moodNow()), 60000);
        return () => clearInterval(timer);
    }, [force]);
    return <MoodContext.Provider value={mood}>{children}</MoodContext.Provider>;
}

export const useMood = () => useContext(MoodContext);

export function useStyles<T>(factory: (m: Mood) => T): T {
    const m = useMood();
    return useMemo(() => factory(m), [m, factory]);
}
