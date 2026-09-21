import { createClient } from '@supabase/supabase-js';
import type { Database } from '../types/database.types';

// The client uses ONLY these two variables. Service/secret keys never appear in
// client code — they are for server-side and seed scripts.
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!url || !anonKey) {
  throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set (see .env.example).');
}

// Vite also loads `.env` (production values) in dev; `.env.development.local`
// overrides it. If that override is ever missing, fail loudly instead of
// developing against production.
const PRODUCTION_REF = 'tzifbmuuczogckruptap';
if (import.meta.env.DEV && url.includes(PRODUCTION_REF)) {
  throw new Error('Dev server is pointed at the PRODUCTION Supabase project. Create .env.development.local with the pawme-dev URL and key.');
}

export const projectRef = new URL(url).hostname.split('.')[0];

export const supabase = createClient<Database>(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

export type Tables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row'];
export type Enums<T extends keyof Database['public']['Enums']> = Database['public']['Enums'][T];
export type DeckCard = Database['public']['Functions']['get_deck']['Returns'][number];
export type InboxRow = Database['public']['Functions']['get_inbox']['Returns'][number];

export const petPhotoUrl = (path: string | null | undefined) =>
  path ? `${url}/storage/v1/object/public/pet-photos/${path}` : undefined;
