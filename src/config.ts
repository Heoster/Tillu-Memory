// Vercel serverless functions read env vars natively — no dotenv needed in production.
// For local dev, `vercel dev` injects .env automatically.
// We only load dotenv when running outside Vercel (e.g. tsx src/db/migrate.ts).
if (process.env.VERCEL !== "1") {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require("dotenv").config();
}

function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

function optional(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

export const config = {
  supabase: {
    url: required("SUPABASE_URL"),
    serviceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
  },
  redis: {
    url: required("UPSTASH_REDIS_REST_URL"),
    token: required("UPSTASH_REDIS_REST_TOKEN"),
  },
  groq: {
    apiKey: required("GROQ_API_KEY"),
  },
  app: {
    port: parseInt(optional("PORT", "3001"), 10),
    nodeEnv: optional("NODE_ENV", "development"),
  },
  memory: {
    workingTTL: parseInt(optional("WORKING_MEMORY_TTL", "1800"), 10),
    stateTTL: parseInt(optional("STATE_TTL", "3600"), 10),
    maxPinned: parseInt(optional("MAX_PINNED_MEMORIES", "50"), 10),
    maxWorkingMessages: parseInt(optional("MAX_WORKING_MESSAGES", "50"), 10),
    maxSemanticResults: parseInt(optional("MAX_SEMANTIC_RESULTS", "10"), 10),
    decayDays: parseInt(optional("MEMORY_DECAY_DAYS", "90"), 10),
    embeddingModel: optional("EMBEDDING_MODEL", "text-embedding-3-small"),
    embeddingDimensions: parseInt(optional("EMBEDDING_DIMENSIONS", "1536"), 10),
  },
} as const;

