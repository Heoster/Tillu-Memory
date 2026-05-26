import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import { createHandler } from "../../src/lib/handler";
import { appendWorkingMessage, getWorkingMemory, setUserState } from "../../src/db/redis";
import { getPinnedMemories, semanticSearch } from "../../src/services/memory.service";
import { getUserProfile, getOrCreateUser } from "../../src/services/user.service";
import { upsertSession } from "../../src/services/session.service";
import { getUpcomingBirthdays } from "../../src/services/birthday.service";
import { getLastAction } from "../../src/services/action-log.service";
import type { ContextResponse, DreamState } from "../../src/types";

const Schema = z.object({
  user_id:    z.string().min(1),
  session_id: z.string().min(1),
  message:    z.string().optional(),
  role:       z.enum(["user", "assistant", "system"]).default("user"),
});

/**
 * GET /memory/context (also accepts POST for message write + read in one call)
 *
 * The primary endpoint for Tillu-Core. Returns everything needed before a decision:
 * working memory, pinned facts, semantic recall, full profile, dream state,
 * upcoming birthdays, and last action taken.
 */
export default createHandler("POST", async (req: VercelRequest, res: VercelResponse) => {
  const parsed = Schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
  }

  const { user_id, session_id, message, role } = parsed.data;
  const actionsTaken: string[] = [];

  await getOrCreateUser(user_id);
  await upsertSession(session_id, user_id);

  // Write incoming message to working memory if provided
  if (message) {
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

  // Fetch all context in parallel
  const [workingMemory, pinnedFacts, profile, lastAction, upcomingBirthdays] =
    await Promise.all([
      getWorkingMemory(user_id, session_id),
      getPinnedMemories(user_id),
      getUserProfile(user_id),
      getLastAction(user_id),
      getUpcomingBirthdays(user_id, 3), // birthdays in next 3 days
    ]);

  actionsTaken.push("read_working", "read_pinned", "read_profile", "read_birthdays", "read_last_action");

  // Semantic search if message provided
  let relevantPast: import("../../src/types").RelevantMemory[] = [];
  if (message && message.trim().length > 0) {
    relevantPast = await semanticSearch({ userId: user_id, query: message, topK: 5 });
    actionsTaken.push("semantic_search");
  }

  // Build dream state from profile
  const dreamLoop = profile.dream_loop ?? {};
  const dreamState: DreamState = {
    last_consolidated: dreamLoop.last_consolidated,
    last_briefing_prepared: dreamLoop.last_briefing_prepared,
    last_world_monitor: dreamLoop.last_world_monitor,
    morning_briefing_delivered_today: dreamLoop.morning_briefing_delivered_today ?? false,
    briefing_ready: !!dreamLoop.last_briefing_prepared &&
      !(dreamLoop.morning_briefing_delivered_today ?? false),
  };

  const response: ContextResponse = {
    working_memory: workingMemory,
    pinned_facts: pinnedFacts,
    relevant_past: relevantPast,
    profile,
    dream_state: dreamState,
    upcoming_birthdays: upcomingBirthdays,
    last_action: lastAction,
    actions_taken: actionsTaken,
  };

  return res.json(response);
});
