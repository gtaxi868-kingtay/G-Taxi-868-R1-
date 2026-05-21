export const theme = {
    colors: {
        background: {
            primary: '#0A0A15',
            secondary: '#0D0D1A',
            tertiary: '#121220',
            elevated: '#1A1A2E',
        },

        brand: {
            primary: '#BF40FF',
            secondary: '#9333EA',
            tertiary: '#4D0070',
            accent: '#06B6D4',
            accentSecondary: '#0099BB',
            glow: 'rgba(191, 64, 255, 0.5)',
            glowLight: 'rgba(191, 64, 255, 0.25)',
            glowSubtle: 'rgba(191, 64, 255, 0.1)',
            tealGlow: 'rgba(6, 182, 212, 0.5)',
        },

        text: {
            primary: '#FFFFFF',
            secondary: 'rgba(255, 255, 255, 0.7)',
            tertiary: 'rgba(255, 255, 255, 0.4)',
            inverse: '#000000',
            brand: '#BF40FF',
            accent: '#06B6D4',
        },

        status: {
            success: '#06B6D4',
            warning: '#F59E0B',
            error: '#FF6B6B',
            info: '#60A5FA',
        },

        glass: {
            background: 'rgba(255, 255, 255, 0.08)',
            backgroundLight: 'rgba(255, 255, 255, 0.12)',
            backgroundDark: 'rgba(0, 0, 0, 0.4)',
            backgroundPurple: 'rgba(191, 64, 255, 0.1)',
            border: 'rgba(255, 255, 255, 0.15)',
            borderLight: 'rgba(255, 255, 255, 0.25)',
            borderBrand: 'rgba(191, 64, 255, 0.4)',
            borderTeal: 'rgba(6, 182, 212, 0.4)',
            highlight: 'rgba(255, 255, 255, 0.2)',
            highlightTop: 'rgba(255, 255, 255, 0.1)',
        },

        accent: {
            purple: '#BF40FF',
            blue: '#3B82F6',
            pink: '#EC4899',
            teal: '#06B6D4',
            gold: '#F59E0B',
        },
    },

    typography: {
        fontFamily: {
            heading: 'SpaceGrotesk',
            body: 'Manrope',
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

    borderRadius: {
        sm: 8,
        md: 14,
        lg: 20,
        xl: 28,
        xxl: 36,
        pill: 100,
    },

    shadows: {
        glass: {
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.3,
            shadowRadius: 12,
            elevation: 8,
        },
        glow: {
            shadowColor: '#06B6D4',
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 0.5,
            shadowRadius: 20,
            elevation: 10,
        },
        glowStrong: {
            shadowColor: '#06B6D4',
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

    glassCard: {
        backgroundColor: 'rgba(255, 255, 255, 0.08)',
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.15)',
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
export const THEME = theme;
