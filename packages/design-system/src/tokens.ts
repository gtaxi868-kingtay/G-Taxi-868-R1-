// @gtaxi/design-system/tokens — design tokens (platform-agnostic)
// No native imports here — this file must be safe for web (Vite) bundling.

export const tokens = {
  colors: {
    background: {
      base: '#050505',
      ambient: '#050505',
    },
    text: {
      primary: '#FFFFFF',
      secondary: 'rgba(255,255,255,0.5)',
      tertiary: 'rgba(255,255,255,0.3)',
      inverse: '#FFFFFF',
    },
    border: {
      subtle: 'rgba(255,255,255,0.15)',
    },
    primary: {
      cyan: '#00FFFF',
      purple: '#7F00FF',
      gradient: ['#00FFFF', '#7F00FF'] as [string, string],
    },
    status: {
      error: '#FF6E84',
    },
    glass: {
      fill: 'rgba(0,255,255,0.06)',
      strokeHighlight: 'rgba(255,255,255,0.08)',
    },
  },
};

export const SURFACE = {
  base: '#050505',
  containerLow: '#0A0A0A',
  containerHigh: '#1A1A1A',
  containerHighest: '#2A2A2A',
};

export const SHADOW_PROFILE = {
  shadowColor: '#00FFFF',
  shadowOffset: { width: 0, height: 8 } as const,
  shadowOpacity: 0.08,
  shadowRadius: 24,
};

export const ANIMATION = {
  easing: [0.16, 1, 0.3, 1] as const,
  spring: { damping: 18, stiffness: 150, mass: 1 },
};

export const VOICES = {
  rider: {
    bg: '#050505',
    surface: 'rgba(255,255,255,0.04)',
    text: '#FFFFFF',
    textMuted: 'rgba(255,255,255,0.65)',
    border: 'rgba(255, 255, 255, 0.12)',
    accent: '#00FFFF',
    accentDark: '#00CCCC',
  },
  driver: {
    bg: '#050505',
    surface: '#0A0A0A',
    surfaceHigh: 'rgba(10, 10, 10, 0.8)',
    text: '#FFFFFF',
    textMuted: 'rgba(255,255,255,0.65)',
    gold: '#F59E0B',
    accent: '#00FFFF',
    accentDark: '#00CCCC',
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
