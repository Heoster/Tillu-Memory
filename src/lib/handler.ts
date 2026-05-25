import type { VercelRequest, VercelResponse } from "@vercel/node";

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

// VercelResponse methods like res.json() return VercelResponse, not void.
// Using this union lets handlers return either.
type HandlerFn = (
  req: VercelRequest,
  res: VercelResponse
) => Promise<void | VercelResponse>;

/**
 * Wraps a Vercel handler with:
 * - Method enforcement
 * - CORS headers
 * - Consistent error responses
 */
export function createHandler(method: HttpMethod, fn: HandlerFn) {
  return async (req: VercelRequest, res: VercelResponse) => {
    // CORS — adjust origin in production
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      return res.status(204).end();
    }

    if (req.method !== method) {
      return res.status(405).json({ error: `Method ${req.method} not allowed. Use ${method}.` });
    }

    try {
      await fn(req, res);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error(`[Tillu-Memory] ${req.url}:`, message);
      return res.status(500).json({ error: "Internal server error", detail: message });
    }
  };
}
