import AsyncStorage from '@react-native-async-storage/async-storage';

const CRASH_KEY = 'gtaxi_crash_log';
const TAG = '[GTAXI_CRASH]';

export function installCrashReporter() {
  const ErrorUtils = (globalThis as any).ErrorUtils;
  if (ErrorUtils?.getGlobalHandler) {
    const originalHandler = ErrorUtils.getGlobalHandler();
    ErrorUtils.setGlobalHandler((error: Error, isFatal?: boolean) => {
      console.error(TAG, 'FATAL:', error.message, error.stack);
      storeCrash(error, isFatal);
      if (originalHandler) {
        originalHandler(error, isFatal);
      }
    });
  }

  if (typeof global !== 'undefined' && global.addEventListener) {
    global.addEventListener('unhandledrejection', (event: any) => {
      const reason = event.reason || event;
      console.error(TAG, 'UNHANDLED PROMISE:', reason?.message || String(reason), reason?.stack);
      storeCrash(reason, false);
    });
  }

  flushStoredCrashes();
}

async function storeCrash(error: any, isFatal?: boolean) {
  try {
    const existing = await AsyncStorage.getItem(CRASH_KEY);
    const crashes = existing ? JSON.parse(existing) : [];
    crashes.push({
      message: error?.message || String(error),
      stack: error?.stack || '',
      isFatal: !!isFatal,
      time: new Date().toISOString(),
    });
    if (crashes.length > 20) crashes.shift();
    await AsyncStorage.setItem(CRASH_KEY, JSON.stringify(crashes));
  } catch {}
}

async function flushStoredCrashes() {
  try {
    const raw = await AsyncStorage.getItem(CRASH_KEY);
    if (raw) {
      console.log(TAG, 'STORED CRASHES:', raw);
      await AsyncStorage.removeItem(CRASH_KEY);
    }
  } catch {}
}
