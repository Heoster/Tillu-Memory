# 🧠 Tillu-Memory — Service Plan v7.0
# Status: ✅ Deployed | Needs Updates for TILLU v7.0

> The hippocampus of TILLU. Knows Heoster deeply — his profile, relationships, birthdays, habits, dream loop state, skill performance, and every conversation. The only stateful service in the system.

---

## Hosting

| Property | Value |
|---|---|
| **Platform** | Vercel (serverless) |
| **Status** | ✅ Deployed — needs schema + endpoint updates |
| **Base URL** | `https://tillu-memory.vercel.app` |
| **Cost** | Free |

---

## What Needs to Change (v7.0 Updates)

### 1. New Memory Types
```typescript
export type MemoryType =
  | "fact"           // existing
  | "event"          // existing
  | "preference"     // existing
  | "summary"        // existing
  | "birthday"       // NEW: birthday of a person Heoster knows
  | "relationship"   // NEW: who someone is to Heoster
  | "action_log"     // NEW: what Tillu did (for self-evolution)
  | "skill_feedback" // NEW: how a skill performed
  | "briefing"       // NEW: prepared morning briefing from Dream Loop
  | "tracked_topic"; // NEW: topics to monitor in Dream Loop
```

### 2. Extended UserProfile (Heoster-specific)
```typescript
export interface UserProfile {
  // existing
  name?: string;
  language_preference?: string;
  communication_style?: "brief" | "detailed";
  interests?: string[];
  expertise_level?: string;

  // NEW — Heoster identity
  nickname?: string;           // "Heoster"
  school?: string;             // "Maples Academy, Khatauli"
  class?: string;              // "12"
  location?: string;           // "Rampur Khatauli, Muzaffarnagar, UP, India"
  timezone?: string;           // "Asia/Kolkata"

  // NEW — Dream Loop state
  dream_loop?: {
    last_consolidated?: string;              // ISO timestamp
    last_briefing_prepared?: string;         // ISO timestamp
    last_world_monitor?: string;             // ISO timestamp
    morning_briefing_delivered_today?: boolean;
  };

  // NEW — learned preferences
  tracked_topics?: string[];   // ["cricket", "AI", "board exams"]
  response_preferences?: {
    prefers_hindi_english_mix?: boolean;
    prefers_brief?: boolean;
    prefers_voice?: boolean;
  };
}
```

### 3. Working Memory TTL
Change from 30 minutes to **8 hours** (configurable via env).
Heoster goes to school for 6+ hours — his morning context should survive until he returns.

### 4. New Endpoints (see below)

---

## Memory Layers

| Layer | Technology | What Lives Here | TTL |
|---|---|---|---|
| ⚡ Working Memory | Upstash Redis | Current conversation buffer | **8 hours** (was 30 min) |
| 📌 Pinned Memory | Supabase Postgres | Critical always-injected facts | Forever |
| 🧬 Semantic Memory | Supabase pgvector | Embedded memories, similarity search | Forever |
| 👤 Profile Memory | Supabase Postgres | Heoster's full profile + dream state | Forever |
| 🗂️ Session Summaries | Supabase Postgres | Compressed past sessions | Forever |
| 🎂 Birthdays | Supabase Postgres | Birthdays of people Heoster knows | Forever |
| 📋 Action Log | Supabase Postgres | What Tillu did + outcome | 90 days |
| 🎯 Skill Feedback | Supabase Postgres | Skill performance records | Forever |
| 📰 Briefings | Supabase Postgres | Prepared morning briefings | 7 days |

---

## API Routes (Full — Updated)

### Existing (unchanged)
| Method | Route | Purpose |
|---|---|---|
| `POST` | `/memory/unified` | Context bundle (kept for compatibility) |
| `POST` | `/memory/write` | Store a memory |
| `GET` | `/memory/read` | Read context bundle |
| `POST` | `/memory/search` | Semantic similarity search |
| `POST` | `/memory/consolidate` | Compress session → long-term |
| `DELETE` | `/memory/forget` | Delete memories |
| `PATCH` | `/memory/pin` | Pin/unpin a memory |

