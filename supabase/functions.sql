-- ─────────────────────────────────────────────────────────────────────────────
-- Tillu-Memory: Supabase SQL Functions
-- Run these in the Supabase SQL Editor after running the migration.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── search_memories ─────────────────────────────────────────────────────────
-- Semantic similarity search using pgvector cosine distance.
-- Applies a time-decay boost so recent memories rank higher.
-- Called by: semanticSearch() in memory.service.ts

CREATE OR REPLACE FUNCTION search_memories(
  p_user_id      TEXT,
  p_embedding    vector(768),
  p_top_k        INT     DEFAULT 10,
  p_created_after TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
  id             TEXT,
  content        TEXT,
  created_at     TIMESTAMPTZ,
  importance     TEXT,
  type           TEXT,
  topic_tags     TEXT[],
  similarity     FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    m.id,
    m.content,
    m.created_at,
    m.importance,
    m.type,
    m.topic_tags,
    -- Cosine similarity (1 - distance) with time-decay boost
    -- Decay: multiply by e^(-days_old / 30) so 30-day-old memory = ~37% boost penalty
    (1 - (m.embedding <=> p_embedding)) *
      EXP(-EXTRACT(EPOCH FROM (NOW() - m.created_at)) / (30 * 86400.0)) AS similarity
  FROM memories m
  WHERE
    m.user_id = p_user_id
    AND m.embedding IS NOT NULL
    AND m.is_pinned = FALSE  -- pinned memories are always fetched separately
    AND (p_created_after IS NULL OR m.created_at >= p_created_after)
  ORDER BY similarity DESC
  LIMIT p_top_k;
END;
$$;


-- ─── touch_memory_access ─────────────────────────────────────────────────────
-- Increment access_count and update accessed_at for a list of memory IDs.
-- Called in background after reads to track memory usefulness.

CREATE OR REPLACE FUNCTION touch_memory_access(p_ids TEXT[])
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE memories
  SET
    access_count = access_count + 1,
    accessed_at  = NOW()
  WHERE id = ANY(p_ids);
END;
$$;


-- ─── decay_stale_memories ────────────────────────────────────────────────────
-- Archive (delete) non-critical memories not accessed in N days.
-- Called by a weekly cron job.

CREATE OR REPLACE FUNCTION decay_stale_memories(p_decay_days INT DEFAULT 90)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
  deleted_count INT;
BEGIN
  DELETE FROM memories
  WHERE
    importance != 'critical'
    AND is_pinned = FALSE
    AND access_count = 0
    AND accessed_at < NOW() - (p_decay_days || ' days')::INTERVAL;

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;


-- ─── get_user_memory_stats ───────────────────────────────────────────────────
-- Returns memory usage stats for a user (useful for dashboards).

CREATE OR REPLACE FUNCTION get_user_memory_stats(p_user_id TEXT)
RETURNS TABLE (
  total_memories    BIGINT,
  pinned_count      BIGINT,
  semantic_count    BIGINT,
  critical_count    BIGINT,
  oldest_memory     TIMESTAMPTZ,
  newest_memory     TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*)                                          AS total_memories,
    COUNT(*) FILTER (WHERE is_pinned = TRUE)          AS pinned_count,
    COUNT(*) FILTER (WHERE is_pinned = FALSE)         AS semantic_count,
    COUNT(*) FILTER (WHERE importance = 'critical')   AS critical_count,
    MIN(created_at)                                   AS oldest_memory,
    MAX(created_at)                                   AS newest_memory
  FROM memories
  WHERE user_id = p_user_id;
END;
$$;

