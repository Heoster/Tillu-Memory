-- ─────────────────────────────────────────────────────────────────────────────
-- Tillu-Memory: Complete Supabase Schema
-- Safe to re-run — all statements are idempotent.
-- Run this first, then run functions.sql.
-- ─────────────────────────────────────────────────────────────────────────────

-- Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- ─── users ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  user_id      TEXT PRIMARY KEY,
  profile_data JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_active  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  users              IS 'One row per Tillu user. Stores profile and preferences.';
COMMENT ON COLUMN users.profile_data IS 'JSONB: name, language_preference, communication_style, interests[], expertise_level, etc.';

-- ─── memories ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS memories (
  id                TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id           TEXT        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  content           TEXT        NOT NULL,
  embedding         vector(384),
  type              TEXT        NOT NULL CHECK (type IN ('fact', 'event', 'preference', 'summary')),
  importance        TEXT        NOT NULL CHECK (importance IN ('critical', 'high', 'normal', 'low')),
  is_pinned         BOOLEAN     NOT NULL DEFAULT FALSE,
  topic_tags        TEXT[]      NOT NULL DEFAULT '{}',
  source_session_id TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accessed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  access_count      INTEGER     NOT NULL DEFAULT 0
);

-- If the table already existed with vector(1536), migrate the column type
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'memories'
      AND column_name = 'embedding'
      AND udt_name = 'vector'
  ) THEN
    -- Check current dimensions via pg_attribute / atttypmod
    -- atttypmod for vector(N) = N + 4 (internal encoding)
    IF (
      SELECT atttypmod FROM pg_attribute
      WHERE attrelid = 'memories'::regclass
        AND attname = 'embedding'
    ) <> 388 THEN  -- 384 + 4 = 388
      ALTER TABLE memories ALTER COLUMN embedding TYPE vector(384);
    END IF;
  END IF;
END $$;

COMMENT ON TABLE  memories           IS 'All stored memories: facts, events, preferences, summaries.';
COMMENT ON COLUMN memories.embedding IS 'vector(384) — HuggingFace all-MiniLM-L6-v2. NEVER change model without re-embedding.';
COMMENT ON COLUMN memories.is_pinned IS 'Pinned memories are always injected into context. Max 50 per user.';

-- ─── sessions ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
  session_id       TEXT        PRIMARY KEY,
  user_id          TEXT        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  summary          TEXT,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at         TIMESTAMPTZ,
  message_count    INTEGER     NOT NULL DEFAULT 0,
  topics_discussed TEXT[]      NOT NULL DEFAULT '{}'
);

COMMENT ON TABLE  sessions        IS 'One row per conversation session. Summary generated on consolidation.';
COMMENT ON COLUMN sessions.summary IS '2-3 sentence Groq-generated summary of the session.';

-- ─── Indexes ─────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_memories_user_id
  ON memories (user_id);

CREATE INDEX IF NOT EXISTS idx_memories_pinned
  ON memories (user_id, created_at DESC)
  WHERE is_pinned = TRUE;

CREATE INDEX IF NOT EXISTS idx_memories_importance
  ON memories (user_id, importance);

-- Drop and recreate HNSW index if dimensions changed
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'idx_memories_embedding'
  ) THEN
    DROP INDEX idx_memories_embedding;
  END IF;
END $$;

CREATE INDEX idx_memories_embedding
  ON memories USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS idx_sessions_user_ended
  ON sessions (user_id, ended_at DESC NULLS FIRST);

-- ─── Row Level Security ───────────────────────────────────────────────────────
ALTER TABLE users    ENABLE ROW LEVEL SECURITY;
ALTER TABLE memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

-- Drop policies first so re-runs don't error
DO $$
BEGIN
  DROP POLICY IF EXISTS "service_full_access_users"    ON users;
  DROP POLICY IF EXISTS "service_full_access_memories" ON memories;
  DROP POLICY IF EXISTS "service_full_access_sessions" ON sessions;
END $$;

CREATE POLICY "service_full_access_users"    ON users    FOR ALL TO service_role USING (TRUE);
CREATE POLICY "service_full_access_memories" ON memories FOR ALL TO service_role USING (TRUE);
CREATE POLICY "service_full_access_sessions" ON sessions FOR ALL TO service_role USING (TRUE);
