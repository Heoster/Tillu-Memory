// ─── Enums ────────────────────────────────────────────────────────────────────

export type MemoryType =
  | "fact"
  | "event"
  | "preference"
  | "summary"
  | "birthday"       // birthday of a person Heoster knows
  | "relationship"   // who someone is to Heoster
  | "action_log"     // what Tillu did (for self-evolution)
  | "skill_feedback" // how a skill performed
  | "briefing"       // prepared morning briefing from Dream Loop
  | "tracked_topic"; // topics to monitor in Dream Loop

export type ImportanceLevel = "critical" | "high" | "normal" | "low";
export type MessageRole = "user" | "assistant" | "system";

// ─── Redis Structures ─────────────────────────────────────────────────────────

export interface WorkingMessage {
  role: MessageRole;
  content: string;
  timestamp: string; // ISO string
}

export interface UserState {
  session_id: string;
  last_active: string; // ISO string
}

// ─── Supabase Row Types ───────────────────────────────────────────────────────

export interface UserRow {
  user_id: string;
  profile_data: UserProfile;
  created_at: string;
  last_active: string;
}

export interface UserProfile {
  name?: string;
  language_preference?: string;   // e.g. "hi", "ta", "en"
  communication_style?: "brief" | "detailed";
  interests?: string[];
  expertise_level?: "beginner" | "intermediate" | "expert";
  location?: string;
  occupation?: string;
  allergies?: string[];

  // Heoster identity
  nickname?: string;              // "Heoster"
  school?: string;                // "Maples Academy, Khatauli"
  class?: string;                 // "12"
  timezone?: string;              // "Asia/Kolkata"

  // Dream Loop state
  dream_loop?: {
    last_consolidated?: string;              // ISO timestamp
    last_briefing_prepared?: string;         // ISO timestamp
    last_world_monitor?: string;             // ISO timestamp
    morning_briefing_delivered_today?: boolean;
  };

  // Learned preferences
  tracked_topics?: string[];      // ["cricket", "AI", "board exams"]
  response_preferences?: {
    prefers_hindi_english_mix?: boolean;
    prefers_brief?: boolean;
    prefers_voice?: boolean;
  };

  [key: string]: unknown;         // extensible for future fields
}

export interface MemoryRow {
  id: string;
  user_id: string;
  content: string;
  embedding?: number[];           // vector(1536) — omitted on reads unless needed
  type: MemoryType;
  importance: ImportanceLevel;
  is_pinned: boolean;
  topic_tags: string[];
  source_session_id?: string;
  created_at: string;
  accessed_at: string;
  access_count: number;
}

export interface SessionRow {
  session_id: string;
  user_id: string;
  summary?: string;
  started_at: string;
  ended_at?: string;
  message_count: number;
  topics_discussed: string[];
}

// ─── API Request / Response Types ────────────────────────────────────────────

// POST /memory/unified
export interface UnifiedRequest {
  user_id: string;
  session_id: string;
  action?: "auto" | "read" | "write";
  message?: string;
  role?: MessageRole;
  importance?: ImportanceLevel;
}

export interface UnifiedResponse {
  working_memory: WorkingMessage[];
  pinned_facts: string[];
  relevant_past: RelevantMemory[];
  profile: UserProfile;
  actions_taken: string[];
}

// POST /memory/write
export interface WriteRequest {
  user_id: string;
  content: string;
  type: MemoryType;
  importance: ImportanceLevel;
  session_id?: string;
  topic_tags?: string[];
}

export interface WriteResponse {
  memory_id: string;
  is_pinned: boolean;
  profile_updated: boolean;
  message: string;
}

// GET /memory/read
export interface ReadResponse {
  working_memory: WorkingMessage[];
  pinned_facts: string[];
  profile: UserProfile;
  semantic_results: RelevantMemory[];
}

// POST /memory/search
export interface SearchRequest {
  user_id: string;
  query: string;
  top_k?: number;
  time_filter?: "last_7_days" | "last_30_days" | "last_90_days" | "all";
}

export interface RelevantMemory {
  id: string;
  content: string;
  created_at: string;
  importance: ImportanceLevel;
  type: MemoryType;
  similarity_score?: number;
  topic_tags: string[];
}

