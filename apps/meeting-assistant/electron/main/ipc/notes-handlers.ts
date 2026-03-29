import { createHandler } from "./create-handler";
import { CHANNELS } from "./channels";
import {
  NotesGenerateInput,
  NotesGetForSessionInput,
  NotesUpdateInput,
  NotesListTemplatesInput,
  NotesCategorizeInput,
} from "./validation";

export function registerNotesHandlers(): void {
  createHandler({
    channel: CHANNELS.notes.generate,
    schema: NotesGenerateInput,
    handler: async (_input) => {
      // TODO: wire to NotesService
      return null;
    },
  });

  createHandler({
    channel: CHANNELS.notes.getForSession,
    schema: NotesGetForSessionInput,
    handler: async (_input) => {
      // TODO: wire to NotesService
      return null;
    },
  });

  createHandler({
    channel: CHANNELS.notes.update,
    schema: NotesUpdateInput,
    handler: async (_input) => {
      // TODO: wire to NotesService
      return null;
    },
  });

  createHandler({
    channel: CHANNELS.notes.listTemplates,
    schema: NotesListTemplatesInput,
    handler: async () => {
      // TODO: wire to NotesService
      return [];
    },
  });

  createHandler({
    channel: CHANNELS.notes.categorize,
    schema: NotesCategorizeInput,
    handler: async (_input) => {
      // TODO: wire to NotesService
      return null;
    },
  });

  console.log("[IPC] Notes handlers registered");
}
