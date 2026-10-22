import { useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@gtaxi/core';

// A rider can join with a DRIVER's code (from the driver's keychain or by
// word of mouth). Driver codes live as referral_codes.type = 'driver', so
// apply_referral_code(..., 'rider') always rejected them; the database
// function link_rider_to_driver_code links the rider to that driver so the
// driver earns the "brought a rider" reward (2026-10-21).
//
// It needs a signed-in session. When sign-up ends without one (email still
// to confirm), the code is kept on the phone and applied at first sign-in.

const PENDING_KEY = '@pending_driver_code';

export type DriverCodeResult = { success: boolean; error?: string; driver_first_name?: string | null };

export async function linkDriverCode(code: string): Promise<DriverCodeResult> {
    try {
        const { data, error } = await supabase.rpc('link_rider_to_driver_code', { p_code: code.trim().toUpperCase() });
        if (error) return { success: false, error: error.message };
        return (data as DriverCodeResult) ?? { success: false, error: 'No answer from the server.' };
    } catch (err: any) {
        return { success: false, error: err?.message || 'Could not reach the server.' };
    }
}

export async function savePendingDriverCode(code: string): Promise<void> {
    await AsyncStorage.setItem(PENDING_KEY, code.trim().toUpperCase()).catch(() => {});
}

// Applies a saved driver code once the rider is signed in. Cleared once the
// server gives a final answer (linked, or a definite refusal).
export function usePendingDriverCode(signedIn: boolean): void {
    useEffect(() => {
        if (!signedIn) return;
        (async () => {
            const code = await AsyncStorage.getItem(PENDING_KEY).catch(() => null);
            if (!code) return;
            const result = await linkDriverCode(code);
            const transient = !result.success && /sign in first|could not reach|too many tries/i.test(result.error || '');
            if (!transient) await AsyncStorage.removeItem(PENDING_KEY).catch(() => {});
        })();
    }, [signedIn]);
}
