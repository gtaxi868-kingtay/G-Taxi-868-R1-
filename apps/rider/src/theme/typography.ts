import { StyleSheet, Text, TextInput } from 'react-native';

// One typeface for the whole rider app: Manrope, in real weights.
//
// Before (measured 2026-10-23): screens asked for 'SpaceGrotesk-Bold',
// 'Manrope', 'Manrope-Medium', 'Manrope-Regular', 'Manrope-Bold' and
// 'SpaceGrotesk' in 47 places, but App.tsx only ever loaded Cormorant
// Garamond. On Android every one of those fell back to the system font, and
// every Text with no fontFamily did too, so screens mixed an elegant serif
// with plain Roboto. Custom fonts on Android also ignore fontWeight, so
// "bold" text did not get bolder.
//
// Fix: load Manrope in five weights (App.tsx) and route every Text and
// TextInput to the right weight file. Text that names Cormorant (brand
// display moments) is left alone.

export const FONT = {
    regular: 'Manrope_400Regular',
    medium: 'Manrope_500Medium',
    semibold: 'Manrope_600SemiBold',
    bold: 'Manrope_700Bold',
    heavy: 'Manrope_800ExtraBold',
    display: 'CormorantGaramond_600SemiBold',
} as const;

type Weight = keyof Omit<typeof FONT, 'display'>;

// Families screens already use that were never loaded, and the weight each
// one was meant to look like when no fontWeight is given.
const ALIAS_DEFAULT: Record<string, Weight> = {
    'SpaceGrotesk-Bold': 'heavy',
    SpaceGrotesk: 'semibold',
    Manrope: 'medium',
    'Manrope-Regular': 'regular',
    'Manrope-Medium': 'medium',
    'Manrope-SemiBold': 'semibold',
    'Manrope-Bold': 'bold',
    'Manrope-ExtraBold': 'heavy',
};

function weightFor(fontWeight: unknown, fallback: Weight): Weight {
    switch (String(fontWeight ?? '')) {
        case '100': case '200': case '300': case '400': case 'normal': return 'regular';
        case '500': return 'medium';
        case '600': return 'semibold';
        case '700': case 'bold': return 'bold';
        case '800': case '900': return 'heavy';
        default: return fallback;
    }
}

let applied = false;

// Call once, before the first render (App.tsx does).
export function applyGlobalFont(): void {
    if (applied) return;
    applied = true;
    for (const Component of [Text, TextInput] as any[]) {
        const original = Component?.render;
        if (typeof original !== 'function') continue;
        Component.render = function patchedRender(props: any, ref: any) {
            const flat = StyleSheet.flatten(props?.style) || {};
            const family: string | undefined = flat.fontFamily;
            const isManropeFile = typeof family === 'string' && family.startsWith('Manrope_');
            const isOtherLoadedFont = typeof family === 'string' && !isManropeFile && !(family in ALIAS_DEFAULT);
            if (isManropeFile || isOtherLoadedFont) return original.call(this, props, ref);
            const fallback: Weight = family ? ALIAS_DEFAULT[family] : 'medium';
            const fontFamily = FONT[weightFor(flat.fontWeight, fallback)];
            // The weight now lives in the font file; a separate fontWeight would
            // make the phone or browser fake-bold it, or drop the font.
            const fix = { fontFamily, fontWeight: 'normal' as const };
            return original.call(this, { ...props, style: [props?.style, fix] }, ref);
        };
    }
}
