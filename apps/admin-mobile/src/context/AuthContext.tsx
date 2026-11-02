import React, { createContext, useContext, useEffect, useState } from 'react';
import { readSavedSession, supabase } from '@gtaxi/core';
import { User, Session } from '@supabase/supabase-js';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, fullName: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
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
    if (!supabase) {
      setLoading(false);
      return;
    }
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

  // Always creates a plain rider account — the only path to admin is an
  // existing admin granting it via apps/admin/src/pages/Users.tsx.
  const signUp = async (email: string, password: string, fullName: string) => {
    const { error } = await supabase.auth.signUp({
      email, password,
      options: { data: { full_name: fullName, role: 'rider' } },
    });
    if (error) throw error;
    // signUp auto-establishes a session (no email confirmation on this
    // project). Left signed in, RootNavigator correctly rejects the
    // non-admin session — but that swaps out SignupScreen before its
    // "Account created" confirmation ever renders. Sign back out so the
    // caller's success state actually reaches the user.
    await supabase.auth.signOut({ scope: 'local' });
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
