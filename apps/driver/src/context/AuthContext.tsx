import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { supabase } from '../../../../shared/supabase';
import { Session, User } from '@supabase/supabase-js';
import { Alert } from 'react-native';

interface DriverProfile {
    id: string;
    name: string;
    phone_number: string;
    vehicle_model: string;
    plate_number: string;
    status: 'online' | 'offline' | 'busy';
    is_online: boolean;
}

interface AuthContextType {
    user: User | null;
    session: Session | null;
    driver: DriverProfile | null;
    loading: boolean;
    signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
    signOut: () => Promise<void>;
    toggleOnline: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [session, setSession] = useState<Session | null>(null);
    const [driver, setDriver] = useState<DriverProfile | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // Check active sessions and sets the user
        supabase.auth.getSession().then(({ data: { session } }) => {
            setSession(session);
            setUser(session?.user ?? null);
            if (session?.user) {
                fetchDriverProfile(session.user.id);
            } else {
                setLoading(false);
            }
        });

        // Listen for changes on auth state (sing in, sign out, etc.)
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            setSession(session);
            setUser(session?.user ?? null);
            if (session?.user) {
                fetchDriverProfile(session.user.id);
            } else {
                setDriver(null);
                setLoading(false); // Only set loading false if logging out
            }
        });

        return () => subscription.unsubscribe();
    }, []);

    const fetchDriverProfile = async (userId: string) => {
        try {
            const { data, error } = await supabase
                .from('drivers')
                .select('*')
                .eq('id', userId)
                .single();

            if (error) {
                console.error('Error fetching driver profile:', error);
                // If 406/No rows, it means user is authenticated but not a driver
                if (error.code === 'PGRST116') {
                    Alert.alert('Access Denied', 'You are not registered as a driver.');
                    await supabase.auth.signOut();
                }
            } else {
                setDriver(data as DriverProfile);
            }
        } catch (e) {
            console.error('Exception fetching driver:', e);
        } finally {
            setLoading(false);
        }
    };

    const signIn = async (email: string, password: string) => {
        setLoading(true);
        const { error } = await supabase.auth.signInWithPassword({
            email,
            password,
        });
        if (error) setLoading(false);
        return { error };
    };

    const signOut = async () => {
        // Go offline before signing out
        if (driver?.is_online) {
            await supabase.from('drivers').update({ is_online: false, status: 'offline' }).eq('id', user?.id);
        }
        await supabase.auth.signOut();
        setDriver(null);
        setUser(null);
        setSession(null);
    };

    const toggleOnline = async () => {
        if (!user || !driver) return;
        const newStatus = !driver.is_online;

        // Optimistic update
        setDriver({ ...driver, is_online: newStatus, status: newStatus ? 'online' : 'offline' });

        const { error } = await supabase
            .from('drivers')
            .update({
                is_online: newStatus,
                status: newStatus ? 'online' : 'offline',
                updated_at: new Date().toISOString()
            })
            .eq('id', user.id);

        if (error) {
            Alert.alert('Error', 'Failed to update status');
            // Revert
            setDriver({ ...driver, is_online: !newStatus, status: !newStatus ? 'online' : 'offline' });
        }
    };

    return (
        <AuthContext.Provider value={{ user, session, driver, loading, signIn, signOut, toggleOnline }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}
