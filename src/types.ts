// ─── Enums ────────────────────────────────────────────────────────────────────

export type MemoryType = "fact" | "event" | "preference" | "summary";
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

