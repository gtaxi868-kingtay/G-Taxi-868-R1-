import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { supabase } from '../../../../shared/supabase';
import { Session, User } from '@supabase/supabase-js';
import { Alert, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';

interface DriverProfile {
    id: string;
    name: string;
    phone_number: string;
    vehicle_model: string;
    plate_number: string;
    status: 'online' | 'offline' | 'busy' | 'pending';
    is_online: boolean;
    rating?: number;
    push_token?: string | null;
    verified_status?: 'unverified' | 'pending' | 'approved' | 'rejected';
}

interface AuthContextType {
    user: User | null;
    session: Session | null;
    driver: DriverProfile | null;
    loading: boolean;
    signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
    signOut: () => Promise<void>;
    toggleOnline: () => Promise<void>;
    refreshPushToken: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// ── Phase 5 Fix 5.3: Push token registration ──────────────────────────────────
// Requests permission, gets the Expo push token, and stores it in the
// drivers table keyed by the authenticated user's ID.
async function registerPushToken(userId: string): Promise<void> {
    if (!Device.isDevice) {
        // Push notifications do not work on simulators/emulators.
        console.log('registerPushToken: skipped (not a physical device).');
        return;
    }

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
    }

    if (finalStatus !== 'granted') {
        console.warn('registerPushToken: push notification permission denied.');
        return;
    }

    // On Android, a notification channel is required for Expo notifications.
    if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('ride-offers', {
            name: 'Ride Offers',
            importance: Notifications.AndroidImportance.MAX,
            vibrationPattern: [0, 250, 250, 250],
            lightColor: '#FF231F7C',
            sound: 'default',
        });
    }

    try {
        const projectId = Constants.expoConfig?.extra?.eas?.projectId;
        const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;

        const { error } = await supabase
            .from('drivers')
            .update({ push_token: token })
            .eq('user_id', userId);

        if (error) {
            console.error('registerPushToken: failed to save token to drivers table:', error);
        } else {
            console.log('registerPushToken: token saved for driver', userId);
        }
    } catch (err) {
        console.error('registerPushToken: error obtaining push token:', err);
    }
}

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

        // Listen for changes on auth state (sign in, sign out, etc.)
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            setSession(session);
            setUser(session?.user ?? null);
            if (session?.user) {
                fetchDriverProfile(session.user.id);
            } else {
                setDriver(null);
                setLoading(false);
            }
        });

        return () => subscription.unsubscribe();
    }, []);

    const fetchDriverProfile = async (userId: string) => {
        try {
            const { data, error } = await supabase
                .from('drivers')
                .select('*')
                .eq('user_id', userId)
                .single();

            if (error) {
                console.error('Error fetching driver profile:', error);
                if (error.code === 'PGRST116') {
                    Alert.alert('Access Denied', 'You are not registered as a driver.');
                    await supabase.auth.signOut();
                }
            } else {
                setDriver(data as DriverProfile);
                // Phase 5: Register push token after confirming the driver profile exists.
                // Fire-and-forget — token registration must never block the login flow.
                registerPushToken(userId).catch(err =>
                    console.error('registerPushToken background error:', err)
                );
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
            await supabase.from('drivers').update({ is_online: false, status: 'offline' }).eq('user_id', user?.id);
        }
        await supabase.auth.signOut();
        setDriver(null);
        setUser(null);
        setSession(null);
    };

    const toggleOnline = async () => {
        if (!user || !driver) return;
        const newStatus = !driver.is_online;

        // Lockout guard: check balance before allowing driver to go online
        if (newStatus === true) {
            const { data: balance } = await supabase.rpc('get_wallet_balance', { p_user_id: user.id });
            const LOCKOUT_THRESHOLD_CENTS = -60000; // -$600 TTD
            if (balance !== null && balance <= LOCKOUT_THRESHOLD_CENTS) {
                Alert.alert(
                    'Account Restricted',
                    'Your commission balance has reached the $600 limit. Please settle your balance before going online.',
                    [{ text: 'OK' }]
                );
                return;
            }
        }

        // Optimistic update
        setDriver({ ...driver, is_online: newStatus, status: newStatus ? 'online' : 'offline' });

        const { error } = await supabase
            .from('drivers')
            .update({
                is_online: newStatus,
                status: newStatus ? 'online' : 'offline',
                updated_at: new Date().toISOString()
            })
            .eq('user_id', user.id);

        if (error) {
            Alert.alert('Error', 'Failed to update status');
            // Revert
            setDriver({ ...driver, is_online: !newStatus, status: !newStatus ? 'online' : 'offline' });
        }
    };

    const refreshPushToken = async () => {
        if (user) await registerPushToken(user.id);
    };

    return (
        <AuthContext.Provider value={{ user, session, driver, loading, signIn, signOut, toggleOnline, refreshPushToken }}>
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
