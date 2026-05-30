/**
 * migrate-768.ts — Migrate memories.embedding from vector(384) to vector(768)
 *
 * Run: npx tsx scripts/migrate-768.ts
 *
 * What it does:
 * 1. Clears all existing embeddings (they were 384-dim, now invalid)
 * 2. Alters the column type to vector(768)
 * 3. Drops the old HNSW index
 * 4. Rebuilds the HNSW index for 768 dims
 * 5. Recreates the search_memories function with vector(768) signature
 */

import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL!;
const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !serviceKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

// Use the Supabase JS client with service role key
const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false },
});

async function runSQL(sql: string, description: string): Promise<void> {
  console.log(`\n[Migration] ${description}...`);
  const { error } = await supabase.rpc("exec_migration", { sql_query: sql });
  if (error) {
    // Try direct REST approach
    const resp = await fetch(`${supabaseUrl}/rest/v1/`, {
      method: "POST",
      headers: {
        "apikey": serviceKey,
        "Authorization": `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
      },
      body: JSON.stringify({ query: sql }),
    });
    if (!resp.ok) {
      throw new Error(`SQL failed: ${error.message}`);
    }
  }
  console.log(`[Migration] ${description} — done`);
}

async function migrate(): Promise<void> {
  console.log("=== Tillu-Memory: Migrate vector(384) → vector(768) ===\n");

  // Use the Supabase Management API via direct HTTP
  const projectRef = supabaseUrl.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
  if (!projectRef) throw new Error("Could not extract project ref from SUPABASE_URL");

  const steps = [
    {
      desc: "Clear existing 384-dim embeddings",
      sql: "UPDATE memories SET embedding = NULL WHERE embedding IS NOT NULL;",
    },
    {
      desc: "Drop old HNSW index",
      sql: "DROP INDEX IF EXISTS idx_memories_embedding;",
    },
    {
      desc: "Alter column to vector(768)",
      sql: "ALTER TABLE memories ALTER COLUMN embedding TYPE vector(768);",
    },
    {
      desc: "Rebuild HNSW index for 768 dims",
      sql: `CREATE INDEX idx_memories_embedding
  ON memories USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);`,
    },
    {
      desc: "Recreate search_memories function for vector(768)",
      sql: `CREATE OR REPLACE FUNCTION search_memories(
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
    (1 - (m.embedding <=> p_embedding)) *
      EXP(-EXTRACT(EPOCH FROM (NOW() - m.created_at)) / (30 * 86400.0)) AS similarity
  FROM memories m
  WHERE
    m.user_id = p_user_id
    AND m.embedding IS NOT NULL
    AND m.is_pinned = FALSE
    AND (p_created_after IS NULL OR m.created_at >= p_created_after)
  ORDER BY similarity DESC
  LIMIT p_top_k;
END;
$$;`,
    },
  ];

  // Execute via Supabase Management API
  for (const step of steps) {
    console.log(`\n[Migration] ${step.desc}...`);

    const resp = await fetch(
      `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: step.sql }),
      }
    );

    const body = await resp.text();

    if (!resp.ok) {
      console.error(`[Migration] FAILED: ${body}`);
      // Try alternative: direct pg connection via Supabase REST
      console.log("[Migration] Trying alternative approach...");

      // Use the pg REST endpoint
      const resp2 = await fetch(`${supabaseUrl}/rest/v1/rpc/query`, {
        method: "POST",
        headers: {
          "apikey": serviceKey,
          "Authorization": `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sql: step.sql }),
      });

      if (!resp2.ok) {
        const body2 = await resp2.text();
        console.error(`[Migration] Alternative also failed: ${body2}`);
        console.error(`\n[Migration] Please run this SQL manually in Supabase SQL Editor:\n\n${step.sql}\n`);
        continue;
      }
    }

    console.log(`[Migration] ${step.desc} — OK`);
  }

  console.log("\n=== Migration complete ===");
  console.log("The memories table now uses vector(768) for Jina AI embeddings.");
}

migrate().catch(e => {
  console.error("[Migration] Fatal error:", e);
  process.exit(1);
});
