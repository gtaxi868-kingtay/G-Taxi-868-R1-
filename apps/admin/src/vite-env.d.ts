/// <reference types="vite/client" />

declare module '*.png' {
  const src: string;
  export default src;
}
declare module '*.jpg' {
  const src: string;
  export default src;
}
declare module '*.svg' {
  const src: string;
  export default src;
}

// Native-only module, aliased to packages/shared/web-stubs/async-storage.js
// in vite.config.ts. Declared here so tsc can typecheck @gtaxi/core's
// CrashReporter/outbox imports in the web build.
declare module '@react-native-async-storage/async-storage' {
  const AsyncStorage: {
    getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): Promise<void>;
    removeItem(key: string): Promise<void>;
    multiRemove(keys: string[]): Promise<void>;
    getAllKeys(): Promise<string[]>;
    clear(): Promise<void>;
  };
  export default AsyncStorage;
}
