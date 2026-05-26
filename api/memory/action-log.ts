import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import { createHandler } from "../../src/lib/handler";
import { logAction, getSkillActionHistory } from "../../src/services/action-log.service";

const Schema = z.object({
  user_id:     z.string().min(1),
  action_id:   z.string().min(1),
  action_type: z.string().min(1),
  success:     z.boolean(),
  params:      z.record(z.unknown()).optional(),
  skill_name:  z.string().optional(),
  latency_ms:  z.number().int().nonnegative().optional(),
  timestamp:   z.string().optional(),
});

/**
 * POST /memory/action-log
 *
 * Log a completed Tillu action for the Self-Evolution Engine.
 * Called by Tillu-Core after every action execution.
 */
export default createHandler("POST", async (req: VercelRequest, res: VercelResponse) => {
  const parsed = Schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
  }

  const { user_id, action_id, action_type, success, params, skill_name, latency_ms, timestamp } =
    parsed.data;

  const id = await logAction(user_id, action_id, action_type, success, {
    params,
    skillName: skill_name,
    latencyMs: latency_ms,
    timestamp,
  });

  // If skill_name provided, also return recent history for that skill
  let skillHistory = null;
  if (skill_name) {
    skillHistory = await getSkillActionHistory(user_id, skill_name, 10);
  }

  return res.status(201).json({
    log_id: id,
    skill_history: skillHistory,
    message: `Action "${action_type}" logged (${success ? "success" : "failure"}).`,
  });
});
