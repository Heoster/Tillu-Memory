import Groq from "groq-sdk";
import { config } from "../config";
import {
  getWorkingMemory,
  clearWorkingMemory,
  acquireConsolidationLock,
  releaseConsolidationLock,
} from "../db/redis";
import { writeMemory } from "./memory.service";
import { updateUserProfile } from "./user.service";
import { finalizeSession, upsertSession } from "./session.service";
import type { ConsolidationResult, UserProfile, WorkingMessage } from "../types";

let _groq: Groq | null = null;
function getGroq(): Groq {
  if (!_groq) _groq = new Groq({ apiKey: config.groq.apiKey });
  return _groq;
}

/**
 * Consolidate a working memory session into long-term storage.
 *
 * Flow:
 * 1. Acquire lock (prevent duplicate processing)
 * 2. Pull messages from Redis
 * 3. Use Groq to extract: summary + facts + preferences
 * 4. Store in Supabase (sessions + memories)
 * 5. Update user profile
 * 6. Clear Redis
 */
export async function consolidateSession(
  userId: string,
  sessionId: string
): Promise<{ summary: string; factsExtracted: number; preferencesExtracted: number }> {
  // Acquire lock — prevent race conditions (e.g., cron + manual trigger)
  const locked = await acquireConsolidationLock(userId);
  if (!locked) {
    throw new Error("Consolidation already in progress for this user. Try again in 60s.");
  }

  try {
    const messages = await getWorkingMemory(userId, sessionId);

    if (messages.length === 0) {
      return { summary: "", factsExtracted: 0, preferencesExtracted: 0 };
    }

    // Ensure session exists in Supabase
    await upsertSession(sessionId, userId);

    // Ask Groq to analyze the conversation
    const result = await extractConsolidation(messages);

    // Store session summary
    const topics = extractTopics(result.summary);
    await finalizeSession(sessionId, result.summary, messages.length, topics);

    // Store extracted facts as memories (with embeddings)
    let factsStored = 0;
    for (const fact of result.facts) {
      await writeMemory({
        userId,
        content: fact.content,
        type: "fact",
        importance: fact.importance,
        sessionId,
        topicTags: fact.tags,
      });
      factsStored++;
    }

    // Update user profile with extracted preferences
    const prefKeys = Object.keys(result.preferences);
    if (prefKeys.length > 0) {
      await updateUserProfile(userId, result.preferences);

      // Also store preferences as memory entries for semantic recall
      for (const [key, value] of Object.entries(result.preferences)) {
        if (value !== undefined) {
          await writeMemory({
            userId,
            content: `User preference: ${key} = ${JSON.stringify(value)}`,
            type: "preference",
            importance: "high",
            sessionId,
          });
        }
      }
    }

    // Clear working memory from Redis
    await clearWorkingMemory(userId, sessionId);

    return {
      summary: result.summary,
      factsExtracted: factsStored,
      preferencesExtracted: prefKeys.length,
    };
  } finally {
    await releaseConsolidationLock(userId);
  }
}

// ─── Groq Extraction ──────────────────────────────────────────────────────────

async function extractConsolidation(
  messages: WorkingMessage[]
): Promise<ConsolidationResult> {
  const groq = getGroq();

  const conversationText = messages
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n");

  const systemPrompt = `You are a memory consolidation engine. Analyze the conversation and extract:
1. A 2-3 sentence summary of what was discussed
2. Key facts mentioned (user's name, location, job, allergies, decisions made, etc.)
3. User preferences (language, communication style, expertise level, interests)

Respond ONLY with valid JSON in this exact format:
{
  "summary": "2-3 sentence summary here",
  "facts": [
    { "content": "fact text", "importance": "critical|high|normal|low", "tags": ["tag1", "tag2"] }
  ],
  "preferences": {
    "language_preference": "hi|en|ta|...",
    "communication_style": "brief|detailed",
    "expertise_level": "beginner|intermediate|expert",
    "name": "...",
    "occupation": "...",
    "interests": ["..."]
  }
}

Only include preference fields that were explicitly mentioned. Omit fields with no evidence.
Mark facts as "critical" only if they are safety-critical (allergies, medical conditions) or identity facts (name).`;

  const response = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `Analyze this conversation:\n\n${conversationText}`,
      },
    ],
    temperature: 0.1, // low temp for consistent structured output
    max_tokens: 1024,
    response_format: { type: "json_object" },
  });

  const raw = response.choices[0]?.message?.content ?? "{}";

  try {
    const parsed = JSON.parse(raw) as {
      summary?: string;
      facts?: Array<{ content: string; importance: string; tags: string[] }>;
      preferences?: Partial<UserProfile>;
    };

    return {
      summary: parsed.summary ?? "Session completed.",
      facts: (parsed.facts ?? []).map((f) => ({
        content: f.content,
        importance: (["critical", "high", "normal", "low"].includes(f.importance)
          ? f.importance
          : "normal") as ConsolidationResult["facts"][0]["importance"],
        tags: f.tags ?? [],
      })),
      preferences: parsed.preferences ?? {},
    };
  } catch {
    // If JSON parsing fails, return a minimal result with just the raw text as summary
    return {
      summary: raw.slice(0, 500),
      facts: [],
      preferences: {},
    };
  }
}

function extractTopics(summary: string): string[] {
  // Simple keyword extraction — good enough for tagging
  const stopWords = new Set([
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "is", "was", "are", "were", "be", "been",
    "user", "asked", "discussed", "talked", "about", "we", "i",
  ]);

  return summary
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !stopWords.has(w))
    .slice(0, 5); // max 5 topic tags
}