### New Endpoints
| Method | Route | Purpose |
|---|---|---|
| `GET` | `/memory/context` | **New primary.** Everything Core needs before a decision. |
| `POST` | `/memory/briefing` | Store prepared morning briefing (Dream Loop) |
| `GET` | `/memory/briefing` | Retrieve latest prepared briefing |
| `POST` | `/memory/birthday` | Store a birthday |
| `GET` | `/memory/birthdays` | Get birthdays in next N days |
| `POST` | `/memory/action-log` | Log a completed Tillu action |
| `POST` | `/memory/skill-feedback` | Record skill performance |
| `GET` | `/memory/dream-state` | Get Dream Loop state |
| `PATCH` | `/memory/dream-state` | Update Dream Loop state |

---

## `/memory/context` — New Primary Endpoint

Replaces `unified` as what Core calls before every decision. Returns everything in one call.

Request:
```json
{
  "user_id": "heoster",
  "session_id": "sess_001",
  "message": "What's the news today?"
}
```

Response:
```json
{
  "working_memory": [...],
  "pinned_facts": ["Heoster is in Class 12", "Prefers Hindi/English mix"],
  "relevant_past": [{ "content": "...", "similarity_score": 0.87 }],
  "profile": {
    "nickname": "Heoster",
    "school": "Maples Academy, Khatauli",
    "class": "12",
    "location": "Rampur Khatauli, Muzaffarnagar, UP, India",
    "timezone": "Asia/Kolkata",
    "language_preference": "hi",
    "tracked_topics": ["cricket", "AI", "board exams"]
  },
  "dream_state": {
    "last_consolidated": "2025-05-25T23:00:00+05:30",
    "briefing_ready": true,
    "morning_briefing_delivered": false
  },
  "upcoming_birthdays": [
    { "name": "Aryan", "relation": "friend", "days_until": 2, "date": "2025-05-28" }
  ],
  "last_action": {
    "action": "open_app", "app": "chrome",
    "timestamp": "2025-05-26T10:15:00+05:30", "success": true
  },
  "actions_taken": ["read_working", "read_pinned", "semantic_search", "read_birthdays"]
}
```

---

## `/memory/briefing` — Dream Loop Briefing

### POST (store prepared briefing)
```json
{
  "user_id": "heoster",
  "content": "Good morning Heoster! Here's what happened overnight...",
  "news_summary": "...",
  "weather": "Muzaffarnagar: 38°C, sunny",
  "calendar_events": ["Physics class at 10 AM"],
  "prepared_at": "2025-05-26T05:30:00+05:30"
}
```

### GET (retrieve latest)
```
GET /memory/briefing?user_id=heoster
```
Returns the most recent undelivered briefing, or null if already delivered today.

---

## `/memory/birthday` — Birthday Storage

### POST (store)
```json
{
  "user_id": "heoster",
  "person_name": "Aryan",
  "relation": "friend",
  "birth_date": "2000-05-28",
  "notes": "Best friend from school"
}
```

### GET (upcoming)
```
GET /memory/birthdays?user_id=heoster&days=7
```
Returns all birthdays in the next 7 days with `days_until` calculated.

---

## `/memory/action-log` — Action History

```json
{
  "user_id": "heoster",
  "action_id": "act_001",
  "action_type": "open_app",
  "params": { "app": "chrome" },
  "success": true,
  "skill_name": "world_news",
  "latency_ms": 312,
  "timestamp": "2025-05-26T10:15:00+05:30"
}
```

Used by Self-Evolution Engine to review what worked.

---

## `/memory/skill-feedback` — Skill Performance

```json
{
  "user_id": "heoster",
  "skill_name": "world_news",
  "execution_id": "exec_001",
  "success": true,
  "steps_completed": 4,
  "steps_total": 4,
  "latency_ms": 3200,
  "heoster_continued": true,
  "timestamp": "2025-05-26T10:15:00+05:30"
}
```

`heoster_continued: true` means Heoster engaged positively after the skill ran — implicit positive feedback.

---

## `/memory/dream-state` — Dream Loop State

### GET
```
GET /memory/dream-state?user_id=heoster
```
Returns current dream loop state from profile.

### PATCH (update)
```json
{
  "user_id": "heoster",
  "updates": {
    "last_consolidated": "2025-05-26T23:00:00+05:30",
    "last_briefing_prepared": "2025-05-27T05:30:00+05:30",
    "morning_briefing_delivered_today": false
  }
}
```

---

## Supabase Schema Updates Needed

