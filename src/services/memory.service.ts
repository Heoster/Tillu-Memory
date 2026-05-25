import { v4 as uuidv4 } from "uuid";
import { getSupabase } from "../db/supabase";
import { embedText } from "./embedding.service";
import { updateUserProfile } from "./user.service";
import { config } from "../config";
import type {
  MemoryRow,
  MemoryType,
  ImportanceLevel,
  RelevantMemory,
  UserProfile,
} from "../types";

// ─── Write ────────────────────────────────────────────────────────────────────

export interface WriteMemoryInput {
  userId: string;
  content: string;
  type: MemoryType;
  importance: ImportanceLevel;
  sessionId?: string;
  topicTags?: string[];
}

export interface WriteMemoryResult {
  memoryId: string;
  isPinned: boolean;
  profileUpdated: boolean;
}

/**
 * Store a memory in Supabase.
 *
 * Rules:
 * - critical → always pinned, no embedding needed (always fetched directly)
 * - high/normal/low → embedded and stored for semantic search
 * - preference type → also updates users.profile_data
 */
export async function writeMemory(input: WriteMemoryInput): Promise<WriteMemoryResult> {
  const supabase = getSupabase();
  const memoryId = uuidv4();
  const isPinned = input.importance === "critical";
  let profileUpdated = false;

  // Embed unless critical (critical memories are always fetched, no vector needed)
  let embedding: number[] | undefined;
  if (input.importance !== "critical") {
    const result = await embedText(input.content);
    embedding = result.embedding;
  }

  const now = new Date().toISOString();

  const { error } = await supabase.from("memories").insert({
    id: memoryId,
    user_id: input.userId,
    content: input.content,
    embedding: embedding ?? null,
    type: input.type,
    importance: input.importance,
    is_pinned: isPinned,
    topic_tags: input.topicTags ?? [],
    source_session_id: input.sessionId ?? null,
    created_at: now,
    accessed_at: now,
    access_count: 0,
  });

  if (error) throw new Error(`Failed to write memory: ${error.message}`);

  // If it's a preference, extract and update profile
  if (input.type === "preference") {
    const extracted = extractProfileFromContent(input.content);
    if (Object.keys(extracted).length > 0) {
      await updateUserProfile(input.userId, extracted);
      profileUpdated = true;
    }
  }

  return { memoryId, isPinned, profileUpdated };
}

// ─── Read Pinned ──────────────────────────────────────────────────────────────

/**
 * Fetch all pinned memories for a user (always injected into context).
 */
