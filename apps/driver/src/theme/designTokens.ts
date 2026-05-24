export const tokens = {
  colors: {
    bg: '#050505',
    cyan: '#00FFFF',
    purple: '#7F00FF',
    text: '#FFFFFF',
    ghostBorder: 'rgba(255, 255, 255, 0.15)',
    textMuted: 'rgba(255,255,255,0.5)',
    containerLow: 'rgba(5,5,5,0.9)',
    containerHigh: 'rgba(255,255,255,0.2)',
    warning: '#F59E0B',
    error: '#EF4444',
    success: '#00FF94',
  },
  glass: { blur: 20, opacity: 0.2, radius: 20 },
  animation: {
    spring: { damping: 18, stiffness: 150, mass: 1 },
    cardSlide: { damping: 20, stiffness: 100, mass: 0.8 },
    phaseProgress: { damping: 16, stiffness: 140 },
    fadeIn: { duration: 400 },
    sosRing: { expand: 1200, contract: 400 },
  },
} as const;

export const PHASES = ['En Route', 'Arrived', 'In Progress', 'Complete'];
export const PHASE_STATUS_MAP: Record<string, number> = {
  assigned: 0,
  arrived: 1,
  in_progress: 2,
  completed: 3,
};

export const COLORS = tokens.colors;

export const ANIM = tokens.animation;

export const GLASS = {
  defaultIntensity: tokens.glass.blur,
  defaultTint: 'dark' as const,
  surfaceOpacity: tokens.glass.opacity,
  radius: tokens.glass.radius,
} as const;

export const CARD = {
  initialOffset: 300,
  borderTopRadius: 28,
  innerPaddingV: 16,
  innerPaddingH: 20,
  innerBg: 'rgba(5,5,5,0.65)',
} as const;

export const TELEMETRY = {
  stripBg: 'rgba(5,5,5,0.9)',
  stripRadius: 16,
  stripPaddingV: 12,
  stripPaddingH: 12,
  dividerColor: 'rgba(255,255,255,0.08)',
  valueSize: 18,
  unitSize: 9,
  ghostBorderOpacity: 0.12,
} as const;

export const PHASE_TRACK = {
  barHeight: 3,
  defaultDot: 10,
  activeDot: 14,
} as const;

export const WAIT = {
  graceSeconds: 180,
  feePerMinuteCents: 90,
  bg: 'rgba(245,158,11,0.08)',
  iconBg: 'rgba(255,255,255,0.05)',
  iconSize: 36,
} as const;

export const RIDER = {
  avatarSize: 44,
  avatarRadius: 16,
  avatarBg: 'rgba(0,255,255,0.1)',
} as const;

export const ACTION = {
  buttonHeight: 52,
  buttonRadius: 16,
  navButtonSize: 52,
  gap: 12,
} as const;

export const SOS = {
  buttonSize: 52,
  buttonRadius: 16,
} as const;

export const CANCEL = {
  buttonSize: 40,
  buttonRadius: 12,
  bg: 'rgba(5,5,5,0.8)',
} as const;

export const STATUS_BADGE = {
  bg: 'rgba(5,5,5,0.9)',
  radius: 20,
  paddingH: 16,
  paddingV: 8,
} as const;

export const SIGNAL = {
  bg: 'rgba(5,5,5,0.8)',
  radius: 12,
} as const;

export function ghostBorder(opacity = 0.15) {
  return { borderWidth: 1, borderColor: `rgba(255,255,255,${opacity})` };
}

export function glassSurface(_intensity = 20, opacity = 0.2) {
  return { backgroundColor: `rgba(5,5,5,${opacity})` };
}

export function elevationGlow(_radius = 4) {
  return {
    shadowColor: tokens.colors.cyan,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
  };
}
