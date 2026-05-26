import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import { createHandler } from "../../src/lib/handler";
import {
  recordSkillFeedback,
  getSkillPerformance,
  getAllSkillsPerformance,
} from "../../src/services/skill-feedback.service";

const StoreSchema = z.object({
  user_id:           z.string().min(1),
  skill_name:        z.string().min(1),
  execution_id:      z.string().min(1),
  success:           z.boolean(),
  steps_completed:   z.number().int().nonnegative().optional(),
  steps_total:       z.number().int().nonnegative().optional(),
  latency_ms:        z.number().int().nonnegative().optional(),
  heoster_continued: z.boolean().optional(),
  timestamp:         z.string().optional(),
});

/**
 * POST /memory/skill-feedback
 *
 * Record skill execution performance.
 * Called by Tillu-Core after every skill execution.
 * Also returns the updated performance summary for that skill.
 */
export default createHandler("POST", async (req: VercelRequest, res: VercelResponse) => {
  // GET performance summary via query params (piggyback on same endpoint)
  if (req.method === "GET") {
    const userId = req.query.user_id as string;
    const skillName = req.query.skill_name as string;

    if (!userId) return res.status(400).json({ error: "user_id required" });

    if (skillName) {
      const perf = await getSkillPerformance(userId, skillName);
      return res.json({ skill_name: skillName, performance: perf });
    }

    const all = await getAllSkillsPerformance(userId);
    return res.json({ skills: all });
  }

  const parsed = StoreSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
  }

  const {
    user_id, skill_name, execution_id, success,
    steps_completed, steps_total, latency_ms, heoster_continued, timestamp,
  } = parsed.data;

  const id = await recordSkillFeedback(user_id, skill_name, execution_id, success, {
    stepsCompleted: steps_completed,
    stepsTotal: steps_total,
    latencyMs: latency_ms,
    heosterContinued: heoster_continued,
    timestamp,
  });

  // Return updated performance summary
  const performance = await getSkillPerformance(user_id, skill_name);

  return res.status(201).json({
    feedback_id: id,
    skill_name,
    performance,
    message: `Skill "${skill_name}" feedback recorded (${success ? "success" : "failure"}).`,
  });
});
