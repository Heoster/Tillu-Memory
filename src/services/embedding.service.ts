/**
 * Embedding Service — Jina AI
 *
 * Model: jina-embeddings-v2-base-en
 *   - 768 dimensions
 *   - Multilingual-capable (handles Hindi/English mix)
 *   - Reachable from Vercel serverless (unlike HuggingFace api-inference)
 *   - Free tier: 1M tokens/month
 *
 * NOTE: The embedding model is LOCKED at 768 dims.
 * Never change it without re-embedding all stored memories in Supabase.
 */

import { config } from "../config";
import type { EmbeddingResult } from "../types";

const JINA_MODEL = "jina-embeddings-v2-base-en";
const JINA_URL   = "https://api.jina.ai/v1/embeddings";
const DIMS       = 768;

/**
 * Embed a single text string → 768-dim vector.
 */
export async function embedText(text: string): Promise<EmbeddingResult> {
  const embeddings = await embedBatch([text]);
  return {
    embedding:   embeddings[0]!,
    model:       JINA_MODEL,
    tokens_used: 0,
  };
}

/**
 * Embed multiple texts in one API call (more efficient).
 * Jina accepts up to 2048 inputs per request.
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const response = await fetch(JINA_URL, {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${config.jina.apiKey}`,
    },
    body: JSON.stringify({
      model:  JINA_MODEL,
      input:  texts,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Jina embedding error: ${response.status} — ${err.slice(0, 200)}`);
  }

  const data = await response.json() as {
    data: Array<{ embedding: number[]; index: number }>;
  };

  // Sort by index to preserve input order
  const sorted = data.data.sort((a, b) => a.index - b.index);
  return sorted.map(d => d.embedding);
}

export { DIMS as EMBEDDING_DIMS, JINA_MODEL as EMBEDDING_MODEL };
