import type { VercelRequest, VercelResponse } from "@vercel/node";
import { readFileSync } from "fs";
import { join } from "path";

export default function handler(_req: VercelRequest, res: VercelResponse) {
  const html = readFileSync(join(process.cwd(), "public", "docs.html"), "utf-8");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=60");
  res.status(200).send(html);
}
