import "@testing-library/jest-dom";
import { vi } from "vitest";

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
  };
})();

Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
  writable: true,
});

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

window.HTMLElement.prototype.scrollIntoView = vi.fn();

Object.defineProperty(window, "electronAPI", {
  value: {
    app: {
      info: vi.fn().mockResolvedValue({ version: "0.1.0", platform: "linux" }),
    },
    session: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: "test-session" }),
      end: vi.fn().mockResolvedValue(undefined),
      onCreated: vi.fn().mockReturnValue(() => {}),
      onStatusChanged: vi.fn().mockReturnValue(() => {}),
    },
    settings: {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      getAll: vi.fn().mockResolvedValue({}),
    },
    audio: {
      onMicStatus: vi.fn().mockReturnValue(() => {}),
      onChunk: vi.fn().mockReturnValue(() => {}),
    },
    transcription: {
      onNewSegments: vi.fn().mockReturnValue(() => {}),
      onError: vi.fn().mockReturnValue(() => {}),
    },
    summarization: {
      generate: vi.fn().mockResolvedValue(undefined),
      onChunk: vi.fn().mockReturnValue(() => {}),
    },
  },
  writable: true,
});
