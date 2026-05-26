import { v4 as uuidv4 } from "uuid";
import { getSupabase } from "../db/supabase";
import type { BriefingRow } from "../types";

/**
 * Store a prepared morning briefing from the Dream Loop.
 */
export async function storeBriefing(
  userId: string,
  content: string,
  options?: {
    newsSummary?: string;
    weather?: string;
    calendarEvents?: string[];
    preparedAt?: string;
  }
): Promise<string> {
  const supabase = getSupabase();
  const id = uuidv4();
  const now = options?.preparedAt ?? new Date().toISOString();

  // Expires 7 days after preparation
  const expiresAt = new Date(now);
  expiresAt.setDate(expiresAt.getDate() + 7);

  const { error } = await supabase.from("briefings").insert({
    id,
    user_id: userId,
    content,
    news_summary: options?.newsSummary ?? null,
    weather: options?.weather ?? null,
    calendar_events: options?.calendarEvents ?? null,
    delivered: false,
    prepared_at: now,
    delivered_at: null,
    expires_at: expiresAt.toISOString(),
  });

  if (error) throw new Error(`Failed to store briefing: ${error.message}`);
  return id;
}

/**
 * Get the latest undelivered briefing for a user.
 * Returns null if no briefing is ready or all have been delivered today.
 */
export async function getLatestBriefing(userId: string): Promise<BriefingRow | null> {
  const supabase = getSupabase();
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("briefings")
    .select("*")
    .eq("user_id", userId)
    .eq("delivered", false)
    .gt("expires_at", now)
    .order("prepared_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Failed to fetch briefing: ${error.message}`);
  return data as BriefingRow | null;
}

/**
 * Mark a briefing as delivered.
 */
export async function markBriefingDelivered(briefingId: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("briefings")
    .update({ delivered: true, delivered_at: new Date().toISOString() })
    .eq("id", briefingId);
  if (error) throw new Error(`Failed to mark briefing delivered: ${error.message}`);
}

/**
 * Delete expired briefings (older than 7 days). Called by Dream Loop cleanup.
 */
export async function deleteExpiredBriefings(userId?: string): Promise<number> {
  const supabase = getSupabase();
  let query = supabase
    .from("briefings")
    .delete()
    .lt("expires_at", new Date().toISOString());

  if (userId) query = query.eq("user_id", userId);

  const { error, count } = await query;
  if (error) throw new Error(`Failed to delete expired briefings: ${error.message}`);
  return count ?? 0;
}
