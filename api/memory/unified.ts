import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import { createHandler } from "../../src/lib/handler";
import {
  appendWorkingMessage,
  getWorkingMemory,
  setUserState,
} from "../../src/db/redis";
import { getPinnedMemories, semanticSearch } from "../../src/services/memory.service";
import { getUserProfile, getOrCreateUser } from "../../src/services/user.service";
import { upsertSession } from "../../src/services/session.service";
import type { UnifiedResponse, RelevantMemory } from "../../src/types";

const Schema = z.object({
  user_id:    z.string().min(1),
  session_id: z.string().min(1),
  action:     z.enum(["auto", "read", "write"]).default("auto"),
  message:    z.string().optional(),
  role:       z.enum(["user", "assistant", "system"]).default("user"),
  importance: z.enum(["critical", "high", "normal", "low"]).default("normal"),
});

export default createHandler("POST", async (req: VercelRequest, res: VercelResponse) => {
  const parsed = Schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
  }

  const { user_id, session_id, action, message, role } = parsed.data;
  const actionsTaken: string[] = [];

  await getOrCreateUser(user_id);
  await upsertSession(session_id, user_id);

  // ── WRITE phase ────────────────────────────────────────────────────────────
  if ((action === "auto" || action === "write") && message) {
    await appendWorkingMessage(user_id, session_id, {
      role,
      content: message,
      timestamp: new Date().toISOString(),
    });
    await setUserState(user_id, {
      session_id,
      last_active: new Date().toISOString(),
    });
    actionsTaken.push("write_to_working");
  }

  // ── READ phase ─────────────────────────────────────────────────────────────
  if (action === "auto" || action === "read") {
    const [workingMemory, pinnedFacts, profile] = await Promise.all([
      getWorkingMemory(user_id, session_id),
      getPinnedMemories(user_id),
      getUserProfile(user_id),
    ]);
    actionsTaken.push("read_working", "read_pinned", "read_profile");

    let relevantPast: RelevantMemory[] = [];
    if (message && message.trim().length > 0) {
      relevantPast = await semanticSearch({ userId: user_id, query: message, topK: 5 });
      actionsTaken.push("semantic_search");
    }

    const response: UnifiedResponse = {
      working_memory: workingMemory,
      pinned_facts: pinnedFacts,
      relevant_past: relevantPast,
      profile,
      actions_taken: actionsTaken,
    };
    return res.json(response);
  }

  return res.json({ actions_taken: actionsTaken, message: "Written to working memory." });
});
