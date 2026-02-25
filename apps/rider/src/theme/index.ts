export const theme = {
    colors: {
        // Backgrounds - Very dark for contrast with glass
        background: {
            primary: '#0A0A15',      // Deep dark blue-black (from mockups)
            secondary: '#0D0D1A',    // Slightly lighter
            tertiary: '#121220',     // For layers
            elevated: '#1A1A2E',     // For elevated elements
        },

        // Brand Colors - Purple primary, Teal accent (from mockups)
        brand: {
            primary: '#A855F7',       // Purple (selected states, borders)
            secondary: '#9333EA',     // Darker purple
            tertiary: '#7C3AED',      // Even darker purple
            accent: '#00FFD1',        // Teal (map pins, highlights)
            accentSecondary: '#00E5B8',
            glow: 'rgba(168, 85, 247, 0.5)',      // Purple glow
            glowLight: 'rgba(168, 85, 247, 0.25)',
            glowSubtle: 'rgba(168, 85, 247, 0.1)',
            tealGlow: 'rgba(0, 255, 209, 0.5)',   // Teal glow for accents
        },

        // Text
        text: {
            primary: '#FFFFFF',
            secondary: 'rgba(255, 255, 255, 0.7)',
            tertiary: 'rgba(255, 255, 255, 0.4)',
            inverse: '#000000',
            brand: '#A855F7',         // Purple brand text
            accent: '#00FFD1',        // Teal accent text
        },

        // Status
        status: {
            success: '#00FFD1',
            warning: '#FFCC00',
            error: '#FF6B6B',
            info: '#60A5FA',
        },

        // ============================================
        // iOS 26 LIQUID GLASS STYLES
        // ============================================
        glass: {
            // Card backgrounds - Semi-transparent
            background: 'rgba(255, 255, 255, 0.08)',      // Very subtle white
            backgroundLight: 'rgba(255, 255, 255, 0.12)', // Slightly more visible
            backgroundDark: 'rgba(0, 0, 0, 0.4)',         // Dark glass overlay
            backgroundPurple: 'rgba(168, 85, 247, 0.1)',  // Purple tinted glass

            // Borders - Subtle light edges
            border: 'rgba(255, 255, 255, 0.15)',          // Faint white border
            borderLight: 'rgba(255, 255, 255, 0.25)',     // More visible border
            borderBrand: 'rgba(168, 85, 247, 0.4)',       // Purple tinted border
            borderTeal: 'rgba(0, 255, 209, 0.4)',         // Teal tinted border

            // Inner highlights (for that glass edge shine)
            highlight: 'rgba(255, 255, 255, 0.2)',
            highlightTop: 'rgba(255, 255, 255, 0.1)',     // Top edge glow
        },

        // Accent colors for variety
        accent: {
            purple: '#A855F7',
            blue: '#3B82F6',
            pink: '#EC4899',
            teal: '#00FFD1',
            gold: '#FFD700',
        },
    },


    // Typography
    typography: {
        fontFamily: {
            heading: 'System',
            body: 'System',
        },
        sizes: {
            xs: 11,
            sm: 13,
            md: 15,
            lg: 17,
            xl: 20,
            xxl: 26,
            xxxl: 34,
            hero: 48,
            mega: 72,
        },
        weights: {
            light: '300' as const,
            regular: '400' as const,
            medium: '500' as const,
            semibold: '600' as const,
            bold: '700' as const,
            black: '900' as const,
        },
    },

    // Spacing
    spacing: {
        xs: 4,
        sm: 8,
        md: 12,
        lg: 16,
        xl: 20,
        xxl: 24,
        xxxl: 32,
        huge: 48,
        massive: 64,
    },

    // Border Radius - Very rounded for modern feel
    borderRadius: {
        sm: 8,
        md: 14,
        lg: 20,
        xl: 28,
        xxl: 36,
        pill: 100,
    },

    // Shadows - Soft diffused for glass effect
    shadows: {
        glass: {
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.3,
            shadowRadius: 12,
            elevation: 8,
        },
        glow: {
            shadowColor: '#00FFD1',
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 0.5,
            shadowRadius: 20,
            elevation: 10,
        },
        glowStrong: {
            shadowColor: '#00FFD1',
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 0.7,
            shadowRadius: 40,
            elevation: 15,
        },
        soft: {
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 8 },
            shadowOpacity: 0.4,
            shadowRadius: 24,
            elevation: 12,
        },
    },

    // ============================================
    // GLASS COMPONENT STYLES (for easy reuse)
    // ============================================
    glassCard: {
        backgroundColor: 'rgba(255, 255, 255, 0.08)',
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.15)',
        // Note: Add backdropFilter: 'blur(20px)' in web styles
    },

    glassCardLight: {
        backgroundColor: 'rgba(255, 255, 255, 0.12)',
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.2)',
    },

    glassButton: {
        backgroundColor: 'rgba(255, 255, 255, 0.1)',
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.2)',
    },
} as const;

export type Theme = typeof theme;
export type Colors = typeof theme.colors;
