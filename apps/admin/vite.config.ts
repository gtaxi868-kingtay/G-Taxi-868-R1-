import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  // tailwindcss() is REQUIRED for Tailwind v4. Without it the v4 engine never
  // runs, so every utility class in the app is inert — which is exactly the
  // state this app was in: 232 CSS rules loaded, zero of them Tailwind
  // utilities, while 26 pages were written entirely in Tailwind classes.
  // apps/merchant already had this wired; admin was missed during the v3 -> v4 bump.
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // @gtaxi/core's getStorage() does a runtime-guarded require('expo-secure-store')
      // that only ever fires on native. esbuild's dep optimizer resolves that require()
      // literal statically regardless, pulling in real react-native (Flow syntax) and
      // crashing the dev server. Alias it to a web-safe stub instead.
      'expo-secure-store': path.resolve(__dirname, '../../packages/shared/web-stubs/expo-secure-store.js'),
    },
  },
})