```sql
-- New: birthdays table
CREATE TABLE birthdays (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       TEXT NOT NULL REFERENCES users(user_id),
  person_name   TEXT NOT NULL,
  relation      TEXT,
  birth_date    DATE NOT NULL,
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- New: action_log table
CREATE TABLE action_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       TEXT NOT NULL,
  action_id     TEXT NOT NULL,
  action_type   TEXT NOT NULL,
  params        JSONB,
  success       BOOLEAN NOT NULL,
  skill_name    TEXT,
  latency_ms    INTEGER,
  timestamp     TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- New: skill_feedback table
CREATE TABLE skill_feedback (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           TEXT NOT NULL,
  skill_name        TEXT NOT NULL,
  execution_id      TEXT NOT NULL,
  success           BOOLEAN NOT NULL,
  steps_completed   INTEGER,
  steps_total       INTEGER,
  latency_ms        INTEGER,
  heoster_continued BOOLEAN DEFAULT false,
  timestamp         TIMESTAMPTZ NOT NULL
);

-- New: briefings table
CREATE TABLE briefings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         TEXT NOT NULL,
  content         TEXT NOT NULL,
  news_summary    TEXT,
  weather         TEXT,
  calendar_events JSONB,
  delivered       BOOLEAN DEFAULT false,
  prepared_at     TIMESTAMPTZ NOT NULL,
  delivered_at    TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ  -- 7 days after prepared_at
);

-- Update: memories table — add new types
ALTER TABLE memories
  DROP CONSTRAINT IF EXISTS memories_type_check;
ALTER TABLE memories
  ADD CONSTRAINT memories_type_check
  CHECK (type IN ('fact','event','preference','summary',
                  'birthday','relationship','action_log',
                  'skill_feedback','briefing','tracked_topic'));

-- Update: users.profile_data — no schema change needed (JSONB is flexible)
-- Just start writing the new fields from the API
```

---

## Integration Map (Updated)

| Caller | Endpoint | When |
|---|---|---|
| Tillu-Core | `GET /memory/context` | Before every decision (replaces unified) |
| Tillu-Core | `POST /memory/write` | After every interaction |
| Tillu-Core | `POST /memory/consolidate` | Session end |
| Tillu-Core Dream Loop | `POST /memory/briefing` | Morning briefing prep |
| Tillu-Core Dream Loop | `PATCH /memory/dream-state` | After each dream cycle |
| Tillu-Core | `POST /memory/action-log` | After every action execution |
| Tillu-Core | `POST /memory/skill-feedback` | After every skill execution |
| Tillu-Core Wake-Up | `GET /memory/briefing` | When Heoster comes online |
| Tillu-Core Wake-Up | `GET /memory/birthdays?days=3` | For greeting |
| Heoster (via Core) | `POST /memory/birthday` | "Remember Aryan's birthday is May 28" |

---

## Files (Existing + New)

```
Tillu-memory/
├── api/memory/
│   ├── unified.ts         ← existing (keep for compatibility)
│   ├── write.ts           ← existing
│   ├── read.ts            ← existing
│   ├── search.ts          ← existing
│   ├── consolidate.ts     ← existing
│   ├── forget.ts          ← existing
│   ├── pin.ts             ← existing
│   ├── context.ts         ← NEW: primary endpoint for Core
│   ├── briefing.ts        ← NEW: dream loop briefing store/retrieve
│   ├── birthday.ts        ← NEW: birthday storage + upcoming query
│   ├── action-log.ts      ← NEW: action history
│   ├── skill-feedback.ts  ← NEW: skill performance records
│   └── dream-state.ts     ← NEW: dream loop state read/write
├── src/
│   ├── services/
│   │   ├── memory.service.ts       ← existing (add new types)
│   │   ├── embedding.service.ts    ← existing
│   │   ├── consolidation.service.ts← existing
│   │   ├── session.service.ts      ← existing
│   │   ├── user.service.ts         ← existing (extend profile)
│   │   ├── birthday.service.ts     ← NEW
│   │   ├── briefing.service.ts     ← NEW
│   │   ├── action-log.service.ts   ← NEW
│   │   └── skill-feedback.service.ts ← NEW
│   ├── types.ts                    ← update: new types + extended profile
│   └── db/
│       ├── supabase.ts
│       └── redis.ts                ← update: TTL from 30min to 8h
└── supabase/
    ├── schema.sql                  ← update: new tables
    └── functions.sql               ← existing pgvector functions
```
