/**
 * G-Taxi Shared Design Tokens
 * Extract from Logo & Design System Specification
 */

export const BRAND = {
    purple: '#8B5CF6', // "The Pulse" — logo violet
    purpleDark: '#6D28D9',
    purpleLight: '#B79CFA',
    cyan: '#1DE0E6', // "The Data Stream" — logo cyan
    cyanSoft: 'rgba(29, 224, 230, 0.1)',
    gold: '#F59E0B', // "The Commerce Gold"
    goldDark: '#B45309',
    crimson: '#DC2626', // "The Admin Red"
    deepViolet: '#0B0E12', // cool-grey base
    obsidian: '#0E1217',
    lavender: '#F5F3FF',
    indigoDeep: '#1E1B4B',
};

export const SEMANTIC = {
    success: '#10B981',
    danger: '#EF4444',
    warning: '#F59E0B',
    info: '#06B6D4',
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
    lg: 28,
    xl: 48,
    pill: 999,
};

export const GRADIENTS = {
    primary: [BRAND.purple, BRAND.cyan],
    primaryStart: { x: 0, y: 0 },
    primaryEnd: { x: 1, y: 1 },
};

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
        gold: BRAND.gold,
        accent: '#8B5CF6',
        accentDark: '#7C3AED',
    },
    admin: {
        bg: '#0F172A',
        surface: '#1E293B',
        accent: '#3b374a',
        accentDark: '#2a2735',
        text: '#F1F5F9',
    },
    merchant: {
        bg: BRAND.obsidian,
        surface: 'rgba(255,255,255,0.06)',
        accent: '#007070',
        accentDark: '#004f4f',
        text: '#FFFFFF',
        textMuted: 'rgba(255,255,255,0.5)',
        border: 'rgba(0,112,112,0.2)',
        glassBorder: 'rgba(255,255,255,0.08)',
    },
};
