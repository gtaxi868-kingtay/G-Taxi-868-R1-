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
    bg: '#0B0E12',
    surface: 'rgba(255,255,255,0.04)',
    text: '#F2F5F8',
    textMuted: 'rgba(242,245,248,0.68)',
    border: 'rgba(255, 255, 255, 0.10)',
    accent: '#1DE0E6',
    accentDark: '#0A9CA6',
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
