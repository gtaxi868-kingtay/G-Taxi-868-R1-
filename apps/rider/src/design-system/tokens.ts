export const tokens = {
    colors: {
        background: {
            base: '#0F0D16', // Obsidian Depth
            ambient: '#1A1823',
            surface: 'rgba(255, 255, 255, 0.08)', // Dark Glassmorphism 
        },
        glass: {
            fill: 'rgba(255, 255, 255, 0.10)', // Blueberry Luxe Translucent Card
            stroke: 'rgba(191, 64, 255, 0.2)', // Pulse Purple edge
            strokeHighlight: '#BF40FF',
            shadow: 'rgba(0, 0, 0, 0.40)', // Heavy shadow for pop
        },
        primary: {
            purple: '#BF40FF', // The "Pulse"
            cyan: '#06B6D4', // The "Data Stream"
            purpleDark: '#4D0070',
            purpleLight: '#DB90FF',
            gradient: ['#BF40FF', '#06B6D4'] as const,
        },
        text: {
            primary: '#E9E3F0',
            secondary: '#AEA9B5', // on-surface-variant
            tertiary: 'rgba(174, 169, 181, 0.45)',
            inverse: '#0F0D16',
        },
        status: {
            error: '#FF6E84',
            success: '#32D74B',
            warning: '#FF9F0A',
        },
        border: {
            subtle: 'rgba(119, 116, 127, 0.15)', // Outline-variant 15%
            active: '#BF40FF',
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
            s: 12,
            m: 20,
            l: 28, // Heavy smoothing for Luxe Feel
            xl: 40,
            full: 999,
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
        level1: {
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.3,
            shadowRadius: 10,
            elevation: 4,
        },
        level2: {
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 12 },
            shadowOpacity: 0.4,
            shadowRadius: 20,
            elevation: 12,
        },
        level3: {
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 20 },
            shadowOpacity: 0.5,
            shadowRadius: 32,
            elevation: 20,
        },
        glow: {
            shadowColor: '#00FFFF',
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 0.6,
            shadowRadius: 20,
            elevation: 16,
        },
        none: {
            shadowColor: 'transparent',
            shadowOpacity: 0,
            shadowRadius: 0,
            elevation: 0,
        }
    },
    markers: {
        car: { width: 120, height: 70, emojiSize: 64 },
        animation: { duration: 2000 }
    }
} as const;
export const THEME = tokens;
