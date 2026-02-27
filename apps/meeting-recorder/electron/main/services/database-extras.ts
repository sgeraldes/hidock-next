import { v4 as uuidv4 } from "uuid";
import { safeStorage } from "electron";
import { getDatabase, mapRows } from "./database";
import type {
  Attachment,
  AttachmentType,
  ActionItem,
  TalkingPoint,
  MeetingType,
} from "./database.types";

const ATTACHMENT_COLS = [
  "id",
  "session_id",
  "type",
  "filename",
  "file_path",
  "mime_type",
  "content_text",
  "created_at",
];

export function createAttachment(params: {
  session_id: string;
  type: AttachmentType;
  filename?: string;
  file_path?: string;
  mime_type?: string;
  content_text?: string;
}): Attachment {
  const database = getDatabase();
  const id = uuidv4();
  const now = new Date().toISOString();
  database.run(
    "INSERT INTO attachments (id, session_id, type, filename, file_path, mime_type, content_text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [
      id,
      params.session_id,
      params.type,
      params.filename ?? null,
      params.file_path ?? null,
      params.mime_type ?? null,
      params.content_text ?? null,
      now,
    ],
  );
  return {
    id,
    session_id: params.session_id,
    type: params.type,
    filename: params.filename ?? null,
    file_path: params.file_path ?? null,
    mime_type: params.mime_type ?? null,
    content_text: params.content_text ?? null,
    created_at: now,
  };
}

export function getAttachmentsBySession(sessionId: string): Attachment[] {
  const database = getDatabase();
  const result = database.exec(
    `SELECT ${ATTACHMENT_COLS.join(", ")} FROM attachments WHERE session_id = ? ORDER BY created_at`,
    [sessionId],
  );
  return mapRows<Attachment>(result, ATTACHMENT_COLS);
}

const ACTION_COLS = [
  "id",
  "session_id",
  "text",
  "assignee",
  "status",
  "created_at",
];

export function createActionItem(params: {
  session_id: string;
  text: string;
  assignee?: string;
}): ActionItem {
  const database = getDatabase();
  const id = uuidv4();
  const now = new Date().toISOString();
  database.run(
    "INSERT INTO action_items (id, session_id, text, assignee, status, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    [id, params.session_id, params.text, params.assignee ?? null, "open", now],
  );
  return {
    id,
    session_id: params.session_id,
    text: params.text,
    assignee: params.assignee ?? null,
    status: "open",
    created_at: now,
  };
}

export function getActionItemsBySession(sessionId: string): ActionItem[] {
  const database = getDatabase();
  const result = database.exec(
    `SELECT ${ACTION_COLS.join(", ")} FROM action_items WHERE session_id = ? ORDER BY created_at`,
    [sessionId],
  );
  return mapRows<ActionItem>(result, ACTION_COLS);
}

const ALLOWED_ACTION_ITEM_UPDATE_COLS = new Set(["status", "text", "assignee"]);

export function updateActionItem(
  id: string,
  updates: Partial<Pick<ActionItem, "status" | "text" | "assignee">>,
): void {
  const database = getDatabase();
  const setClauses: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(updates)) {
    if (!ALLOWED_ACTION_ITEM_UPDATE_COLS.has(key)) {
      throw new Error(`Invalid column for action item update: ${key}`);
    }
    setClauses.push(`${key} = ?`);
    values.push(value);
  }
  if (setClauses.length === 0) return;
  values.push(id);
  database.run(
    `UPDATE action_items SET ${setClauses.join(", ")} WHERE id = ?`,
    values,
  );
}

const TP_COLS = [
  "id",
  "session_id",
  "topic",
  "first_mentioned_ms",
  "created_at",
];

export function createTalkingPoint(params: {
  session_id: string;
  topic: string;
  first_mentioned_ms: number;
}): TalkingPoint {
  const database = getDatabase();
  const id = uuidv4();
  const now = new Date().toISOString();
  database.run(
    "INSERT INTO talking_points (id, session_id, topic, first_mentioned_ms, created_at) VALUES (?, ?, ?, ?, ?)",
    [id, params.session_id, params.topic, params.first_mentioned_ms, now],
  );
  return {
    id,
    session_id: params.session_id,
    topic: params.topic,
    first_mentioned_ms: params.first_mentioned_ms,
    created_at: now,
  };
}

export function getTalkingPointsBySession(sessionId: string): TalkingPoint[] {
  const database = getDatabase();
  const result = database.exec(
    `SELECT ${TP_COLS.join(", ")} FROM talking_points WHERE session_id = ? ORDER BY first_mentioned_ms`,
    [sessionId],
  );
  return mapRows<TalkingPoint>(result, TP_COLS);
}

const MT_COLS = [
  "id",
  "name",
  "description",
  "prompt_template",
  "icon",
  "is_default",
  "created_at",
];

export function getMeetingTypes(): MeetingType[] {
  const database = getDatabase();
  const result = database.exec(
    `SELECT ${MT_COLS.join(", ")} FROM meeting_types ORDER BY is_default DESC, name`,
  );
  return mapRows<MeetingType>(result, MT_COLS);
}

export function createMeetingType(params: {
  name: string;
  description?: string;
  prompt_template?: string;
  icon?: string;
}): MeetingType {
  const database = getDatabase();
  const id = uuidv4();
  const now = new Date().toISOString();
  database.run(
    "INSERT INTO meeting_types (id, name, description, prompt_template, icon, is_default, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)",
    [
      id,
      params.name,
      params.description ?? null,
      params.prompt_template ?? null,
      params.icon ?? null,
      now,
    ],
  );
  return {
    id,
    name: params.name,
    description: params.description ?? null,
    prompt_template: params.prompt_template ?? null,
    icon: params.icon ?? null,
    is_default: 0,
    created_at: now,
  };
}

export function getSetting(key: string): string | null {
  const database = getDatabase();
  const result = database.exec(
    "SELECT key, value, encrypted FROM settings WHERE key = ?",
    [key],
  );
  if (result.length === 0 || result[0].values.length === 0) return null;

  const row = result[0].values[0];
  const value = row[1] as string;
  const encrypted = row[2] as number;

  if (encrypted && safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(Buffer.from(value, "base64"));
    } catch {
      return value;
    }
  }

  return value;
}

export function setSetting(
  key: string,
  value: string,
  encrypt: boolean = false,
): void {
  const database = getDatabase();
  let storedValue = value;
  let isEncrypted = 0;

  if (encrypt && safeStorage.isEncryptionAvailable()) {
    const encryptedBuf = safeStorage.encryptString(value);
    storedValue = encryptedBuf.toString("base64");
    isEncrypted = 1;
  }

  database.run(
    "INSERT OR REPLACE INTO settings (key, value, encrypted) VALUES (?, ?, ?)",
    [key, storedValue, isEncrypted],
  );
}
