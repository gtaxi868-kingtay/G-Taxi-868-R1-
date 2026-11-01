// Design tokens for the rider app (NativeWind = Tailwind for React Native).
// Warm dark palette, Manrope for UI, Cormorant for the welcome, brand purple->cyan.
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./App.tsx', './src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        // Warm luxury: aubergine-black base and ivory text (not cold blue-black
        // and stark white), with the brand purple->cyan kept for key moments.
        bg: '#0D0B11',
        sheet: '#15121A',
        surface: '#1C1822',
        raised: '#251F2D',
        line: 'rgba(255,240,230,0.08)',
        ink: '#F7F2EC',
        dim: 'rgba(247,242,236,0.66)',
        faint: 'rgba(247,242,236,0.42)',
        brand: { DEFAULT: '#8B7CFF', soft: 'rgba(139,124,255,0.16)', cyan: '#3FD9E8' },
        safe: '#5BD8A0',
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
