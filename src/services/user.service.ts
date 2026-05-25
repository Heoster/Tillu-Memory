import { getSupabase } from "../db/supabase";
import type { UserRow, UserProfile } from "../types";

/**
 * Get or create a user record.
 * Upserts on conflict so first-time users are handled transparently.
 */
export async function getOrCreateUser(userId: string): Promise<UserRow> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("users")
    .upsert(
      { user_id: userId, last_active: new Date().toISOString() },
      { onConflict: "user_id", ignoreDuplicates: false }
    )
    .select()
    .single();

  if (error) throw new Error(`Failed to get/create user: ${error.message}`);
  return data as UserRow;
}

/**
 * Fetch the user's profile data.
 */
export async function getUserProfile(userId: string): Promise<UserProfile> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("users")
    .select("profile_data")
    .eq("user_id", userId)
    .single();

  if (error) {
    if (error.code === "PGRST116") return {}; // not found → empty profile
    throw new Error(`Failed to fetch user profile: ${error.message}`);
  }

  return (data?.profile_data as UserProfile) ?? {};
}

/**
 * Merge new profile fields into the existing profile_data JSONB.
 * Never overwrites the whole object — only updates provided keys.
 */
export async function updateUserProfile(
  userId: string,
  updates: Partial<UserProfile>
): Promise<void> {
  const supabase = getSupabase();

  // Fetch current profile first
  const current = await getUserProfile(userId);

  // Deep merge: arrays are replaced, scalars are overwritten
  const merged: UserProfile = { ...current };
  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined && value !== null) {
      merged[key] = value;
    }
  }

  const { error } = await supabase
    .from("users")
    .update({
      profile_data: merged,
      last_active: new Date().toISOString(),
    })
    .eq("user_id", userId);

  if (error) throw new Error(`Failed to update user profile: ${error.message}`);
}

/**
 * Touch last_active timestamp.
 */
export async function touchUser(userId: string): Promise<void> {
  const supabase = getSupabase();
  await supabase
    .from("users")
    .update({ last_active: new Date().toISOString() })
    .eq("user_id", userId);
}

