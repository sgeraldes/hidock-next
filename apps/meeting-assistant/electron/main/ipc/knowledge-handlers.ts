import { createHandler } from "./create-handler";
import { CHANNELS } from "./channels";
import {
  KnowledgeAddSourceInput,
  KnowledgeRemoveSourceInput,
  KnowledgeSearchInput,
  KnowledgeReindexInput,
  KnowledgeListSourcesInput,
} from "./validation";
import {
  addKbSource,
  getAllKbSources,
  removeKbSource,
} from "../services/database-queries";
import { saveDatabase } from "../services/database";

// ── Service interface ─────────────────────────────────────────────────────────

interface KnowledgeBaseService {
  addSource(path: string): Promise<void>;
  removeSource(sourcePath: string): Promise<void>;
  search(query: string, topK?: number): Promise<unknown[]>;
  reindex(): Promise<void>;
}

let _service: KnowledgeBaseService | null = null;

/** Wire up the KnowledgeBaseService after it is instantiated in main. */
export function setKnowledgeBaseService(service: KnowledgeBaseService): void {
  _service = service;
}

// ── Handlers ──────────────────────────────────────────────────────────────────

export function registerKnowledgeHandlers(): void {
  createHandler({
    channel: CHANNELS.knowledge.addSource,
    schema: KnowledgeAddSourceInput,
    handler: async (input) => {
      if (!_service) return null;
      await _service.addSource(input.path);
      addKbSource(input.path);
      saveDatabase();
      return null;
    },
  });

  createHandler({
    channel: CHANNELS.knowledge.removeSource,
    schema: KnowledgeRemoveSourceInput,
    handler: async (input) => {
      if (!_service) return null;
      await _service.removeSource(input.sourcePath);
      removeKbSource(input.sourcePath);
      saveDatabase();
      return null;
    },
  });

  createHandler({
    channel: CHANNELS.knowledge.listSources,
    schema: KnowledgeListSourcesInput,
    handler: async () => {
      return getAllKbSources();
    },
  });

  createHandler({
    channel: CHANNELS.knowledge.search,
    schema: KnowledgeSearchInput,
    handler: async (input) => {
      if (!_service) return [];
      return _service.search(input.query, input.topK);
    },
  });

  createHandler({
    channel: CHANNELS.knowledge.reindex,
    schema: KnowledgeReindexInput,
    handler: async () => {
      if (!_service) return null;
      await _service.reindex();
      return null;
    },
  });

  console.log("[IPC] Knowledge base handlers registered");
}
