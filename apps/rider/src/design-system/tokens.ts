export const tokens = {
    colors: {
        background: {
            base: '#05050A', // Deep Matte Black (Checklist #2)
            ambient: '#0A0A12', // Slightly lighter for subtle separation
            surface: 'rgba(20, 20, 30, 0.6)', // Satin Glass Fill
        },
        glass: {
            fill: 'rgba(20, 20, 30, 0.60)', // Satin feel, not glossy
            stroke: 'rgba(255, 255, 255, 0.08)', // Very subtle, trustworthy border
            strokeHighlight: 'rgba(255, 255, 255, 0.15)', // Top-edge light catch
            shadow: 'rgba(0, 0, 0, 0.4)', // Deep diffused shadow
        },
        primary: {
            purple: '#9F55FF', // Tuned for "Quiet Confidence", slightly desaturated
            cyan: '#00E0FF',
            // Gradient used ONLY for active/focus states
            gradient: ['#9F55FF', '#00E0FF'] as const,
        },
        text: {
            primary: '#FFFFFF',
            secondary: 'rgba(255, 255, 255, 0.65)',
            tertiary: 'rgba(255, 255, 255, 0.40)', // Muted metadata
            inverse: '#05050A',
        },
        status: {
            error: '#FF453A',
            success: '#32D74B', // iOS-like confident green
            warning: '#FFD60A',
        },
        border: {
            subtle: 'rgba(255, 255, 255, 0.08)',
            active: '#9F55FF',
        }
    },
    typography: {
        fonts: {
            system: 'System',
        },
        sizes: {
            displayXL: 56, // Reduced slightly for "Calm" (Checklist #1)
            headingL: 32,
            headingM: 22,
            bodyBold: 17,
            bodyReg: 15,
            caption: 13,
            small: 11,
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
            wide: 0.2, // Reduced to avoid "Spacey/Gamey" look
        }
    },
    layout: {
        radius: {
            xs: 4,
            s: 12,
            m: 16,
            l: 24, // Standard card radius
            xl: 32,
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
        // "Depth Rules" (Checklist #3)
        level1: { // Base / Flat
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.1,
            shadowRadius: 4,
            elevation: 2,
        },
        level2: { // Surface / Cards - Soft, Diffused
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 8 },
            shadowOpacity: 0.4,
            shadowRadius: 16,
            elevation: 8,
        },
        level3: { // Focus / Floating - Deep, Anchoring
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 12 },
            shadowOpacity: 0.6,
            shadowRadius: 24,
            elevation: 16,
        },
        glow: { // RARE usage only (Checklist #1)
            shadowColor: '#9F55FF',
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 0.4,
            shadowRadius: 12,
            elevation: 10,
        },
        none: {
            shadowColor: 'transparent',
            shadowOpacity: 0,
            shadowRadius: 0,
            elevation: 0,
        }
    },
    // New: Standardized Marker Definitions
    markers: {
        car: {
            width: 120, // 2x increase (was 60)
            height: 70, // 2x increase (was 35)
            emojiSize: 64, // scaled up
        },
        animation: {
            duration: 2000, // Standard glide duration
        }
    }
} as const;
