import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, type Tables } from './supabase';

type Owner = Tables<'owners'>;
type Pet = Tables<'pets'>;

interface AuthState {
  /** undefined while the stored session is still being read */
  session: Session | null | undefined;
  owner: Owner | null;
  /** V1 screens handle one pet per owner; the schema allows more. */
  pet: Pet | null;
  profileLoading: boolean;
  profileError: string | null;
  reloadProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [owner, setOwner] = useState<Owner | null>(null);
  const [pet, setPet] = useState<Pet | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => sub.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id;

  const reloadProfile = useCallback(async () => {
    if (!userId) {
      setOwner(null);
      setPet(null);
      return;
    }
    setProfileLoading(true);
    setProfileError(null);
    const [ownerRes, petRes] = await Promise.all([
      supabase.from('owners').select('*').eq('id', userId).maybeSingle(),
      supabase.from('pets').select('*').eq('owner_id', userId).order('created_at').limit(1).maybeSingle(),
    ]);
    if (ownerRes.error || petRes.error) setProfileError((ownerRes.error ?? petRes.error)!.message);
    setOwner(ownerRes.data ?? null);
    setPet(petRes.data ?? null);
    setProfileLoading(false);
  }, [userId]);

  useEffect(() => {
    void reloadProfile();
  }, [reloadProfile]);

  const value = useMemo<AuthState>(
    () => ({ session, owner, pet, profileLoading, profileError, reloadProfile, signOut: async () => void (await supabase.auth.signOut()) }),
    [session, owner, pet, profileLoading, profileError, reloadProfile],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
