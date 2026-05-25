import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import { createHandler } from "../../src/lib/handler";
import {
  deleteMemory,
  deleteAllMemories,
  deleteMemoriesByType,
} from "../../src/services/memory.service";
import { clearWorkingMemory } from "../../src/db/redis";
import { updateUserProfile } from "../../src/services/user.service";

const Schema = z.object({
  user_id:   z.string().min(1),
  memory_id: z.string().optional(),
  type:      z.enum(["all", "working", "semantic", "pinned", "profile"]).optional(),
  session_id: z.string().optional(),
});

export default createHandler("DELETE", async (req: VercelRequest, res: VercelResponse) => {
  const parsed = Schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
  }

  const { user_id, memory_id, type, session_id } = parsed.data;

  if (!memory_id && !type) {
    return res.status(400).json({
      error: "Provide either memory_id (delete one) or type (delete by category).",
    });
  }

  const deleted: string[] = [];

  if (memory_id) {
    await deleteMemory(user_id, memory_id);
    deleted.push(`memory:${memory_id}`);
  } else if (type) {
    switch (type) {
      case "all":
        await deleteAllMemories(user_id);
        if (session_id) await clearWorkingMemory(user_id, session_id);
        await updateUserProfile(user_id, {});
        deleted.push("all_memories", "working_memory", "profile");
        break;

      case "working":
        if (!session_id) {
          return res.status(400).json({ error: "session_id is required when type is 'working'." });
        }
        await clearWorkingMemory(user_id, session_id);
        deleted.push("working_memory");
        break;

      case "semantic":
        await deleteMemoriesByType(user_id, "semantic");
        deleted.push("semantic_memories");
        break;

      case "pinned":
        await deleteMemoriesByType(user_id, "pinned");
        deleted.push("pinned_memories");
        break;

      case "profile":
        await updateUserProfile(user_id, {});
        await deleteMemoriesByType(user_id, "profile");
        deleted.push("profile_data", "preference_memories");
        break;
    }
  }

  return res.json({ deleted, message: `Deleted: ${deleted.join(", ")}.` });
});
