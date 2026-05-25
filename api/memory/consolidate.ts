import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import { createHandler } from "../../src/lib/handler";
import { consolidateSession } from "../../src/services/consolidation.service";

const Schema = z.object({
  user_id:    z.string().min(1),
  session_id: z.string().min(1),
});

export default createHandler("POST", async (req: VercelRequest, res: VercelResponse) => {
  const parsed = Schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
  }

  const { user_id, session_id } = parsed.data;

  try {
    const result = await consolidateSession(user_id, session_id);
    return res.json({
      summary:                result.summary,
      facts_extracted:        result.factsExtracted,
      preferences_extracted:  result.preferencesExtracted,
      session_id,
      message: result.summary
        ? "Session consolidated into long-term memory."
        : "No messages found — nothing to consolidate.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const status = message.includes("already in progress") ? 409 : 500;
    return res.status(status).json({ error: message });
  }
});
