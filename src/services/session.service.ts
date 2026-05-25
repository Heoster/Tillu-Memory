import { getSupabase } from "../db/supabase";
import type { SessionRow } from "../types";

/**
 * Upsert a session record (creates on first message, updates on subsequent).
 */
export async function upsertSession(
  sessionId: string,
  userId: string
): Promise<void> {
  const supabase = getSupabase();

  const { error } = await supabase.from("sessions").upsert(
    {
      session_id: sessionId,
      user_id: userId,
      started_at: new Date().toISOString(),
    },
    { onConflict: "session_id", ignoreDuplicates: true }
  );

  if (error) throw new Error(`Failed to upsert session: ${error.message}`);
}

/**
 * Finalize a session — set ended_at, summary, message_count, topics.
 */
export async function finalizeSession(
  sessionId: string,
  summary: string,
  messageCount: number,
  topics: string[]
): Promise<void> {
  const supabase = getSupabase();

  const { error } = await supabase
    .from("sessions")
    .update({
      summary,
      ended_at: new Date().toISOString(),
      message_count: messageCount,
      topics_discussed: topics,
    })
    .eq("session_id", sessionId);

  if (error) throw new Error(`Failed to finalize session: ${error.message}`);
}

/**
 * Get recent sessions for a user (for "what did we talk about last week?" queries).
 */
export async function getRecentSessions(
  userId: string,
  limit = 10
): Promise<SessionRow[]> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("sessions")
    .select("*")
    .eq("user_id", userId)
    .not("ended_at", "is", null)
    .order("ended_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Failed to fetch sessions: ${error.message}`);
  return (data ?? []) as SessionRow[];
}

