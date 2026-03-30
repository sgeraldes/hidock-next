import { createHandler } from "./create-handler";
import { CHANNELS } from "./channels";
import { broadcastToAllWindows } from "./broadcast";
import {
  NotesGenerateInput,
  NotesGetForSessionInput,
  NotesUpdateInput,
  NotesListTemplatesInput,
  NotesCategorizeInput,
} from "./validation";
import type { CategorizeResult } from "../services/notes-generator";
import {
  getNotesBySession,
  updateNote,
  getAllNoteTemplates,
  getNote,
  getSession,
} from "../services/database-queries";
import { saveDatabase } from "../services/database";

// ── Service interface ─────────────────────────────────────────────────────────

interface NotesService {
  generate(sessionId: string, templateId?: string): Promise<string>;
  categorize(sessionId: string): Promise<CategorizeResult>;
}

let _service: NotesService | null = null;

/** Wire up the NotesGenerator after it is instantiated in main. */
export function setNotesService(service: NotesService): void {
  _service = service;
}

// ── Handlers ──────────────────────────────────────────────────────────────────

export function registerNotesHandlers(): void {
  createHandler({
    channel: CHANNELS.notes.generate,
    schema: NotesGenerateInput,
    handler: async (input) => {
      if (!_service) return null;

      // Forward progress events to renderer while generating
      const onProgress = (data: { stage: string; progress: number }): void => {
        broadcastToAllWindows(CHANNELS.notes.onGenerationProgress, {
          sessionId: input.sessionId,
          ...data,
        });
      };

      // Access the underlying EventEmitter if available
      const emitter = _service as unknown as { on?: (event: string, fn: (data: unknown) => void) => void; off?: (event: string, fn: (data: unknown) => void) => void };
      emitter.on?.('progress', onProgress as (data: unknown) => void);

      try {
        const content = await _service.generate(input.sessionId, input.templateId);
        return { content };
      } finally {
        emitter.off?.('progress', onProgress as (data: unknown) => void);
      }
    },
  });

  createHandler({
    channel: CHANNELS.notes.getForSession,
    schema: NotesGetForSessionInput,
    handler: async (input) => {
      return getNotesBySession(input.sessionId);
    },
  });

  createHandler({
    channel: CHANNELS.notes.update,
    schema: NotesUpdateInput,
    handler: async (input) => {
      const note = getNote(input.notesId);
      if (!note) return null;
      updateNote(input.notesId, input.content);
      saveDatabase();
      return { id: input.notesId, content: input.content };
    },
  });

  createHandler({
    channel: CHANNELS.notes.listTemplates,
    schema: NotesListTemplatesInput,
    handler: async () => {
      return getAllNoteTemplates();
    },
  });

  createHandler({
    channel: CHANNELS.notes.categorize,
    schema: NotesCategorizeInput,
    handler: async (input) => {
      if (!_service) return null;

      // NotesCategorizeInput has notesId — resolve it to a sessionId
      const note = getNote(input.notesId);
      if (note) {
        return _service.categorize(note.session_id);
      }

      // Fallback: treat notesId as a sessionId if no note record found
      const session = getSession(input.notesId);
      if (session) {
        return _service.categorize(input.notesId);
      }

      return null;
    },
  });

  console.log("[IPC] Notes handlers registered");
}
