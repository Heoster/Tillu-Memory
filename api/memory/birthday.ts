import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import { getOrCreateUser } from "../../src/services/user.service";
import {
  storeBirthday,
  getUpcomingBirthdays,
  deleteBirthday,
} from "../../src/services/birthday.service";

const StoreSchema = z.object({
  user_id:     z.string().min(1),
  person_name: z.string().min(1),
  birth_date:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "birth_date must be YYYY-MM-DD"),
  relation:    z.string().optional(),
  notes:       z.string().optional(),
});

/**
 * POST /memory/birthday  — Store a birthday
 * GET  /memory/birthdays — Get upcoming birthdays in next N days
 * DELETE /memory/birthday?id=...&user_id=... — Delete a birthday
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();

  // ── GET — upcoming birthdays ───────────────────────────────────────────────
  if (req.method === "GET") {
    const userId = req.query.user_id as string;
    const days = parseInt((req.query.days as string) ?? "7", 10);

    if (!userId) return res.status(400).json({ error: "user_id query param required" });

    try {
      const birthdays = await getUpcomingBirthdays(userId, days);
      return res.json({ birthdays, days_ahead: days, total: birthdays.length });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      return res.status(500).json({ error: msg });
    }
  }

  // ── POST — store birthday ──────────────────────────────────────────────────
  if (req.method === "POST") {
    const parsed = StoreSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    }

    const { user_id, person_name, birth_date, relation, notes } = parsed.data;

    try {
      await getOrCreateUser(user_id);
      const id = await storeBirthday(user_id, person_name, birth_date, relation, notes);
      return res.status(201).json({
        birthday_id: id,
        message: `Birthday for ${person_name} stored. I'll remind Heoster 3 days before.`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      return res.status(500).json({ error: msg });
    }
  }

  // ── DELETE — remove birthday ───────────────────────────────────────────────
  if (req.method === "DELETE") {
    const userId = req.query.user_id as string;
    const id = req.query.id as string;

    if (!userId || !id) {
      return res.status(400).json({ error: "user_id and id query params required" });
    }

    try {
      await deleteBirthday(userId, id);
      return res.json({ message: "Birthday deleted." });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      return res.status(500).json({ error: msg });
    }
  }

  return res.status(405).json({ error: `Method ${req.method} not allowed.` });
}
