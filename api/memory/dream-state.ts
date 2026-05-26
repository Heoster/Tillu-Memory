import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import { getUserProfile, updateUserProfile } from "../../src/services/user.service";
import type { UserProfile } from "../../src/types";

const PatchSchema = z.object({
  user_id: z.string().min(1),
  updates: z.object({
    last_consolidated:               z.string().optional(),
    last_briefing_prepared:          z.string().optional(),
    last_world_monitor:              z.string().optional(),
    morning_briefing_delivered_today: z.boolean().optional(),
  }),
});

/**
 * GET  /memory/dream-state?user_id=heoster  — Read Dream Loop state
 * PATCH /memory/dream-state                 — Update Dream Loop state
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, PATCH, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();

  // ── GET ────────────────────────────────────────────────────────────────────
  if (req.method === "GET") {
    const userId = req.query.user_id as string;
    if (!userId) return res.status(400).json({ error: "user_id query param required" });

    try {
      const profile = await getUserProfile(userId);
      const dreamLoop = profile.dream_loop ?? {};

      return res.json({
        dream_loop: dreamLoop,
        briefing_ready: !!dreamLoop.last_briefing_prepared &&
          !(dreamLoop.morning_briefing_delivered_today ?? false),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      return res.status(500).json({ error: msg });
    }
  }

  // ── PATCH ──────────────────────────────────────────────────────────────────
  if (req.method === "PATCH") {
    const parsed = PatchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    }

    const { user_id, updates } = parsed.data;

    try {
      // Fetch current profile to merge dream_loop sub-object
      const current = await getUserProfile(user_id);
      const currentDreamLoop = (current.dream_loop as UserProfile["dream_loop"]) ?? {};

      const mergedDreamLoop = { ...currentDreamLoop, ...updates };

      await updateUserProfile(user_id, { dream_loop: mergedDreamLoop });

      return res.json({
        dream_loop: mergedDreamLoop,
        message: "Dream Loop state updated.",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      return res.status(500).json({ error: msg });
    }
  }

  return res.status(405).json({ error: `Method ${req.method} not allowed.` });
}
