import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { supabase } from '../../../../shared/supabase';
import { Session, User } from '@supabase/supabase-js';
import { setAuthToken } from '../services/api';

// ... imports
import { UserProfile, UserPreferences } from '../types/profile';

interface AuthContextType {
    user: User | null;
    session: Session | null;
    profile: UserProfile | null;           // NEW
    preferences: UserPreferences | null;   // NEW
    loading: boolean;
    signUp: (email: string, password: string, fullName: string) => Promise<{ error: Error | null }>;
    signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
    signOut: () => Promise<void>;
    refreshProfile: () => Promise<void>;   // Allow manual refresh
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

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
        } catch (e) {
            console.error('Error fetching user data', e);
            // Non-blocking: We don't throw, we just log. Ride flow must continue.
        }
    };

    useEffect(() => {
        // Get initial session
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
    const signUp = async (email: string, password: string, fullName: string) => {
        const { error } = await supabase.auth.signUp({
            email,
            password,
            options: {
                data: {
                    full_name: fullName,
                }
            }
        });
        return { error: error as Error | null };
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

    return (
        <AuthContext.Provider value={{ user, session, profile, preferences, loading, signUp, signIn, signOut, refreshProfile }}>
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
