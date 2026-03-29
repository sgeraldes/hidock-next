export type SessionStatus = "recording" | "processing" | "completed";
export type TranscriptSource = "mic" | "system";
export type SettingType = "string" | "number" | "boolean" | "json";

export interface Setting {
  key: string;
  value: string;
  type: SettingType;
  category: string;
}

export interface Session {
  id: string;
  title: string | null;
  started_at: number;
  ended_at: number | null;
  status: SessionStatus;
  meeting_id: string | null;
  audio_path: string | null;
  transcript_path: string | null;
}

export interface Meeting {
  id: string;
  title: string | null;
  start_time: number;
  end_time: number | null;
  attendees: string | null;
  location: string | null;
  agenda: string | null;
  calendar_source: string | null;
}

export interface TranscriptSegment {
  id: number;
  session_id: string;
  speaker: string | null;
  text: string;
  start_time: number;
  end_time: number;
  confidence: number | null;
  source: TranscriptSource;
}

export interface KnowledgeChunk {
  id: number;
  source_path: string;
  chunk_index: number;
  text: string;
  embedding: Uint8Array | null;
  updated_at: number;
}

export interface Screenshot {
  id: number;
  session_id: string;
  path: string;
  captured_at: number;
  analysis: string | null;
  is_manual: number;
}

export interface Note {
  id: string;
  session_id: string;
  template_id: string | null;
  content: string;
  created_at: number;
  updated_at: number;
}

export interface NoteTemplate {
  id: string;
  name: string;
  prompt: string;
  structure: string | null;
  is_default: number;
}
