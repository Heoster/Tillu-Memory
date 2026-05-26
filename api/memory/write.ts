import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import { createHandler } from "../../src/lib/handler";
import { writeMemory } from "../../src/services/memory.service";
import { getOrCreateUser } from "../../src/services/user.service";

const Schema = z.object({
  user_id:    z.string().min(1),
  content:    z.string().min(1).max(10000),
  type:       z.enum(["fact", "event", "preference", "summary",
                      "birthday", "relationship", "action_log",
                      "skill_feedback", "briefing", "tracked_topic"]),
  importance: z.enum(["critical", "high", "normal", "low"]),
  session_id: z.string().optional(),
  topic_tags: z.array(z.string()).optional(),
});

export default createHandler("POST", async (req: VercelRequest, res: VercelResponse) => {
  const parsed = Schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
  }

  const { user_id, content, type, importance, session_id, topic_tags } = parsed.data;

  await getOrCreateUser(user_id);

  const result = await writeMemory({
    userId: user_id,
    content,
    type,
    importance,
    sessionId: session_id,
    topicTags: topic_tags,
  });

  return res.status(201).json({
    memory_id:       result.memoryId,
    is_pinned:       result.isPinned,
    profile_updated: result.profileUpdated,
    message: result.isPinned
      ? "Memory stored and pinned (critical importance)."
      : "Memory stored and embedded for semantic search.",
  });
});
