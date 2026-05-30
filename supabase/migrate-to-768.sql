-- ═══════════════════════════════════════════════════════════════════════════
-- Tillu-Memory: Migrate vector(384) → vector(768)
-- Switching embedding provider from HuggingFace to Jina AI
--
-- Run this in: https://supabase.com/dashboard/project/nslwbnunrpxbjkivoaay/sql/new
-- ═══════════════════════════════════════════════════════════════════════════

-- Step 1: Clear all existing 384-dim embeddings (they are now invalid)
UPDATE memories SET embedding = NULL WHERE embedding IS NOT NULL;

-- Step 2: Drop the old HNSW index (built for 384 dims)
DROP INDEX IF EXISTS idx_memories_embedding;

-- Step 3: Alter the column from vector(384) to vector(768)
ALTER TABLE memories ALTER COLUMN embedding TYPE vector(768);

-- Step 4: Rebuild the HNSW index for 768 dims
CREATE INDEX idx_memories_embedding
  ON memories USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Step 5: Recreate search_memories function with vector(768) signature
CREATE OR REPLACE FUNCTION search_memories(
  p_user_id       TEXT,
  p_embedding     vector(768),
  p_top_k         INT          DEFAULT 10,
  p_created_after TIMESTAMPTZ  DEFAULT NULL
)
RETURNS TABLE (
  id          TEXT,
  content     TEXT,
  created_at  TIMESTAMPTZ,
  importance  TEXT,
  type        TEXT,
  topic_tags  TEXT[],
  similarity  FLOAT
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
    -- Cosine similarity with time-decay boost (30-day half-life)
    (1 - (m.embedding <=> p_embedding)) *
      EXP(-EXTRACT(EPOCH FROM (NOW() - m.created_at)) / (30 * 86400.0)) AS similarity
  FROM memories m
  WHERE
    m.user_id       = p_user_id
    AND m.embedding IS NOT NULL
    AND m.is_pinned = FALSE
    AND (p_created_after IS NULL OR m.created_at >= p_created_after)
  ORDER BY similarity DESC
  LIMIT p_top_k;
END;
$$;

-- Verify
SELECT column_name, udt_name, character_maximum_length
FROM information_schema.columns
WHERE table_name = 'memories' AND column_name = 'embedding';
-- Expected: udt_name = 'vector'  (dimensions shown in atttypmod)

SELECT COUNT(*) as total_memories, COUNT(embedding) as with_embedding FROM memories;
-- Expected: with_embedding = 0 (all cleared, will be re-embedded on next write)
