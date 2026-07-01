// @gtaxi/design-system/tokens — design tokens (platform-agnostic)
// No native imports here — this file must be safe for web (Vite) bundling.

export const tokens = {
  colors: {
    background: {
      base: '#0B0E12',
      ambient: '#0B0E12',
    },
    text: {
      primary: '#F2F5F8',
      secondary: 'rgba(242,245,248,0.68)',
      tertiary: 'rgba(242,245,248,0.42)',
      inverse: '#06080A',
    },
    border: {
      subtle: 'rgba(255,255,255,0.10)',
    },
    primary: {
      cyan: '#1DE0E6',
      purple: '#8B5CF6',
      gradient: ['#8B5CF6', '#1DE0E6'] as [string, string],
    },
    status: {
      error: '#EF4444',
    },
    glass: {
      fill: 'rgba(20,26,34,0.62)',
      strokeHighlight: 'rgba(255,255,255,0.10)',
    },
  },
};

export const SURFACE = {
  base: '#0B0E12',
  containerLow: '#13171D',
  containerHigh: '#1A1F27',
  containerHighest: '#232932',
};

export const SHADOW_PROFILE = {
  shadowColor: '#1DE0E6',
  shadowOffset: { width: 0, height: 8 } as const,
  shadowOpacity: 0.08,
  shadowRadius: 24,
};

export const ANIMATION = {
  easing: [0.16, 1, 0.3, 1] as const,
  spring: { damping: 18, stiffness: 150, mass: 1 },
};

// RIDER "LUXE COOL" language (approved 2026-06-30) — sleek, cool, alluring, glass-tech,
// logo-aligned (violet↔cyan glass over circuitry). See [[project_brand_palette]] memory.
// Rule: the `signature` gradient is a LIT EDGE used ONCE per screen (hairline / route /
// selection), never a fill. Money/values render in `platinum`. Display type is the serif.
export const LUXE = {
  base: '#07070F',            // violet-black canvas
  ink: '#05060B',             // deeper well (behind glass)
  ice: '#EAF3F6',             // cool white (replaces pure #FFF)
  iceMuted: 'rgba(234,243,246,0.55)',
  iceFaint: 'rgba(234,243,246,0.40)',
  iceGhost: 'rgba(234,243,246,0.72)',
  platinum: '#CBD6DE',        // cool metallic — prices, fares, balances
  violet: '#6D28D9',
  cyan: '#34E6EC',
  cyanBright: '#5BF0F5',
  signature: ['#6D28D9', '#34E6EC'] as [string, string], // lit edge, once per screen
  ctaWash: ['rgba(109,40,217,0.26)', 'rgba(52,230,236,0.13)'] as [string, string],
  glassFill: 'rgba(255,255,255,0.045)',
  glassBorder: 'rgba(255,255,255,0.10)',
  hairline: 'rgba(255,255,255,0.06)',
  serif: 'CormorantGaramond_500Medium',
  serifSemi: 'CormorantGaramond_600SemiBold',
  tracking: { micro: 2, wide: 2.5 },
  glow: { shadowColor: '#34E6EC', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 18 },
} as const;

// Semantic z-index scale — use these across all apps instead of arbitrary magic numbers.
// Layers are: map content → overlays → panels → modals → banners/toasts
export const Z = {
    mapContent:    1,
    mapOverlay:   10,
    panel:        20,
    lockOverlay:  30,
    locationConfirm: 40,
    sidebar:      50,
    modal:        60,
    toast:        70,
    offlineBanner: 80,
} as const;

export const VOICES = {
  rider: {
    bg: '#07070F',
    surface: 'rgba(255,255,255,0.045)',
    text: '#EAF3F6',
    textMuted: 'rgba(234,243,246,0.55)',
    border: 'rgba(255, 255, 255, 0.10)',
    accent: '#34E6EC',
    accentDark: '#0F9CA6',
    violet: '#6D28D9',
    platinum: '#CBD6DE',
    serif: 'CormorantGaramond_500Medium',
    serifSemi: 'CormorantGaramond_600SemiBold',
  },
  driver: {
    bg: '#0B0E12',
    surface: '#13171D',
    surfaceHigh: 'rgba(19, 23, 29, 0.8)',
    text: '#F2F5F8',
    textMuted: 'rgba(242,245,248,0.68)',
    gold: '#F59E0B',
    accent: '#1DE0E6',
    accentDark: '#0A9CA6',
  },
  admin: {
    bg: '#0F172A',
    surface: '#1E293B',
    accent: '#3b374a',
    accentDark: '#2a2735',
    text: '#F1F5F9',
  },
  merchant: {
    bg: '#09090B',
    surface: 'rgba(255,255,255,0.06)',
    accent: '#007070',
    accentDark: '#004f4f',
    text: '#FFFFFF',
    textMuted: 'rgba(255,255,255,0.7)',
  },
};
