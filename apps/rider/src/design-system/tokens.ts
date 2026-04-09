export const tokens = {
    colors: {
        background: {
            base: '#160B32', // Deep Rich Purple — Blueberry Luxe Base
            ambient: '#2F1A5C', // Bright Purple Gradient Top
            surface: 'rgba(255, 255, 255, 0.08)', // Dark Glassmorphism 
        },
        glass: {
            fill: 'rgba(255, 255, 255, 0.10)', // Blueberry Luxe Translucent Card
            stroke: 'rgba(255, 255, 255, 0.20)', // Sharp Glass edge
            strokeHighlight: '#00FFFF', // Cyan pop
            shadow: 'rgba(0, 0, 0, 0.40)', // Heavy shadow for pop
        },
        primary: {
            purple: '#7C3AED',
            purpleDark: '#350085',
            purpleLight: '#A78BFA',
            cyan: '#00FFFF',
            cyanSoft: '#00D4AA',
            gradient: ['#7C3AED', '#00FFFF'] as const,
        },
        text: {
            primary: '#FFFFFF', // Pure White for Dark Mode
            secondary: 'rgba(255, 255, 255, 0.65)',
            tertiary: 'rgba(255, 255, 255, 0.45)',
            inverse: '#1E1E3F',
        },
        status: {
            error: '#EF4444',
            success: '#10B981',
            warning: '#F59E0B',
        },
        border: {
            subtle: 'rgba(255, 255, 255, 0.12)',
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
