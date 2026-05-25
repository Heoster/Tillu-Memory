/**
 * Tillu-Memory — Supabase Migration Script
 *
 * Run once to set up all tables, indexes, and RLS policies.
 * Usage: npx tsx src/db/migrate.ts
 */

import { getSupabase } from "./supabase";

const MIGRATION_SQL = `
-- ─── Enable pgvector extension ───────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS vector;

-- ─── users table ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  user_id     TEXT PRIMARY KEY,
  profile_data JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_active TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── memories table ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS memories (
  id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id           TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  content           TEXT NOT NULL,
  embedding         vector(1536),
  type              TEXT NOT NULL CHECK (type IN ('fact', 'event', 'preference', 'summary')),
  importance        TEXT NOT NULL CHECK (importance IN ('critical', 'high', 'normal', 'low')),
  is_pinned         BOOLEAN NOT NULL DEFAULT FALSE,
  topic_tags        TEXT[] NOT NULL DEFAULT '{}',
  source_session_id TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accessed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  access_count      INTEGER NOT NULL DEFAULT 0
);

-- ─── sessions table ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
  session_id       TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  summary          TEXT,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at         TIMESTAMPTZ,
  message_count    INTEGER NOT NULL DEFAULT 0,
  topics_discussed TEXT[] NOT NULL DEFAULT '{}'
);

-- ─── Indexes ──────────────────────────────────────────────────────────────────

-- Fast user-scoped memory lookups
CREATE INDEX IF NOT EXISTS idx_memories_user_id
  ON memories (user_id);

-- Fast pinned memory fetch per user
CREATE INDEX IF NOT EXISTS idx_memories_pinned
  ON memories (user_id, is_pinned)
  WHERE is_pinned = TRUE;

-- Fast importance filter
CREATE INDEX IF NOT EXISTS idx_memories_importance
  ON memories (user_id, importance);

-- pgvector HNSW index for fast ANN search
-- HNSW is preferred over IVFFlat for Supabase (no training needed)
CREATE INDEX IF NOT EXISTS idx_memories_embedding
  ON memories USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Session lookups by user, most recent first
CREATE INDEX IF NOT EXISTS idx_sessions_user_ended
  ON sessions (user_id, ended_at DESC NULLS FIRST);

-- ─── Row Level Security ───────────────────────────────────────────────────────
-- Service role key bypasses RLS. These policies protect direct client access.

ALTER TABLE users    ENABLE ROW LEVEL SECURITY;
ALTER TABLE memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (already implicit, but explicit is safer)
CREATE POLICY IF NOT EXISTS "service_role_users"    ON users    FOR ALL USING (TRUE);
CREATE POLICY IF NOT EXISTS "service_role_memories" ON memories FOR ALL USING (TRUE);
CREATE POLICY IF NOT EXISTS "service_role_sessions" ON sessions FOR ALL USING (TRUE);
`;

async function migrate() {
  console.log("🧠 Tillu-Memory: Running migrations...");
  const supabase = getSupabase();

  const { error } = await supabase.rpc("exec_sql", { sql: MIGRATION_SQL }).single();

  if (error) {
    // Supabase doesn't expose raw SQL exec via client SDK directly.
    // Print the SQL so it can be run in the Supabase SQL editor.
    console.warn(
      "⚠️  Direct SQL execution via client SDK is not supported.\n" +
      "Please run the following SQL in your Supabase SQL Editor:\n\n" +
      "─".repeat(60) + "\n" +
      MIGRATION_SQL +
      "\n" + "─".repeat(60)
    );
    process.exit(0);
  }

  console.log("✅ Migration complete.");
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});

export { MIGRATION_SQL };

