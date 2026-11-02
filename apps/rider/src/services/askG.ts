import { supabase } from '@gtaxi/core';
import { callG as call, reasonFor } from '@g868/shared/g';

export { reasonFor };
export const callG = <T = any>(name: string, body: unknown) => call<T>(supabase as any, name, body);

export function hasRealPlace(d: { lat?: unknown; lng?: unknown } | null | undefined): boolean {
    const lat = Number(d?.lat), lng = Number(d?.lng);
    return Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0;
}
