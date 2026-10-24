// Design tokens for the rider app (NativeWind = Tailwind for React Native).
// One quiet dark palette, one typeface (Manrope), one brand accent.
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./App.tsx', './src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        bg: '#0A0A0F',
        sheet: '#111117',
        surface: '#17171F',
        raised: '#20202A',
        line: 'rgba(255,255,255,0.07)',
        ink: '#F5F5F7',
        dim: 'rgba(245,245,247,0.62)',
        faint: 'rgba(245,245,247,0.40)',
        brand: { DEFAULT: '#8B7CFF', soft: 'rgba(139,124,255,0.14)', cyan: '#3FD9E8' },
        safe: '#3DDC97',
      },
      fontFamily: {
        sans: ['Manrope_500Medium'],
        regular: ['Manrope_400Regular'],
        medium: ['Manrope_500Medium'],
        semibold: ['Manrope_600SemiBold'],
        bold: ['Manrope_700Bold'],
        heavy: ['Manrope_800ExtraBold'],
        display: ['CormorantGaramond_600SemiBold'],
      },
      borderRadius: { sheet: '28px', card: '18px' },
    },
  },
  plugins: [],
};
