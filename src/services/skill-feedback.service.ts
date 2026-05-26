import { v4 as uuidv4 } from "uuid";
import { getSupabase } from "../db/supabase";
import type { SkillFeedbackRow } from "../types";

/**
 * Record skill execution performance.
 * Called by Tillu-Core after every skill execution.
 */
export async function recordSkillFeedback(
  userId: string,
  skillName: string,
  executionId: string,
  success: boolean,
  options?: {
    stepsCompleted?: number;
    stepsTotal?: number;
    latencyMs?: number;
    heosterContinued?: boolean;
    timestamp?: string;
  }
): Promise<string> {
  const supabase = getSupabase();
  const id = uuidv4();

  const { error } = await supabase.from("skill_feedback").insert({
    id,
    user_id: userId,
    skill_name: skillName,
    execution_id: executionId,
    success,
    steps_completed: options?.stepsCompleted ?? null,
    steps_total: options?.stepsTotal ?? null,
    latency_ms: options?.latencyMs ?? null,
    heoster_continued: options?.heosterContinued ?? false,
    timestamp: options?.timestamp ?? new Date().toISOString(),
  });

  if (error) throw new Error(`Failed to record skill feedback: ${error.message}`);
  return id;
}

/**
 * Get performance summary for a skill.
 * Used by Self-Evolution Engine to decide whether to keep, fix, or disable a skill.
 */
export async function getSkillPerformance(
  userId: string,
  skillName: string
): Promise<{
  total_executions: number;
  success_rate: number;
  avg_latency_ms: number;
  positive_feedback_rate: number;
  last_used: string | null;
}> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("skill_feedback")
    .select("*")
    .eq("user_id", userId)
    .eq("skill_name", skillName)
    .order("timestamp", { ascending: false });

  if (error) throw new Error(`Failed to fetch skill performance: ${error.message}`);

  const rows = (data ?? []) as SkillFeedbackRow[];
  if (rows.length === 0) {
    return {
      total_executions: 0,
      success_rate: 0,
      avg_latency_ms: 0,
      positive_feedback_rate: 0,
      last_used: null,
    };
  }

  const successCount = rows.filter((r) => r.success).length;
  const positiveCount = rows.filter((r) => r.heoster_continued).length;
  const latencies = rows.filter((r) => r.latency_ms != null).map((r) => r.latency_ms as number);
  const avgLatency = latencies.length > 0
    ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
    : 0;

  return {
    total_executions: rows.length,
    success_rate: Math.round((successCount / rows.length) * 100) / 100,
    avg_latency_ms: avgLatency,
    positive_feedback_rate: Math.round((positiveCount / rows.length) * 100) / 100,
    last_used: rows[0]?.timestamp ?? null,
  };
}

/**
 * Get performance summary for all skills — used by weekly Self-Evolution review.
 */
export async function getAllSkillsPerformance(
  userId: string
): Promise<Record<string, Awaited<ReturnType<typeof getSkillPerformance>>>> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("skill_feedback")
    .select("skill_name")
    .eq("user_id", userId);

  if (error) throw new Error(`Failed to fetch skill names: ${error.message}`);

  const skillNames = [...new Set((data ?? []).map((r: { skill_name: string }) => r.skill_name))];
  const results: Record<string, Awaited<ReturnType<typeof getSkillPerformance>>> = {};

  await Promise.all(
    skillNames.map(async (name) => {
      results[name] = await getSkillPerformance(userId, name);
    })
  );

  return results;
}
