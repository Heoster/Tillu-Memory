import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import { createHandler } from "../../src/lib/handler";
import { setPinned } from "../../src/services/memory.service";

const Schema = z.object({
  user_id:   z.string().min(1),
  memory_id: z.string().min(1),
  pinned:    z.boolean(),
});

export default createHandler("PATCH", async (req: VercelRequest, res: VercelResponse) => {
  const parsed = Schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
  }

  const { user_id, memory_id, pinned } = parsed.data;

  try {
    await setPinned(user_id, memory_id, pinned);
    return res.json({
      memory_id,
      is_pinned: pinned,
      message: pinned
        ? "Memory pinned. It will always be included in context."
        : "Memory unpinned. It remains in semantic memory.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const status = message.includes("Pin limit") ? 422 : 500;
    return res.status(status).json({ error: message });
  }
});
