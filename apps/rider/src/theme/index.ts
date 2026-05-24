export const theme = {
    colors: {
        background: {
            primary: '#050505',
            secondary: '#080808',
            tertiary: '#0A0A0A',
            elevated: '#121212',
        },

        brand: {
            primary: '#00FFFF',
            secondary: '#00CCCC',
            tertiary: '#008888',
            accent: '#00FFFF',
            accentSecondary: '#00CCCC',
            glow: 'rgba(0, 255, 255, 0.5)',
            glowLight: 'rgba(0, 255, 255, 0.25)',
            glowSubtle: 'rgba(0, 255, 255, 0.1)',
            tealGlow: 'rgba(0, 255, 255, 0.5)',
        },

        text: {
            primary: '#FFFFFF',
            secondary: 'rgba(255, 255, 255, 0.7)',
            tertiary: 'rgba(255, 255, 255, 0.4)',
            inverse: '#000000',
            brand: '#00FFFF',
            accent: '#00FFFF',
        },

        status: {
            success: '#00FF94',
            warning: '#F59E0B',
            error: '#FF6B6B',
            info: '#00FFFF',
        },

        glass: {
            background: 'rgba(255, 255, 255, 0.04)',
            backgroundLight: 'rgba(255, 255, 255, 0.08)',
            backgroundDark: 'rgba(0, 0, 0, 0.5)',
            backgroundPurple: 'rgba(0, 255, 255, 0.06)',
            border: 'rgba(255, 255, 255, 0.12)',
            borderLight: 'rgba(255, 255, 255, 0.2)',
            borderBrand: 'rgba(0, 255, 255, 0.4)',
            borderTeal: 'rgba(0, 255, 255, 0.4)',
            highlight: 'rgba(255, 255, 255, 0.15)',
            highlightTop: 'rgba(255, 255, 255, 0.08)',
        },

        accent: {
            purple: '#7F00FF',
            blue: '#00FFFF',
            pink: '#00FFFF',
            teal: '#00FFFF',
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
            shadowColor: '#00FFFF',
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 0.5,
            shadowRadius: 20,
            elevation: 10,
        },
        glowStrong: {
            shadowColor: '#00FFFF',
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
        backgroundColor: 'rgba(255, 255, 255, 0.04)',
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.12)',
    },

    glassCardLight: {
        backgroundColor: 'rgba(255, 255, 255, 0.08)',
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.15)',
    },

    glassButton: {
        backgroundColor: 'rgba(255, 255, 255, 0.06)',
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.15)',
    },
} as const;

export type Theme = typeof theme;
export type Colors = typeof theme.colors;
export const THEME = theme;