export interface SearchResponse {
  results: RelevantMemory[];
  query_used: string;
  total_found: number;
}

// POST /memory/consolidate
export interface ConsolidateRequest {
  user_id: string;
  session_id: string;
}

export interface ConsolidateResponse {
  summary: string;
  facts_extracted: number;
  preferences_extracted: number;
  session_id: string;
  message: string;
}

// DELETE /memory/forget
export interface ForgetRequest {
  user_id: string;
  memory_id?: string;
  type?: "all" | "working" | "semantic" | "pinned" | "profile";
}

export interface ForgetResponse {
  deleted: string[];
  message: string;
}

// PATCH /memory/pin
export interface PinRequest {
  user_id: string;
  memory_id: string;
  pinned: boolean;
}

export interface PinResponse {
  memory_id: string;
  is_pinned: boolean;
  message: string;
}

// ─── Internal Service Types ───────────────────────────────────────────────────

export interface ConsolidationResult {
  summary: string;
  facts: Array<{ content: string; importance: ImportanceLevel; tags: string[] }>;
  preferences: Partial<UserProfile>;
}

export interface EmbeddingResult {
  embedding: number[];
  model: string;
  tokens_used: number;
}


// ─── New Row Types ────────────────────────────────────────────────────────────

export interface BirthdayRow {
  id: string;
  user_id: string;
  person_name: string;
  relation?: string;
  birth_date: string;   // "YYYY-MM-DD"
  notes?: string;
  created_at: string;
}

export interface UpcomingBirthday extends BirthdayRow {
  days_until: number;
}

export interface ActionLogRow {
  id: string;
  user_id: string;
  action_id: string;
  action_type: string;
  params?: Record<string, unknown>;
  success: boolean;
  skill_name?: string;
  latency_ms?: number;
  timestamp: string;
  created_at: string;
}

export interface SkillFeedbackRow {
  id: string;
  user_id: string;
  skill_name: string;
  execution_id: string;
  success: boolean;
  steps_completed?: number;
  steps_total?: number;
  latency_ms?: number;
  heoster_continued: boolean;
  timestamp: string;
}

export interface BriefingRow {
  id: string;
  user_id: string;
  content: string;
  news_summary?: string;
  weather?: string;
  calendar_events?: string[];
  delivered: boolean;
  prepared_at: string;
  delivered_at?: string;
  expires_at: string;
}

// ─── New API Request / Response Types ────────────────────────────────────────

// GET /memory/context
export interface ContextRequest {
  user_id: string;
  session_id: string;
  message?: string;
}

export interface DreamState {
  last_consolidated?: string;
  last_briefing_prepared?: string;
  last_world_monitor?: string;
  morning_briefing_delivered_today?: boolean;
  briefing_ready: boolean;
}

export interface ContextResponse {
  working_memory: WorkingMessage[];
  pinned_facts: string[];
  relevant_past: RelevantMemory[];
  profile: UserProfile;
  dream_state: DreamState;
  upcoming_birthdays: UpcomingBirthday[];
  last_action: ActionLogRow | null;
  actions_taken: string[];
}

// POST /memory/briefing
export interface StoreBriefingRequest {
  user_id: string;
  content: string;
  news_summary?: string;
  weather?: string;
  calendar_events?: string[];
  prepared_at?: string;
}

// POST /memory/birthday
export interface StoreBirthdayRequest {
  user_id: string;
  person_name: string;
  relation?: string;
  birth_date: string;   // "YYYY-MM-DD"
  notes?: string;
}

// POST /memory/action-log
export interface StoreActionLogRequest {
  user_id: string;
  action_id: string;
  action_type: string;
  params?: Record<string, unknown>;
  success: boolean;
  skill_name?: string;
  latency_ms?: number;
  timestamp?: string;
}

// POST /memory/skill-feedback
export interface StoreSkillFeedbackRequest {
  user_id: string;
  skill_name: string;
  execution_id: string;
  success: boolean;
  steps_completed?: number;
  steps_total?: number;
  latency_ms?: number;
  heoster_continued?: boolean;
  timestamp?: string;
}

// PATCH /memory/dream-state
export interface UpdateDreamStateRequest {
  user_id: string;
  updates: Partial<NonNullable<UserProfile["dream_loop"]>>;
}