export async function getPinnedMemories(userId: string): Promise<string[]> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("memories")
    .select("id, content, accessed_at, access_count")
    .eq("user_id", userId)
    .eq("is_pinned", true)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Failed to fetch pinned memories: ${error.message}`);

  // Touch access stats in background (don't await)
  if (data && data.length > 0) {
    const ids = data.map((m: { id: string }) => m.id);
    touchMemoryAccess(ids).catch(() => {});
  }

  return (data ?? []).map((m: { content: string }) => m.content);
}

// ─── Semantic Search ──────────────────────────────────────────────────────────

export interface SemanticSearchInput {
  userId: string;
  query: string;
  topK?: number;
  timeFilter?: "last_7_days" | "last_30_days" | "last_90_days" | "all";
}

/**
 * Semantic similarity search using pgvector.
 * Applies time-decay boost so recent memories rank higher.
 */
export async function semanticSearch(
  input: SemanticSearchInput
): Promise<RelevantMemory[]> {
  const supabase = getSupabase();
  const topK = input.topK ?? config.memory.maxSemanticResults;

  // Embed the query
  const { embedding: queryEmbedding } = await embedText(input.query);

  // Build time filter
  let createdAfter: string | null = null;
  if (input.timeFilter && input.timeFilter !== "all") {
    const days = { last_7_days: 7, last_30_days: 30, last_90_days: 90 }[input.timeFilter];
    const d = new Date();
    d.setDate(d.getDate() - days);
    createdAfter = d.toISOString();
  }

  // Use Supabase RPC for pgvector similarity search
  const { data, error } = await supabase.rpc("search_memories", {
    p_user_id: input.userId,
    p_embedding: queryEmbedding,
    p_top_k: topK,
    p_created_after: createdAfter,
  });

  if (error) throw new Error(`Semantic search failed: ${error.message}`);

  const results = (data ?? []) as Array<{
    id: string;
    content: string;
    created_at: string;
    importance: ImportanceLevel;
    type: MemoryType;
    topic_tags: string[];
    similarity: number;
  }>;

  // Touch access stats in background
  if (results.length > 0) {
    touchMemoryAccess(results.map((r) => r.id)).catch(() => {});
  }

  return results.map((r) => ({
    id: r.id,
    content: r.content,
    created_at: r.created_at,
    importance: r.importance,
    type: r.type,
    topic_tags: r.topic_tags,
    similarity_score: r.similarity,
  }));
}

// ─── Pin / Unpin ──────────────────────────────────────────────────────────────

export async function setPinned(
  userId: string,
  memoryId: string,
  pinned: boolean
): Promise<void> {
  const supabase = getSupabase();

  if (pinned) {
    // Check pin limit
    const { count, error: countError } = await supabase
      .from("memories")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("is_pinned", true);

    if (countError) throw new Error(`Failed to count pinned: ${countError.message}`);
    if ((count ?? 0) >= config.memory.maxPinned) {
      throw new Error(
        `Pin limit reached (${config.memory.maxPinned}). Unpin an existing memory first.`
      );
    }
  }

  const { error } = await supabase
    .from("memories")
    .update({ is_pinned: pinned })
    .eq("id", memoryId)
    .eq("user_id", userId); // safety: user can only pin their own

  if (error) throw new Error(`Failed to update pin status: ${error.message}`);
}

// ─── Delete ───────────────────────────────────────────────────────────────────

export async function deleteMemory(
  userId: string,
  memoryId: string
): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("memories")
    .delete()
    .eq("id", memoryId)
    .eq("user_id", userId);

  if (error) throw new Error(`Failed to delete memory: ${error.message}`);
}

export async function deleteAllMemories(userId: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("memories")
    .delete()
    .eq("user_id", userId);

  if (error) throw new Error(`Failed to delete all memories: ${error.message}`);
}

export async function deleteMemoriesByType(
  userId: string,
  type: "pinned" | "semantic" | "profile"
): Promise<void> {
  const supabase = getSupabase();

  let query = supabase.from("memories").delete().eq("user_id", userId);

  if (type === "pinned") {
    query = query.eq("is_pinned", true);
  } else if (type === "semantic") {
    query = query.eq("is_pinned", false);
  } else if (type === "profile") {
    query = query.eq("type", "preference");
  }

  const { error } = await query;
  if (error) throw new Error(`Failed to delete memories (${type}): ${error.message}`);
}

// ─── Decay / Maintenance ──────────────────────────────────────────────────────

/**
 * Archive (delete) stale non-critical memories.
 * Called by a weekly cron job.
 */
export async function decayStaleMemories(userId?: string): Promise<number> {
  const supabase = getSupabase();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - config.memory.decayDays);

  let query = supabase
    .from("memories")
    .delete()
    .neq("importance", "critical")
    .eq("is_pinned", false)
    .eq("access_count", 0)
    .lt("accessed_at", cutoff.toISOString());

  if (userId) query = query.eq("user_id", userId);

  const { error, count } = await query;
  if (error) throw new Error(`Decay job failed: ${error.message}`);
  return count ?? 0;
}

// ─── Internal Helpers ─────────────────────────────────────────────────────────

async function touchMemoryAccess(ids: string[]): Promise<void> {
  const supabase = getSupabase();
  // Increment access_count and update accessed_at for all matched IDs
  await supabase.rpc("touch_memory_access", { p_ids: ids });
}

/**
 * Naive preference extractor from free-text content.
 * Tillu-Think should ideally send structured preferences,
 * but this provides a fallback for common patterns.
 */
function extractProfileFromContent(content: string): Partial<UserProfile> {
  const profile: Partial<UserProfile> = {};
  const lower = content.toLowerCase();

  // Language preference
  if (lower.includes("hindi") || lower.includes("हिंदी")) {
    profile.language_preference = "hi";
  } else if (lower.includes("tamil") || lower.includes("தமிழ்")) {
    profile.language_preference = "ta";
  } else if (lower.includes("english")) {
    profile.language_preference = "en";
  }

  // Communication style
  if (lower.includes("brief") || lower.includes("short") || lower.includes("concise")) {
    profile.communication_style = "brief";
  } else if (lower.includes("detailed") || lower.includes("elaborate")) {
    profile.communication_style = "detailed";
  }

  // Expertise
  if (lower.includes("beginner") || lower.includes("newbie")) {
    profile.expertise_level = "beginner";
  } else if (lower.includes("expert") || lower.includes("senior")) {
    profile.expertise_level = "expert";
  } else if (lower.includes("intermediate")) {
    profile.expertise_level = "intermediate";
  }

  return profile;
}

