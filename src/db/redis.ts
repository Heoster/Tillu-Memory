import { Redis } from "@upstash/redis";
import { config } from "../config";
import type { WorkingMessage, UserState } from "../types";

// Singleton Redis client
let _redis: Redis | null = null;

export function getRedis(): Redis {
  if (!_redis) {
    _redis = new Redis({
      url: config.redis.url,
      token: config.redis.token,
    });
  }
  return _redis;
}

// ─── Key Builders ─────────────────────────────────────────────────────────────

export const keys = {
  working: (userId: string, sessionId: string) =>
    `working:${userId}:${sessionId}`,
  state: (userId: string) => `state:${userId}`,
  lock: (userId: string) => `lock:${userId}`,
};

// ─── Working Memory Helpers ───────────────────────────────────────────────────

/**
 * Append a message to working memory and refresh TTL.
 * Trims to maxWorkingMessages to prevent unbounded growth.
 */
export async function appendWorkingMessage(
  userId: string,
  sessionId: string,
  message: WorkingMessage
): Promise<void> {
  const redis = getRedis();
  const key = keys.working(userId, sessionId);

  await redis.rpush(key, JSON.stringify(message));

  // Trim to max allowed messages (keep the most recent N)
  const max = config.memory.maxWorkingMessages;
  await redis.ltrim(key, -max, -1);

  // Refresh TTL on every write
  await redis.expire(key, config.memory.workingTTL);
}

/**
 * Retrieve all messages from working memory.
 */
export async function getWorkingMemory(
  userId: string,
  sessionId: string
): Promise<WorkingMessage[]> {
  const redis = getRedis();
  const key = keys.working(userId, sessionId);
  const raw = await redis.lrange(key, 0, -1);

  return raw.map((item: unknown) =>
    typeof item === "string" ? (JSON.parse(item) as WorkingMessage) : (item as WorkingMessage)
  );
}

/**
 * Delete working memory for a session.
 */
export async function clearWorkingMemory(
  userId: string,
  sessionId: string
): Promise<void> {
  const redis = getRedis();
  await redis.del(keys.working(userId, sessionId));
}

// ─── User State Helpers ───────────────────────────────────────────────────────

export async function setUserState(
  userId: string,
  state: UserState
): Promise<void> {
  const redis = getRedis();
  await redis.set(keys.state(userId), JSON.stringify(state), {
    ex: config.memory.stateTTL,
  });
}

export async function getUserState(userId: string): Promise<UserState | null> {
  const redis = getRedis();
  const raw = await redis.get<string>(keys.state(userId));
  if (!raw) return null;
  return typeof raw === "string" ? (JSON.parse(raw) as UserState) : (raw as UserState);
}

// ─── Consolidation Lock ───────────────────────────────────────────────────────

/**
 * Acquire a consolidation lock (NX = only set if not exists).
 * Returns true if lock was acquired, false if already locked.
 */
export async function acquireConsolidationLock(userId: string): Promise<boolean> {
  const redis = getRedis();
  const result = await redis.set(keys.lock(userId), "1", {
    ex: 60,   // 60-second lock
    nx: true, // only set if not exists
  });
  return result === "OK";
}

export async function releaseConsolidationLock(userId: string): Promise<void> {
  const redis = getRedis();
  await redis.del(keys.lock(userId));
}

