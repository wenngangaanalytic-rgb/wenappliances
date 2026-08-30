import { createClient } from '@supabase/supabase-js';

// These are browser-safe public values only. Environment variables remain the
// preferred source, while the fallback prevents a missing Vercel env setting
// from turning the entire SPA into a blank page. Never place a service-role key
// here.
const fallbackSupabaseUrl = 'https://nupuzbammbdunvurjgzv.supabase.co';
const fallbackSupabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im51cHV6YmFtbWJkdW52dXJqZ3p2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczMzQ4ODYsImV4cCI6MjEwMjkxMDg4Nn0.qGqlgC_oOun4byNy3P8z9rt4r4mgpexnoMrgcSB50LM';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || fallbackSupabaseUrl;
// Support both Supabase's newer publishable-key name and the legacy anon-key name.
// The publishable key is preferred when both are configured.
const supabasePublishableKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  fallbackSupabaseAnonKey;

export const supabase = createClient(supabaseUrl, supabasePublishableKey);

// Product chat uses a separate persisted anonymous Auth session. This keeps
// guest chat ownership isolated from the storefront's customer/admin session
// while still allowing RLS to protect each browser's conversation history.
export const chatSupabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    storageKey: 'wenappliances-chat-auth',
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false
  }
});
