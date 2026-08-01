import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
