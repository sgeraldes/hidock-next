export type SessionStatus =
  | "active"
  | "inactive"
  | "interrupted"
  | "processing"
  | "complete";
export type RecordingStatus = "recording" | "stopped" | "interrupted";
export type ActionItemStatus = "open" | "done";
export type AttachmentType = "screenshot" | "note" | "file";

export interface Session {
  id: string;
  status: SessionStatus;
  started_at: string;
  ended_at: string | null;
  meeting_type_id: string | null;
  title: string | null;
  summary: string | null;
  audio_path: string | null;
  created_at: string;
}

export interface Recording {
  id: string;
  session_id: string;
  filename: string;
  file_path: string;
  duration_ms: number;
  sample_rate: number;
  created_at: string;
  status: RecordingStatus;
  last_chunk_index: number;
}

export interface TranscriptSegment {
  id: string;
  session_id: string;
  speaker_name: string | null;
  text: string;
  start_ms: number;
  end_ms: number;
  sentiment: string | null;
  confidence: number | null;
  language: string | null;
  chunk_index: number;
  created_at: string;
}

export interface Speaker {
  id: string;
  name: string;
  display_name: string | null;
  created_at: string;
}

export interface SessionSpeaker {
  session_id: string;
  speaker_id: string;
}

export interface Meeting {
  id: string;
  session_id: string;
  subject: string | null;
  attendees_json: string | null;
  notes: string | null;
  created_at: string;
}

export interface Attachment {
  id: string;
  session_id: string;
  type: AttachmentType;
  filename: string | null;
  file_path: string | null;
  mime_type: string | null;
  content_text: string | null;
  created_at: string;
}

export interface ActionItem {
  id: string;
  session_id: string;
  text: string;
  assignee: string | null;
  status: ActionItemStatus;
  created_at: string;
}

export interface TalkingPoint {
  id: string;
  session_id: string;
  topic: string;
  first_mentioned_ms: number;
  created_at: string;
}

export interface MeetingType {
  id: string;
  name: string;
  description: string | null;
  prompt_template: string | null;
  icon: string | null;
  is_default: number;
  created_at: string;
}

export interface Setting {
  key: string;
  value: string;
  encrypted: number;
}
