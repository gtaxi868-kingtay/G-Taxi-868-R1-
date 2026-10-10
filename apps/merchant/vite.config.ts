import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // See apps/admin/vite.config.ts — same @gtaxi/core → expo-secure-store →
      // react-native (Flow syntax) esbuild crash, same fix.
      'expo-secure-store': path.resolve(__dirname, '../../packages/shared/web-stubs/expo-secure-store.js'),
      // @gtaxi/core re-exports CrashReporter/outbox, which import AsyncStorage at
      // top level; without this Rollup can't resolve it and `vite build` fails.
      '@react-native-async-storage/async-storage': path.resolve(__dirname, '../../packages/shared/web-stubs/async-storage.js'),
    },
  },
})
