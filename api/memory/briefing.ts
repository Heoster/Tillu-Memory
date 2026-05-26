import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import { createHandler } from "../../src/lib/handler";
import {
  storeBriefing,
  getLatestBriefing,
  markBriefingDelivered,
} from "../../src/services/briefing.service";

const StoreSchema = z.object({
  user_id:         z.string().min(1),
  content:         z.string().min(1),
  news_summary:    z.string().optional(),
  weather:         z.string().optional(),
  calendar_events: z.array(z.string()).optional(),
  prepared_at:     z.string().optional(),
});

/**
 * POST /memory/briefing — Store a prepared morning briefing (Dream Loop)
 * GET  /memory/briefing — Retrieve latest undelivered briefing
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();

  // ── GET — retrieve latest briefing ────────────────────────────────────────
  if (req.method === "GET") {
    const userId = req.query.user_id as string;
    const markDelivered = req.query.mark_delivered === "true";

    if (!userId) {
      return res.status(400).json({ error: "user_id query param required" });
    }

    try {
      const briefing = await getLatestBriefing(userId);

      if (!briefing) {
        return res.json({ briefing: null, ready: false });
      }

      // Optionally mark as delivered in the same call
      if (markDelivered) {
        await markBriefingDelivered(briefing.id);
      }

      return res.json({ briefing, ready: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      return res.status(500).json({ error: msg });
    }
  }

  // ── POST — store briefing ──────────────────────────────────────────────────
  if (req.method === "POST") {
    const parsed = StoreSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    }

    const { user_id, content, news_summary, weather, calendar_events, prepared_at } = parsed.data;

    try {
      const id = await storeBriefing(user_id, content, {
        newsSummary: news_summary,
        weather,
        calendarEvents: calendar_events,
        preparedAt: prepared_at,
      });

      return res.status(201).json({
        briefing_id: id,
        message: "Morning briefing stored. Will be delivered when Heoster comes online.",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      return res.status(500).json({ error: msg });
    }
  }

  return res.status(405).json({ error: `Method ${req.method} not allowed.` });
}
