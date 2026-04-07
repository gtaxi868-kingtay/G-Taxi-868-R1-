/**
 * G-Taxi Driver Design Tokens (Blackberry Pro)
 * Focused on high-contrast, midnight aesthetics for professional utility.
 */

export const tokens = {
    colors: {
        background: {
            base: '#0A0718', // Midnight Depth
            ambient: '#0F0B21',
            surface: 'rgba(26, 21, 48, 0.8)', // Midnight Glass
        },
        glass: {
            fill: 'rgba(255, 255, 255, 0.03)',
            stroke: 'rgba(0, 255, 255, 0.15)', // Cyan hint
            strokeHighlight: 'rgba(0, 255, 255, 0.3)',
            shadow: 'rgba(0, 0, 0, 0.4)',
        },
        primary: {
            cyan: '#00FFFF', // G-Taxi Signature Cyan
            cyanDark: '#00CCCC',
            cyanSoft: 'rgba(0, 255, 255, 0.1)',
            gradient: ['#00FFFF', '#0099FF'] as const,
        },
        text: {
            primary: '#FFFFFF',
            secondary: 'rgba(255, 255, 255, 0.7)',
            tertiary: 'rgba(255, 255, 255, 0.35)',
            inverse: '#0A0718',
        },
        status: {
            error: '#FF453A',
            success: '#32D74B',
            warning: '#FF9F0A',
            online: '#00FFFF',
        },
        border: {
            subtle: 'rgba(255, 255, 255, 0.08)',
            active: '#00FFFF',
        }
    },
    typography: {
        fonts: {
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
    }
} as const;
