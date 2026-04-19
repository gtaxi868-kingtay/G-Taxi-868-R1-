/**
 * G-Taxi Driver Design Tokens (Blackberry Pro)
 * Focused on high-contrast, midnight aesthetics for professional utility.
 */

export const tokens = {
    colors: {
        background: {
            base: '#0F0D16', // Obsidian Depth
            ambient: '#1A1823',
            surface: 'rgba(26, 21, 48, 0.8)', // Deep Glass
        },
        glass: {
            fill: 'rgba(255, 255, 255, 0.03)',
            stroke: 'rgba(6, 182, 212, 0.2)', // Cyan Data Stream
            strokeHighlight: '#06B6D4',
            shadow: 'rgba(0, 0, 0, 0.5)',
        },
        primary: {
            cyan: '#06B6D4', // The "Data Stream"
            purple: '#BF40FF', // The "Pulse"
            cyanSoft: 'rgba(6, 182, 212, 0.1)',
            gradient: ['#06B6D4', '#BF40FF'] as const,
        },
        text: {
            primary: '#E9E3F0',
            secondary: '#AEA9B5', // on-surface-variant
            tertiary: 'rgba(174, 169, 181, 0.5)',
            inverse: '#0F0D16',
        },
        status: {
            error: '#FF6E84',
            success: '#32D74B',
            warning: '#FF9F0A',
            online: '#06B6D4',
        },
        border: {
            subtle: 'rgba(119, 116, 127, 0.15)', // Outline-variant 15%
            active: '#06B6D4',
        }
    },
    typography: {
        fonts: {
            display: 'SpaceGrotesk-Bold',
            headline: 'SpaceGrotesk-Medium',
            body: 'Manrope-Regular',
            bodyBold: 'Manrope-Bold',
            label: 'PlusJakartaSans-Medium',
            system: 'System',
        },
        sizes: {
            displayXL: 48,
            headingL: 28,
            headingM: 20,
            bodyBold: 16,
            bodyReg: 14,
            caption: 12,
            small: 10,
        },
        weights: {
            regular: '400',
            medium: '500',
            semibold: '600',
            bold: '700',
            heavy: '800',
        } as const,
        letterSpacing: {
            tight: -0.5,
            normal: 0,
            wide: 1,
        }
    },
    layout: {
        radius: {
            xs: 8,
            s: 16,
            m: 20,
            l: 28, // G-Taxi Signature
            xl: 40,
            pill: 9999,
            full: 9999,
        },
        spacing: {
            xxs: 4,
            xs: 8,
            sm: 12,
            md: 16,
            lg: 24,
            xl: 32,
            xxl: 48,
        }
    },
    elevation: {
        level1: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4, elevation: 2 },
        level2: { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 5 },
        level3: { shadowColor: '#06B6D4', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.4, shadowRadius: 12, elevation: 8 },
    }
} as const;
