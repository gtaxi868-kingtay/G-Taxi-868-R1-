// Which services (verticals) this rider can use right now, shared by the Home
// map sheet and the Services tab so both always show the same list.
//
// Moved verbatim out of HomeScreen when the app went to bottom tabs; the
// gating rules did not change:
//   * get_rider_progress returns the EFFECTIVE unlocked list (rider earned it
//     AND the admin allows it) — that intersection is server-side.
//   * kiosk / events / carnival also need the Platform Control switch
//     (usePlatformFlags), applied at render time so a toggle is seen live.
import { useEffect, useMemo, useState } from 'react';
import { initializeSupabaseClient } from '@gtaxi/core';
import { useAuth } from '../context/AuthContext';
import { usePlatformFlags } from './usePlatformFlags';
import type { Layer } from '../components/home/LayerDeck';

const { supabase } = initializeSupabaseClient('native');

const BRAND = '#8B7CFF';

export type FeatureFlags = {
    grocery: boolean; laundry: boolean; merchant: boolean; kiosk: boolean;
    caribbean_travel: boolean; fete: boolean; events: boolean;
};

const NONE: FeatureFlags = { grocery: false, laundry: false, merchant: false, kiosk: false, caribbean_travel: false, fete: false, events: false };

// Screen each service opens. 'ride' is handled by the caller (it needs the
// rider's location and the pickup-accuracy check).
export const SERVICE_ROUTES: Record<string, string> = {
    market: 'GroceryStorefront',
    laundry: 'LaundryLanding',
    merchant: 'FoodDelivery',
    escape: 'EscapeStorefront',
    tap: 'NfcScan',
    events: 'Events',
    fete: 'Carnival',
};

// Tile colours, shared so Home and the Services tab match.
export const SERVICE_COLORS: Record<string, string> = {
    ride: '#8B7CFF', market: '#2FB57C', laundry: '#3FD9E8', merchant: '#FF8A3D',
    escape: '#4C9AFF', tap: '#B65CFF', events: '#FF5C8A', fete: '#FFB020',
};

export function useServices(rideSubtitle = 'Get a taxi anywhere') {
    const { profile } = useAuth();
    const { flags: platformFlags } = usePlatformFlags();
    const [featureFlags, setFeatureFlags] = useState<FeatureFlags>(NONE);
    const [nextUnlock, setNextUnlock] = useState<{ vertical: string; progress: number; required: number; label: string } | null>(null);
    const [homeSuggestion, setHomeSuggestion] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchEnabledVerticals = async () => {
            setLoading(true);
            try {
                const progressRes = await supabase.functions.invoke('get_rider_progress');
                if (progressRes.error) throw progressRes.error;

                const { data: suggestionData } = await supabase
                    .rpc('get_home_suggestion', { p_rider_id: profile?.id })
                    .maybeSingle();
                const suggestion = suggestionData as { cta_text?: string } | null;
                if (suggestion?.cta_text) setHomeSuggestion(suggestion.cta_text);

                const unlocked: string[] = progressRes.data?.data?.unlocked_verticals || [];
                // Verticals with no progression gate (carnival, events) still
                // respect the admin switch. Default to true when the map is
                // absent so an older payload can't blank the screen.
                const platform: Record<string, boolean> = progressRes.data?.data?.platform_enabled || {};
                const adminAllows = (name: string) => platform[name] !== false;

                setFeatureFlags({
                    grocery: unlocked.includes('grocery'),
                    laundry: unlocked.includes('laundry_nfc') || unlocked.includes('laundry'),
                    merchant: unlocked.includes('merchant_delivery'),
                    kiosk: unlocked.includes('laundry_nfc') || unlocked.includes('kiosk'),
                    caribbean_travel: unlocked.includes('g_escape') || unlocked.includes('caribbean_travel'),
                    fete: adminAllows('carnival'),
                    events: adminAllows('events'),
                });
                setNextUnlock(progressRes.data?.data?.next_unlock ?? null);
            } catch (err) {
                console.warn('[useServices] Failed to fetch rider progress:', err);
                setFeatureFlags(NONE);
                setNextUnlock(null);
            } finally {
                setLoading(false);
            }
        };
        fetchEnabledVerticals();

        const channel = supabase
            .channel(`verticals-realtime-${Math.random().toString(36).slice(2)}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'vertical_settings' }, () => { fetchEnabledVerticals(); })
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rider_progression', filter: `rider_id=eq.${profile?.id}` }, () => { fetchEnabledVerticals(); })
            .subscribe();
        return () => { channel?.unsubscribe(); };
    }, [profile?.id]);

    const layers: Layer[] = useMemo(() => {
        const arr: Layer[] = [
            { id: 'ride', name: 'Ride', sub: rideSubtitle, accent: BRAND, icon: 'car-sport-sharp', search: homeSuggestion || 'Where to?' },
        ];
        if (featureFlags.grocery) arr.push({ id: 'market', name: 'Market', sub: 'Groceries delivered', accent: '#F59E0B', icon: 'cart-sharp', search: 'Shop groceries & more' });
        if (featureFlags.laundry) arr.push({ id: 'laundry', name: 'Laundry', sub: 'Fresh & folded', accent: '#34E6EC', icon: 'shirt-sharp', search: 'Schedule a pickup' });
        if (featureFlags.merchant) arr.push({ id: 'merchant', name: 'Food', sub: 'Delivery from local spots', accent: '#F97316', icon: 'fast-food-sharp', search: 'Order food & more' });
        if (featureFlags.caribbean_travel) arr.push({ id: 'escape', name: 'G-Escape', sub: 'Caribbean packages', accent: '#CBD6DE', icon: 'airplane-sharp', search: 'Browse escapes' });
        if (featureFlags.kiosk && platformFlags.kiosk) arr.push({ id: 'tap', name: 'Tap', sub: 'Scan a puck', accent: BRAND, icon: 'radio-sharp', search: 'Open NFC scanner' });
        if (featureFlags.events && platformFlags.events) arr.push({ id: 'events', name: 'Events', sub: 'Nightlife & fetes', accent: '#6D28D9', icon: 'calendar-sharp', search: 'What\'s happening' });
        if (featureFlags.fete && platformFlags.carnival) arr.push({ id: 'fete', name: 'Carnival', sub: 'Bands & fetes', accent: '#FF2D55', icon: 'musical-notes-sharp', search: 'Find your band' });
        if (nextUnlock) arr.push({ id: 'locked', name: nextUnlock.vertical, accent: '#34E6EC', icon: 'lock-closed', locked: true, progress: nextUnlock.progress, need: nextUnlock.required, label: nextUnlock.label });
        return arr;
    }, [featureFlags, platformFlags, nextUnlock, rideSubtitle, homeSuggestion]);

    return { layers, featureFlags, homeSuggestion, loading, platformFlags };
}
