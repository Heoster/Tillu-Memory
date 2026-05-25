import type { VercelRequest, VercelResponse } from "@vercel/node";

export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.json({
    status: "ok",
    service: "tillu-memory",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
  });
}
