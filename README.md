# 🧠 Tillu-Memory

> **The hippocampus of Tillu AI.** Upstash holds the now. Supabase holds the forever. pgvector connects the dots.

---

## Architecture

| Layer | Technology | What Lives Here |
|---|---|---|
| ⚡ Working Memory | Upstash Redis | Current conversation buffer. TTL: 30 min. Auto-expires. |
| 📌 Pinned Memory | Supabase Postgres | Critical facts. Always injected into context. Max 50/user. |
| 🧬 Semantic Memory | Supabase pgvector | Embedded memories. Similarity search. Conceptual recall. |
| 📊 Profile Memory | Supabase Postgres | User preferences, language, style, expertise. |
| 🗂️ Session Summaries | Supabase Postgres | Compressed session history. "What did we talk about last week?" |

---

## Setup

### 1. Install  dependencies
```bash
npm install
```

### 2. Configure  environment
```bash
cp .env.example .env
# Fill in your Supabase, Upstash, and Groq credentials
```

### 3. Set up Supabase database
Run these SQL files in your  **Supabase SQL Editor** in order:
1. `supabase/schema.sql` — tables, indexes, RLS
2. `supabase/functions.sql` — stored procedures for pgvector search

### 4. Start the server
```bash
# Development (hot reload)
npm run dev

# Production
npm run build && npm start
```

---

## API Reference

### `POST /memory/unified` — The Magic Endpoint
Tillu-Think's primary interface. One request, full context back.

```json
{
  "user_id": "user_123",
  "session_id": "sess_456",
  "action": "auto",
  "message": "Can you remind me what we decided about the API?",
  "role": "user"
}
```

**Response:**
```json
{
  "working_memory": [...],
  "pinned_facts": ["User prefers Hindi", "User is a developer"],
  "relevant_past": [{ "content": "...", "similarity_score": 0.87, ... }],
  "profile": { "language_preference": "hi", "communication_style": "brief" },
  "actions_taken": ["write_to_working", "read_pinned", "semantic_search"]
}
```

---

### `POST /memory/write` — Store a Memory
```json
{
  "user_id": "user_123",
  "content": "User's deployment platform is Vercel",
  "type": "fact",
  "importance": "high",
  "session_id": "sess_456"
}
```

---

### `GET /memory/read` — Read Context Bundle
```
GET /memory/read?user_id=user_123&session_id=sess_456&query=API+design
```

---

### `POST /memory/search` — Semantic Search
```json
{
  "user_id": "user_123",
  "query": "What did we say about database choices?",
  "top_k": 5,
  "time_filter": "last_30_days"
}
```

---

### `POST /memory/consolidate` — Compress Session → Long-term
```json
{
  "user_id": "user_123",
  "session_id": "sess_456"
}
```

---

### `DELETE /memory/forget` — GDPR Delete
```json
{ "user_id": "user_123", "type": "all" }
// or
{ "user_id": "user_123", "memory_id": "mem_789" }
```

---

### `PATCH /memory/pin` — Pin/Unpin a Memory
```json
{
  "user_id": "user_123",
  "memory_id": "mem_789",
  "pinned": true
}
```

---

## Rate Limits

| Endpoint | Limit |
|---|---|
| Write operations | 30/min per user |
| Read operations | 120/min per user |
| Consolidate | 1 per 10 min per user |
| Max pinned memories | 50 per user |
| Max working messages | 50 per session |

---

## Integration Map

| Service | Calls | Why |
|---|---|---|
| Tillu-Think | `POST /memory/unified` | Full context before reasoning |
| Tillu-Think | `POST /memory/write` | Save extracted facts mid-conversation |
| Tillu-Voice | `GET /memory/read` | Language preference before speaking |
| Tillu-Search | `POST /memory/search` | "Has user searched this before?" |
| Tillu-MAX | `POST /memory/consolidate` | End session gracefully |
| Cron Job | `POST /memory/consolidate` | Clean up expired sessions |
| User Dashboard | `GET /memory/read`, `DELETE /memory/forget` | User views/manages data |

---

## Embedding Model

**Locked to:** `text-embedding-3-small` (1536 dimensions) via Groq

> ⚠️ Never change the embedding model without re-embedding all stored memories. The model is set in `.env` and must stay consistent.
