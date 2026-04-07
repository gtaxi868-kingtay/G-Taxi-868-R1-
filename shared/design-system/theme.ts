/**
 * G-Taxi Shared Design Tokens
 * Extract from Logo & Design System Specification
 */

export const BRAND = {
    purple: '#7C3AED',
    purpleDark: '#5A2DDE',
    purpleLight: '#A78BFA',
    cyan: '#00FFFF',
    cyanSoft: '#00D4AA',
    deepViolet: '#2D1B69',
    lavender: '#F5F3FF',
    indigoDeep: '#1E1B4B',
};

export const SEMANTIC = {
    success: '#10B981',
    danger: '#EF4444',
    warning: '#F59E0B',
    info: '#6366F1',
    surfaceLight: '#F9FAFB',
    surfaceDark: '#111827',
    textPrimary: '#374151',
    textMuted: '#6B7280',
    border: '#E5E7EB',
};

export const SPACING = {
    1: 4,
    2: 8,
    3: 12,
    4: 16,
    5: 20,
    6: 24,
    8: 32,
    12: 48,
};

export const RADIUS = {
    sm: 12,
    md: 20,
    lg: 28, // G-Taxi Signature
    xl: 40,
    pill: 999,
};

export const GRADIENTS = {
    primary: [BRAND.purple, BRAND.cyan],
    primaryStart: { x: 0, y: 0 },
    primaryEnd: { x: 1, y: 1 },
};

export const VOICES = {
    rider: {
        bg: BRAND.lavender,
        surface: '#FFFFFF',
        text: '#1E1E3F',
        textMuted: 'rgba(30,30,63,0.55)',
        border: 'rgba(124,58,237,0.12)',
    },
    driver: {
        bg: '#0A0718',
        surface: '#1A1530',
        surfaceHigh: '#241E42',
        text: '#FFFFFF',
        textMuted: 'rgba(255,255,255,0.45)',
        gold: '#F59E0B',
    },
    admin: {
        bg: '#0F172A',
        surface: '#1E293B',
        accent: '#06B6D4',
        text: '#F1F5F9',
    },
    merchant: {
        bg: '#F0FDF4',
        surface: '#FFFFFF',
        accent: '#10B981',
        text: '#064E3B',
    },
};
