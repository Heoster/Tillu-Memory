import { v4 as uuidv4 } from "uuid";
import { getSupabase } from "../db/supabase";
import type { ActionLogRow } from "../types";

/**
 * Log a completed Tillu action for the Self-Evolution Engine.
 */
export async function logAction(
  userId: string,
  actionId: string,
  actionType: string,
  success: boolean,
  options?: {
    params?: Record<string, unknown>;
    skillName?: string;
    latencyMs?: number;
    timestamp?: string;
  }
): Promise<string> {
  const supabase = getSupabase();
  const id = uuidv4();
  const now = options?.timestamp ?? new Date().toISOString();

  const { error } = await supabase.from("action_log").insert({
    id,
    user_id: userId,
    action_id: actionId,
    action_type: actionType,
    params: options?.params ?? null,
    success,
    skill_name: options?.skillName ?? null,
    latency_ms: options?.latencyMs ?? null,
    timestamp: now,
    created_at: new Date().toISOString(),
  });

  if (error) throw new Error(`Failed to log action: ${error.message}`);
  return id;
}

/**
 * Get the most recent action for a user.
 * Used by /memory/context to give Core awareness of what just happened.
 */
export async function getLastAction(userId: string): Promise<ActionLogRow | null> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("action_log")
    .select("*")
    .eq("user_id", userId)
    .order("timestamp", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Failed to fetch last action: ${error.message}`);
  return data as ActionLogRow | null;
}

/**
 * Get action history for a skill — used by Self-Evolution Engine.
 */
export async function getSkillActionHistory(
  userId: string,
  skillName: string,
  limit = 20
): Promise<ActionLogRow[]> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("action_log")
    .select("*")
    .eq("user_id", userId)
    .eq("skill_name", skillName)
    .order("timestamp", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Failed to fetch skill action history: ${error.message}`);
  return (data ?? []) as ActionLogRow[];
}

/**
 * Delete action logs older than 90 days. Called by Dream Loop cleanup.
 */
export async function deleteOldActionLogs(userId?: string): Promise<number> {
  const supabase = getSupabase();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);

  let query = supabase
    .from("action_log")
    .delete()
    .lt("timestamp", cutoff.toISOString());

  if (userId) query = query.eq("user_id", userId);

  const { error, count } = await query;
  if (error) throw new Error(`Failed to delete old action logs: ${error.message}`);
  return count ?? 0;
}
