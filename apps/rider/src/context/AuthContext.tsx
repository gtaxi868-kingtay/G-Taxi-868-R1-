import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { supabase } from '../../../../shared/supabase';
import { Session, User } from '@supabase/supabase-js';
import { setAuthToken } from '../services/api';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';

// ... imports
import { UserProfile, UserPreferences } from '../types/profile';

interface AuthContextType {
    user: User | null;
    session: Session | null;
    profile: UserProfile | null;           // NEW
    preferences: UserPreferences | null;   // NEW
    loading: boolean;
    signUp: (email: string, password: string, fullName: string, phone: string) => Promise<{ data: any; error: Error | null }>;
    signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
    signOut: () => Promise<void>;
    refreshProfile: () => Promise<void>;   // Allow manual refresh
    sendPhoneOTP: (phone: string) => Promise<void>;
    verifyPhoneOTP: (phone: string, token: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// ── Phase 5 Fix 5.4: Push token registration for riders ───────────────────────
// Same pattern as the driver app, but stores the token in profiles.push_token
// so the edge function can notify the rider about driver arrival, cancellations, etc.
async function registerPushToken(userId: string): Promise<void> {
    if (!Device.isDevice) {
        console.log('registerPushToken (rider): skipped (not a physical device).');
        return;
    }

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
    }

    if (finalStatus !== 'granted') {
        console.warn('registerPushToken (rider): push notification permission denied.');
        return;
    }

    // Android requires a notification channel.
    if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('ride-updates', {
            name: 'Ride Updates',
            importance: Notifications.AndroidImportance.HIGH,
            vibrationPattern: [0, 250, 250, 250],
            lightColor: '#7C3AED',
            sound: 'default',
        });
    }

    try {
        const projectId = Constants.expoConfig?.extra?.eas?.projectId;
        const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;

        const { error } = await supabase
            .from('profiles')
            .update({ push_token: token })
            .eq('id', userId);

        if (error) {
            console.error('registerPushToken (rider): failed to save token to profiles table:', error);
        } else {
            console.log('registerPushToken (rider): token saved for user', userId);
        }
    } catch (err) {
        console.error('registerPushToken (rider): error obtaining push token:', err);
    }
}

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [session, setSession] = useState<Session | null>(null);
    const [profile, setProfile] = useState<UserProfile | null>(null);         // NEW
    const [preferences, setPreferences] = useState<UserPreferences | null>(null); // NEW
    const [loading, setLoading] = useState(true);

    const fetchUserData = async (userId: string) => {
        try {
            // 1. Fetch Profile
            const { data: profileData } = await supabase
                .from('profiles')
                .select('*')
                .eq('id', userId)
                .single();

            // 2. Fetch Preferences
            const { data: prefData } = await supabase
                .from('user_preferences')
                .select('*')
                .eq('user_id', userId)
                .single();

            if (profileData) setProfile(profileData);
            if (prefData) setPreferences(prefData);

            // Phase 5: Register push token after profile is confirmed to exist.
            // Fire-and-forget — never blocks profile fetch or ride flow.
            registerPushToken(userId).catch(err =>
                console.error('registerPushToken (rider) background error:', err)
            );
        } catch (e) {
            console.error('Error fetching user data', e);
            // Non-blocking: We don't throw, we just log. Ride flow must continue.
        }
    };

    useEffect(() => {
        // Get initial session with timeout safety
        const sessionPromise = supabase.auth.getSession();
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Session check timeout')), 5000)
        );

        Promise.race([sessionPromise, timeoutPromise])
            .then((result: any) => {
                const session = result.data?.session;
                setSession(session);
                setUser(session?.user ?? null);
                if (session?.access_token) {
                    setAuthToken(session.access_token);
                    // Fetch Profile Data Early
                    if (session.user) fetchUserData(session.user.id);
                }
            })
            .catch((err) => {
                console.warn('Auth session check failed or timed out:', err);
                // Even on error, we must unblock the UI
                setSession(null);
                setUser(null);
            })
            .finally(() => {
                setLoading(false);
            });

        // Listen for auth changes
        const { data: { subscription } } = supabase.auth.onAuthStateChange(
            async (event, session) => {
                setSession(session);
                setUser(session?.user ?? null);
                if (session?.access_token) {
                    setAuthToken(session.access_token);
                    if (session.user) fetchUserData(session.user.id);
                } else {
                    // Clear on logout
                    setProfile(null);
                    setPreferences(null);
                }
            }
        );

        return () => subscription.unsubscribe();
    }, []);

    // ... signUp, signIn ...
    const signUp = async (email: string, password: string, fullName: string, phone: string) => {
        const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: {
                data: {
                    full_name: fullName,
                    phone: phone,
                }
            }
        });
        return { data, error: error as Error | null };
    };

    const signIn = async (email: string, password: string) => {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        return { error: error as Error | null };
    };

    const signOut = async () => {
        await supabase.auth.signOut();
    };

    const refreshProfile = async () => {
        if (user) await fetchUserData(user.id);
    };

    const sendPhoneOTP = async (phone: string) => {
        const { error } = await supabase.auth.signInWithOtp({ phone });
        if (error) throw error;
    };

    const verifyPhoneOTP = async (phone: string, token: string) => {
        const { data, error } = await supabase.auth.verifyOtp({ phone, token, type: 'sms' });
        if (error) throw error;
        if (data.session) {
            setSession(data.session);
        }
    };

    return (
        <AuthContext.Provider value={{ user, session, profile, preferences, loading, signUp, signIn, signOut, refreshProfile, sendPhoneOTP, verifyPhoneOTP }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}
