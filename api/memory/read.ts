import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import { createHandler } from "../../src/lib/handler";
import { getWorkingMemory } from "../../src/db/redis";
import { getPinnedMemories, semanticSearch } from "../../src/services/memory.service";
import { getUserProfile } from "../../src/services/user.service";
import type { ReadResponse, RelevantMemory } from "../../src/types";

const Schema = z.object({
  user_id:    z.string().min(1),
  session_id: z.string().min(1),
  query:      z.string().optional(),
});

export default createHandler("GET", async (req: VercelRequest, res: VercelResponse) => {
  const parsed = Schema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query params", details: parsed.error.flatten() });
  }

  const { user_id, session_id, query } = parsed.data;

  const [workingMemory, pinnedFacts, profile] = await Promise.all([
    getWorkingMemory(user_id, session_id),
    getPinnedMemories(user_id),
    getUserProfile(user_id),
  ]);

  let semanticResults: RelevantMemory[] = [];
  if (query && query.trim().length > 0) {
    semanticResults = await semanticSearch({ userId: user_id, query });
  }

  const response: ReadResponse = {
    working_memory:   workingMemory,
    pinned_facts:     pinnedFacts,
    profile,
    semantic_results: semanticResults,
  };

  return res.json(response);
});
