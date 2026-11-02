import React, { createContext, useContext, useEffect, useState } from 'react';
import { initializeSupabaseClient, readSavedSession } from '@gtaxi/core';
const { supabase } = initializeSupabaseClient('native');
import { User, Session } from '@supabase/supabase-js';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, name: string, acceptedTerms: boolean, phone?: string) => Promise<void>;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  loading: true,
  signIn: async () => {},
  signUp: async () => {},
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Whatever is saved on the phone opens the app straight away, signal or not.
    readSavedSession().then(async (saved) => {
      if (saved) {
        setSession(saved);
        setUser(saved.user);
        setLoading(false);
      }
      const { data } = await supabase.auth.getSession().then((r: any) => r, () => ({ data: { session: null } }));
      if (data.session) {
        setSession(data.session);
        setUser(data.session.user);
      }
      setLoading(false);
    }).catch(() => setLoading(false));

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event: string, session: Session | null) => {
      // No session only means signed out when the server says so.
      if (!session && event !== 'SIGNED_OUT') return;
      setSession(session);
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  };

  const signUp = async (email: string, password: string, name: string, acceptedTerms: boolean, phone?: string) => {
    // merchant_signup rejects any request without accepted_terms.
    const { data, error } = await supabase.functions.invoke('merchant_signup', {
      body: { email, password, full_name: name, accepted_terms: acceptedTerms, phone: phone || undefined },
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error || 'Registration failed');
  };

  const signOut = async () => {
    await supabase.auth.signOut({ scope: 'local' });
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
