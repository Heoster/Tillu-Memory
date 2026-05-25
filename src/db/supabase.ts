import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { config } from "../config";

// Singleton Supabase client using service role key (bypasses RLS for server-side ops)
let _client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!_client) {
    _client = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }
  return _client;
}

