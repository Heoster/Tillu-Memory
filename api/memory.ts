/**
 * api/memory.ts
 *
 * Unified memory router — replaces the 13 individual api/memory/*.ts files.
 * All /memory/* routes are rewritten here by vercel.json.
 *
 * Route dispatch is based on the last path segment:
 *   /memory/read           → handleRead
 *   /memory/write          → handleWrite
 *   /memory/search         → handleSearch
 *   /memory/unified        → handleUnified
 *   /memory/context        → handleContext
 *   /memory/consolidate    → handleConsolidate
 *   /memory/forget         → handleForget
 *   /memory/pin            → handlePin
 *   /memory/briefing       → handleBriefing
 *   /memory/birthday       → handleBirthday
 *   /memory/birthdays      → handleBirthday  (alias)
 *   /memory/action-log     → handleActionLog
 *   /memory/skill-feedback → handleSkillFeedback
 *   /memory/dream-state    → handleDreamState
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";

// ── DB / services ─────────────────────────────────────────────────────────────
import { appendWorkingMessage, clearWorkingMemory, getWorkingMemory, setUserState } from "../src/db/redis";
import {
  deleteAllMemories,
  deleteMemory,
  deleteMemoriesByType,
  getPinnedMemories,
  semanticSearch,
  setPinned,
  writeMemory,
} from "../src/services/memory.service";
import { getOrCreateUser, getUserProfile, updateUserProfile } from "../src/services/user.service";
import { upsertSession } from "../src/services/session.service";
import { consolidateSession } from "../src/services/consolidation.service";
import { storeBirthday, getUpcomingBirthdays, deleteBirthday } from "../src/services/birthday.service";
import { storeBriefing, getLatestBriefing, markBriefingDelivered } from "../src/services/briefing.service";
import { logAction, getSkillActionHistory, getLastAction } from "../src/services/action-log.service";
import {
  recordSkillFeedback,
  getSkillPerformance,
  getAllSkillsPerformance,
} from "../src/services/skill-feedback.service";
import type { ContextResponse, DreamState, RelevantMemory, UnifiedResponse, UserProfile } from "../src/types";

// ── CORS helper ───────────────────────────────────────────────────────────────
function setCors(res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

// ── Route handlers ────────────────────────────────────────────────────────────

// GET /memory/read
async function handleRead(req: VercelRequest, res: VercelResponse) {
  const Schema = z.object({
    user_id:    z.string().min(1),
    session_id: z.string().min(1),
    query:      z.string().optional(),
  });

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

  return res.json({ working_memory: workingMemory, pinned_facts: pinnedFacts, profile, semantic_results: semanticResults });
}

// POST /memory/write
async function handleWrite(req: VercelRequest, res: VercelResponse) {
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

  const parsed = Schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
  }

  const { user_id, content, type, importance, session_id, topic_tags } = parsed.data;
  await getOrCreateUser(user_id);

  const result = await writeMemory({ userId: user_id, content, type, importance, sessionId: session_id, topicTags: topic_tags });

  return res.status(201).json({
    memory_id:       result.memoryId,
    is_pinned:       result.isPinned,
    profile_updated: result.profileUpdated,
    message: result.isPinned
      ? "Memory stored and pinned (critical importance)."
      : "Memory stored and embedded for semantic search.",
  });
}

// POST /memory/search
async function handleSearch(req: VercelRequest, res: VercelResponse) {
  const Schema = z.object({
    user_id:     z.string().min(1),
    query:       z.string().min(1).max(1000),
    top_k:       z.coerce.number().int().min(1).max(20).default(5),
    time_filter: z.enum(["last_7_days", "last_30_days", "last_90_days", "all"]).default("all"),
  });

  const parsed = Schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
  }

  const { user_id, query, top_k, time_filter } = parsed.data;
  const results = await semanticSearch({ userId: user_id, query, topK: top_k, timeFilter: time_filter });

  return res.json({ results, query_used: query, total_found: results.length });
}

// POST /memory/unified
async function handleUnified(req: VercelRequest, res: VercelResponse) {
  const Schema = z.object({
    user_id:    z.string().min(1),
    session_id: z.string().min(1),
    action:     z.enum(["auto", "read", "write"]).default("auto"),
    message:    z.string().optional(),
    role:       z.enum(["user", "assistant", "system"]).default("user"),
    importance: z.enum(["critical", "high", "normal", "low"]).default("normal"),
  });

  const parsed = Schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
  }

  const { user_id, session_id, action, message, role } = parsed.data;
  const actionsTaken: string[] = [];

  await getOrCreateUser(user_id);
  await upsertSession(session_id, user_id);

  if ((action === "auto" || action === "write") && message) {
    await appendWorkingMessage(user_id, session_id, { role, content: message, timestamp: new Date().toISOString() });
    await setUserState(user_id, { session_id, last_active: new Date().toISOString() });
    actionsTaken.push("write_to_working");
  }

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

    const response: UnifiedResponse = { working_memory: workingMemory, pinned_facts: pinnedFacts, relevant_past: relevantPast, profile, actions_taken: actionsTaken };
    return res.json(response);
  }

  return res.json({ actions_taken: actionsTaken, message: "Written to working memory." });
}

// POST /memory/context
async function handleContext(req: VercelRequest, res: VercelResponse) {
  const Schema = z.object({
    user_id:    z.string().min(1),
    session_id: z.string().min(1),
    message:    z.string().optional(),
    role:       z.enum(["user", "assistant", "system"]).default("user"),
  });

  const parsed = Schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
  }

  const { user_id, session_id, message, role } = parsed.data;
  const actionsTaken: string[] = [];

  await getOrCreateUser(user_id);
  await upsertSession(session_id, user_id);

  if (message) {
    await appendWorkingMessage(user_id, session_id, { role, content: message, timestamp: new Date().toISOString() });
    await setUserState(user_id, { session_id, last_active: new Date().toISOString() });
    actionsTaken.push("write_to_working");
  }

  const [workingMemory, pinnedFacts, profile, lastAction, upcomingBirthdays] = await Promise.all([
    getWorkingMemory(user_id, session_id),
    getPinnedMemories(user_id),
    getUserProfile(user_id),
    getLastAction(user_id),
    getUpcomingBirthdays(user_id, 3),
  ]);
  actionsTaken.push("read_working", "read_pinned", "read_profile", "read_birthdays", "read_last_action");

  let relevantPast: RelevantMemory[] = [];
  if (message && message.trim().length > 0) {
    relevantPast = await semanticSearch({ userId: user_id, query: message, topK: 5 });
    actionsTaken.push("semantic_search");
  }

  const dreamLoop = profile.dream_loop ?? {};
  const dreamState: DreamState = {
    last_consolidated:               dreamLoop.last_consolidated,
    last_briefing_prepared:          dreamLoop.last_briefing_prepared,
    last_world_monitor:              dreamLoop.last_world_monitor,
    morning_briefing_delivered_today: dreamLoop.morning_briefing_delivered_today ?? false,
    briefing_ready: !!dreamLoop.last_briefing_prepared && !(dreamLoop.morning_briefing_delivered_today ?? false),
  };

  const response: ContextResponse = {
    working_memory: workingMemory, pinned_facts: pinnedFacts, relevant_past: relevantPast,
    profile, dream_state: dreamState, upcoming_birthdays: upcomingBirthdays,
    last_action: lastAction, actions_taken: actionsTaken,
  };

  return res.json(response);
}

// POST /memory/consolidate
async function handleConsolidate(req: VercelRequest, res: VercelResponse) {
  const Schema = z.object({
    user_id:    z.string().min(1),
    session_id: z.string().min(1),
  });

  const parsed = Schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
  }

  const { user_id, session_id } = parsed.data;

  try {
    const result = await consolidateSession(user_id, session_id);
    return res.json({
      summary:               result.summary,
      facts_extracted:       result.factsExtracted,
      preferences_extracted: result.preferencesExtracted,
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
}

// DELETE /memory/forget
async function handleForget(req: VercelRequest, res: VercelResponse) {
  const Schema = z.object({
    user_id:    z.string().min(1),
    memory_id:  z.string().optional(),
    type:       z.enum(["all", "working", "semantic", "pinned", "profile"]).optional(),
    session_id: z.string().optional(),
  });

  const parsed = Schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
  }

  const { user_id, memory_id, type, session_id } = parsed.data;

  if (!memory_id && !type) {
    return res.status(400).json({ error: "Provide either memory_id (delete one) or type (delete by category)." });
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
        if (!session_id) return res.status(400).json({ error: "session_id is required when type is 'working'." });
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
}

// PATCH /memory/pin
async function handlePin(req: VercelRequest, res: VercelResponse) {
  const Schema = z.object({
    user_id:   z.string().min(1),
    memory_id: z.string().min(1),
    pinned:    z.boolean(),
  });

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
}

// GET|POST|DELETE /memory/birthday(s)
async function handleBirthday(req: VercelRequest, res: VercelResponse) {
  const StoreSchema = z.object({
    user_id:     z.string().min(1),
    person_name: z.string().min(1),
    birth_date:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "birth_date must be YYYY-MM-DD"),
    relation:    z.string().optional(),
    notes:       z.string().optional(),
  });

  if (req.method === "GET") {
    const userId = req.query.user_id as string;
    const days = parseInt((req.query.days as string) ?? "7", 10);
    if (!userId) return res.status(400).json({ error: "user_id query param required" });
    try {
      const birthdays = await getUpcomingBirthdays(userId, days);
      return res.json({ birthdays, days_ahead: days, total: birthdays.length });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  }

  if (req.method === "POST") {
    const parsed = StoreSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    const { user_id, person_name, birth_date, relation, notes } = parsed.data;
    try {
      await getOrCreateUser(user_id);
      const id = await storeBirthday(user_id, person_name, birth_date, relation, notes);
      return res.status(201).json({ birthday_id: id, message: `Birthday for ${person_name} stored. I'll remind Heoster 3 days before.` });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  }

  if (req.method === "DELETE") {
    const userId = req.query.user_id as string;
    const id = req.query.id as string;
    if (!userId || !id) return res.status(400).json({ error: "user_id and id query params required" });
    try {
      await deleteBirthday(userId, id);
      return res.json({ message: "Birthday deleted." });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  }

  return res.status(405).json({ error: `Method ${req.method} not allowed.` });
}

// GET|POST /memory/briefing
async function handleBriefing(req: VercelRequest, res: VercelResponse) {
  const StoreSchema = z.object({
    user_id:         z.string().min(1),
    content:         z.string().min(1),
    news_summary:    z.string().optional(),
    weather:         z.string().optional(),
    calendar_events: z.array(z.string()).optional(),
    prepared_at:     z.string().optional(),
  });

  if (req.method === "GET") {
    const userId = req.query.user_id as string;
    const markDelivered = req.query.mark_delivered === "true";
    if (!userId) return res.status(400).json({ error: "user_id query param required" });
    try {
      const briefing = await getLatestBriefing(userId);
      if (!briefing) return res.json({ briefing: null, ready: false });
      if (markDelivered) await markBriefingDelivered(briefing.id);
      return res.json({ briefing, ready: true });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  }

  if (req.method === "POST") {
    const parsed = StoreSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    const { user_id, content, news_summary, weather, calendar_events, prepared_at } = parsed.data;
    try {
      const id = await storeBriefing(user_id, content, { newsSummary: news_summary, weather, calendarEvents: calendar_events, preparedAt: prepared_at });
      return res.status(201).json({ briefing_id: id, message: "Morning briefing stored. Will be delivered when Heoster comes online." });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  }

  return res.status(405).json({ error: `Method ${req.method} not allowed.` });
}

// POST /memory/action-log
async function handleActionLog(req: VercelRequest, res: VercelResponse) {
  const Schema = z.object({
    user_id:     z.string().min(1),
    action_id:   z.string().min(1),
    action_type: z.string().min(1),
    success:     z.boolean(),
    params:      z.record(z.unknown()).optional(),
    skill_name:  z.string().optional(),
    latency_ms:  z.number().int().nonnegative().optional(),
    timestamp:   z.string().optional(),
  });

  const parsed = Schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
  }

  const { user_id, action_id, action_type, success, params, skill_name, latency_ms, timestamp } = parsed.data;

  const id = await logAction(user_id, action_id, action_type, success, { params, skillName: skill_name, latencyMs: latency_ms, timestamp });

  let skillHistory = null;
  if (skill_name) {
    skillHistory = await getSkillActionHistory(user_id, skill_name, 10);
  }

  return res.status(201).json({
    log_id: id,
    skill_history: skillHistory,
    message: `Action "${action_type}" logged (${success ? "success" : "failure"}).`,
  });
}

// GET|POST /memory/skill-feedback
async function handleSkillFeedback(req: VercelRequest, res: VercelResponse) {
  if (req.method === "GET") {
    const userId = req.query.user_id as string;
    const skillName = req.query.skill_name as string;
    if (!userId) return res.status(400).json({ error: "user_id required" });
    if (skillName) {
      const perf = await getSkillPerformance(userId, skillName);
      return res.json({ skill_name: skillName, performance: perf });
    }
    const all = await getAllSkillsPerformance(userId);
    return res.json({ skills: all });
  }

  const StoreSchema = z.object({
    user_id:           z.string().min(1),
    skill_name:        z.string().min(1),
    execution_id:      z.string().min(1),
    success:           z.boolean(),
    steps_completed:   z.number().int().nonnegative().optional(),
    steps_total:       z.number().int().nonnegative().optional(),
    latency_ms:        z.number().int().nonnegative().optional(),
    heoster_continued: z.boolean().optional(),
    timestamp:         z.string().optional(),
  });

  const parsed = StoreSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
  }

  const { user_id, skill_name, execution_id, success, steps_completed, steps_total, latency_ms, heoster_continued, timestamp } = parsed.data;

  const id = await recordSkillFeedback(user_id, skill_name, execution_id, success, {
    stepsCompleted: steps_completed, stepsTotal: steps_total,
    latencyMs: latency_ms, heosterContinued: heoster_continued, timestamp,
  });

  const performance = await getSkillPerformance(user_id, skill_name);

  return res.status(201).json({
    feedback_id: id,
    skill_name,
    performance,
    message: `Skill "${skill_name}" feedback recorded (${success ? "success" : "failure"}).`,
  });
}

// GET|PATCH /memory/dream-state
async function handleDreamState(req: VercelRequest, res: VercelResponse) {
  if (req.method === "GET") {
    const userId = req.query.user_id as string;
    if (!userId) return res.status(400).json({ error: "user_id query param required" });
    try {
      const profile = await getUserProfile(userId);
      const dreamLoop = profile.dream_loop ?? {};
      return res.json({
        dream_loop: dreamLoop,
        briefing_ready: !!dreamLoop.last_briefing_prepared && !(dreamLoop.morning_briefing_delivered_today ?? false),
      });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  }

  if (req.method === "PATCH") {
    const PatchSchema = z.object({
      user_id: z.string().min(1),
      updates: z.object({
        last_consolidated:                z.string().optional(),
        last_briefing_prepared:           z.string().optional(),
        last_world_monitor:               z.string().optional(),
        morning_briefing_delivered_today: z.boolean().optional(),
      }),
    });

    const parsed = PatchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    }

    const { user_id, updates } = parsed.data;

    try {
      const current = await getUserProfile(user_id);
      const currentDreamLoop = (current.dream_loop as UserProfile["dream_loop"]) ?? {};
      const mergedDreamLoop = { ...currentDreamLoop, ...updates };
      await updateUserProfile(user_id, { dream_loop: mergedDreamLoop });
      return res.json({ dream_loop: mergedDreamLoop, message: "Dream Loop state updated." });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  }

  return res.status(405).json({ error: `Method ${req.method} not allowed.` });
}

// ── Main router ───────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();

  // Extract the last path segment: /memory/context → "context"
  const url = req.url ?? "";
  const segment = url.split("?")[0].split("/").filter(Boolean).pop() ?? "";

  try {
    switch (segment) {
      case "read":           return await handleRead(req, res);
      case "write":          return await handleWrite(req, res);
      case "search":         return await handleSearch(req, res);
      case "unified":        return await handleUnified(req, res);
      case "context":        return await handleContext(req, res);
      case "consolidate":    return await handleConsolidate(req, res);
      case "forget":         return await handleForget(req, res);
      case "pin":            return await handlePin(req, res);
      case "birthday":
      case "birthdays":      return await handleBirthday(req, res);
      case "briefing":       return await handleBriefing(req, res);
      case "action-log":     return await handleActionLog(req, res);
      case "skill-feedback": return await handleSkillFeedback(req, res);
      case "dream-state":    return await handleDreamState(req, res);
      default:
        return res.status(404).json({ error: `Unknown memory route: /memory/${segment}` });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[memory router] ${segment} error:`, err);
    return res.status(500).json({ error: message });
  }
}
