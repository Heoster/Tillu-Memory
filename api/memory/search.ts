import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import { createHandler } from "../../src/lib/handler";
import { semanticSearch } from "../../src/services/memory.service";

const Schema = z.object({
  user_id:     z.string().min(1),
  query:       z.string().min(1).max(1000),
  top_k:       z.coerce.number().int().min(1).max(20).default(5),
  time_filter: z
    .enum(["last_7_days", "last_30_days", "last_90_days", "all"])
    .default("all"),
});

export default createHandler("POST", async (req: VercelRequest, res: VercelResponse) => {
  const parsed = Schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
  }

  const { user_id, query, top_k, time_filter } = parsed.data;

  const results = await semanticSearch({
    userId:     user_id,
    query,
    topK:       top_k,
    timeFilter: time_filter,
  });

  return res.json({
    results,
    query_used:  query,
    total_found: results.length,
  });
});
