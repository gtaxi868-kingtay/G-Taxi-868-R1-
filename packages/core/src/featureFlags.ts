import { SupabaseClient } from '@supabase/supabase-js';

interface FeatureFlags {
  rides: boolean;
  grocery: boolean;
  laundry: boolean;
  kiosk: boolean;
  airline: boolean;
  hotel: boolean;
}

const CACHE_KEY = 'gtaxi_feature_flags';
const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  flags: FeatureFlags;
  timestamp: number;
}

async function getCachedFlags(): Promise<FeatureFlags | null> {
  try {
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    const storage = AsyncStorage.default || AsyncStorage;
    const raw = await storage.getItem(CACHE_KEY);
    if (raw) {
      const entry: CacheEntry = JSON.parse(raw);
      if (Date.now() - entry.timestamp < CACHE_TTL_MS) {
        return entry.flags;
      }
    }
  } catch {}
  return null;
}

async function setCachedFlags(flags: FeatureFlags): Promise<void> {
  try {
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    const storage = AsyncStorage.default || AsyncStorage;
    const entry: CacheEntry = { flags, timestamp: Date.now() };
    await storage.setItem(CACHE_KEY, JSON.stringify(entry));
  } catch {}
}

const DEFAULT_FLAGS: FeatureFlags = {
  rides: true,
  grocery: false,
  laundry: false,
  kiosk: true,
  airline: false,
  hotel: false,
};

export async function syncFeatureFlags(supabase: SupabaseClient): Promise<FeatureFlags> {
  const cached = await getCachedFlags();
  if (cached) return cached;

  try {
    const { data: systemFlags } = await supabase
      .from('system_feature_flags')
      .select('id, is_active');

    const { data: verticalSettings } = await supabase
      .from('vertical_settings')
      .select('vertical, is_enabled');

    const flagMap: Record<string, boolean> = {};
    if (systemFlags) {
      for (const f of systemFlags) {
        flagMap[f.id] = f.is_active;
      }
    }
    if (verticalSettings) {
      for (const v of verticalSettings) {
        flagMap[v.vertical] = v.is_enabled;
      }
    }

    const flags: FeatureFlags = {
      rides: flagMap['rides'] ?? DEFAULT_FLAGS.rides,
      grocery: flagMap['grocery'] ?? DEFAULT_FLAGS.grocery,
      laundry: flagMap['laundry'] ?? DEFAULT_FLAGS.laundry,
      kiosk: flagMap['kiosk_active'] ?? flagMap['kiosk'] ?? DEFAULT_FLAGS.kiosk,
      airline: flagMap['airline_active'] ?? DEFAULT_FLAGS.airline,
      hotel: flagMap['hotel_active'] ?? DEFAULT_FLAGS.hotel,
    };

    await setCachedFlags(flags);
    return flags;
  } catch {
    return DEFAULT_FLAGS;
  }
}
