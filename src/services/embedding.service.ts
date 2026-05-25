/**
 * Embedding Service
 *
 * Uses Hugging Face Inference API — free tier, no credit card needed.
 * Model: sentence-transformers/all-MiniLM-L6-v2
 *   - 384 dimensions
 *   - Multilingual-capable (handles Hindi, Tamil, English)
 *   - Fast, lightweight, widely used
 *
 * Get a free token at: https://huggingface.co/settings/tokens
 * Set env var: HUGGINGFACE_API_KEY
 *
 * NOTE: The embedding model is LOCKED. Never change it without
 * re-embedding all stored memories in Supabase.
 */

import { config } from "../config";
import type { EmbeddingResult } from "../types";

const HF_MODEL = "sentence-transformers/all-MiniLM-L6-v2";
const HF_URL   = `https://api-inference.huggingface.co/pipeline/feature-extraction/${HF_MODEL}`;

/**
 * Embed a single text string → 384-dim vector.
 */
export async function embedText(text: string): Promise<EmbeddingResult> {
  const embeddings = await embedBatch([text]);
  return {
    embedding:    embeddings[0],
    model:        HF_MODEL,
    tokens_used:  0, // HF doesn't report token usage
  };
}

/**
 * Embed multiple texts in one API call (more efficient).
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  const response = await fetch(HF_URL, {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${config.huggingface.apiKey}`,
    },
    body: JSON.stringify({
      inputs:  texts,
      options: { wait_for_model: true }, // don't fail on cold start
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`HuggingFace embedding error: ${response.status} — ${err}`);
  }

  const data = await response.json() as number[][];

  // HF returns either number[][] (batch) or number[] (single) — normalise
  if (Array.isArray(data[0])) {
    return data as number[][];
  }
  return [data as unknown as number[]];
}
