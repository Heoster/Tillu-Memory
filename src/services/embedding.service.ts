import Groq from "groq-sdk";
import { config } from "../config";
import type { EmbeddingResult } from "../types";

let _groq: Groq | null = null;

function getGroq(): Groq {
  if (!_groq) {
    _groq = new Groq({ apiKey: config.groq.apiKey });
  }
  return _groq;
}

/**
 * Embed a single text string into a vector.
 *
 * IMPORTANT: The embedding model is locked in config.
 * Never change it without re-embedding all stored memories.
 */
export async function embedText(text: string): Promise<EmbeddingResult> {
  const groq = getGroq();

  // Groq embedding API (uses OpenAI-compatible endpoint)
  // Falls back to a direct fetch if the SDK doesn't expose embeddings yet
  try {
    // @ts-expect-error — Groq SDK may not have typed embeddings yet
    const response = await groq.embeddings.create({
      model: config.memory.embeddingModel,
      input: text,
    });

    const embedding = response.data[0].embedding as number[];
    return {
      embedding,
      model: config.memory.embeddingModel,
      tokens_used: response.usage?.total_tokens ?? 0,
    };
  } catch {
    // Fallback: direct REST call to Groq embeddings endpoint
    return embedTextFallback(text);
  }
}

/**
 * Batch embed multiple texts in one API call (more efficient).
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  const groq = getGroq();

  try {
    // @ts-expect-error — Groq SDK may not have typed embeddings yet
    const response = await groq.embeddings.create({
      model: config.memory.embeddingModel,
      input: texts,
    });

    return (response.data as Array<{ embedding: number[] }>).map((d) => d.embedding);
  } catch {
    // Sequential fallback
    const results: number[][] = [];
    for (const text of texts) {
      const r = await embedTextFallback(text);
      results.push(r.embedding);
    }
    return results;
  }
}

/**
 * Direct REST fallback for Groq embeddings.
 */
async function embedTextFallback(text: string): Promise<EmbeddingResult> {
  const response = await fetch("https://api.groq.com/openai/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.groq.apiKey}`,
    },
    body: JSON.stringify({
      model: config.memory.embeddingModel,
      input: text,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Groq embedding API error: ${response.status} — ${err}`);
  }

  const data = (await response.json()) as {
    data: Array<{ embedding: number[] }>;
    usage: { total_tokens: number };
  };

  return {
    embedding: data.data[0].embedding,
    model: config.memory.embeddingModel,
    tokens_used: data.usage?.total_tokens ?? 0,
  };
}

