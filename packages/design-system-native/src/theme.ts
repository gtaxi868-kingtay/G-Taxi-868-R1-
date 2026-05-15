/**
 * G-Taxi Shared Design Tokens
 * Extract from Logo & Design System Specification
 */

export const BRAND = {
    purple: '#BF40FF', // The "Pulse"
    purpleDark: '#4D0070',
    purpleLight: '#DB90FF',
    cyan: '#06B6D4', // The "Data Stream"
    cyanSoft: 'rgba(6, 182, 212, 0.1)',
    deepViolet: '#0F0D16', // Obsidian Base
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
        bg: '#0F0D16', // Obsidian Depth
        surface: 'rgba(255,255,255,0.08)',
        text: '#E9E3F0',
        textMuted: 'rgba(174,169,181,0.65)',
        border: 'rgba(119, 116, 127, 0.15)',
    },
    driver: {
        bg: '#0F0D16', // Obsidian Depth (Consistent with Rider)
        surface: '#1A1823',
        surfaceHigh: 'rgba(26, 21, 48, 0.8)',
        text: '#E9E3F0',
        textMuted: '#AEA9B5',
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
