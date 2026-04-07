export const tokens = {
    colors: {
        background: {
            base: '#F5F3FF', // Soft Lavender — G-Taxi Blueberry Luxe
            ambient: '#FFFFFF',
            surface: 'rgba(255, 255, 255, 0.85)', // High-Gloss White Glass
        },
        glass: {
            fill: 'rgba(255, 255, 255, 0.85)',
            stroke: 'rgba(124, 58, 237, 0.12)', // Brand purple hint
            strokeHighlight: 'rgba(124, 58, 237, 0.25)',
            shadow: 'rgba(124, 58, 237, 0.08)',
        },
        primary: {
            // G-Taxi Brand — extracted from logo
            purple: '#7C3AED',       // Royal Purple — matches BRAND.purple
            purpleDark: '#5A2DDE',   // matches BRAND.purpleDark
            purpleLight: '#A78BFA',  // matches BRAND.purpleLight
            cyan: '#00FFFF',         // Electric Cyan — matches BRAND.cyan
            cyanSoft: '#00D4AA',     // matches BRAND.cyanSoft
            gradient: ['#7C3AED', '#00FFFF'] as const, // Diagonal logo split
        },
        text: {
            primary: '#1E1E3F', // Deep Navy — warm, not cold black
            secondary: 'rgba(30, 30, 63, 0.55)',
            tertiary: 'rgba(30, 30, 63, 0.35)',
            inverse: '#FFFFFF',
        },
        status: {
            error: '#EF4444',    // semantic.danger
            success: '#10B981',  // semantic.success
            warning: '#F59E0B',  // semantic.warning — Amber Gold (not FFD700)
        },
        border: {
            subtle: 'rgba(124, 58, 237, 0.08)',
            active: '#7C3AED',
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
            s: 12,
            m: 20,
            l: 28, // G-Taxi Signature radius
            xl: 40,
            full: 999,  // Pill buttons
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
            shadowColor: '#7C3AED',
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.06,
            shadowRadius: 8,
            elevation: 2,
        },
        level2: {
            shadowColor: '#7C3AED',
            shadowOffset: { width: 0, height: 8 },
            shadowOpacity: 0.10,
            shadowRadius: 16,
            elevation: 8,
        },
        level3: {
            shadowColor: '#7C3AED',
            shadowOffset: { width: 0, height: 12 },
            shadowOpacity: 0.14,
            shadowRadius: 24,
            elevation: 16,
        },
        glow: {
            shadowColor: '#7C3AED',
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 0.3,
            shadowRadius: 16,
            elevation: 10,
        },
        none: {
            shadowColor: 'transparent',
            shadowOpacity: 0,
            shadowRadius: 0,
            elevation: 0,
        }
    },
    markers: {
        car: {
            width: 120,
            height: 70,
            emojiSize: 64,
        },
        animation: {
            duration: 2000,
        }
    }
} as const;
