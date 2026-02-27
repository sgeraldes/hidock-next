import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useSessionStore } from "../store/useSessionStore";
import { useTranscriptStore } from "../store/useTranscriptStore";

describe("Error and loading states", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    act(() => {
      useSessionStore.setState({
        loading: false,
        error: null,
        sessions: new Map(),
        activeSessionId: null,
        viewingSessionId: null,
        micActive: false,
      });
      useTranscriptStore.setState({
        transcriptionError: null,
      });
    });
  });

  describe("Session store loading/error", () => {
    it("loading defaults to false", () => {
      expect(useSessionStore.getState().loading).toBe(false);
    });

    it("error defaults to null", () => {
      expect(useSessionStore.getState().error).toBe(null);
    });

    it("setLoading sets loading state", () => {
      act(() => {
        useSessionStore.getState().setLoading(true);
      });
      expect(useSessionStore.getState().loading).toBe(true);
    });

    it("setError sets error message", () => {
      act(() => {
        useSessionStore.getState().setError("Session load failed");
      });
      expect(useSessionStore.getState().error).toBe("Session load failed");
    });

    it("setError(null) clears error", () => {
      act(() => {
        useSessionStore.getState().setError("Some error");
        useSessionStore.getState().setError(null);
      });
      expect(useSessionStore.getState().error).toBe(null);
    });
  });

  describe("Transcript store error", () => {
    it("transcriptionError defaults to null", () => {
      expect(useTranscriptStore.getState().transcriptionError).toBe(null);
    });

    it("setTranscriptionError stores error text", () => {
      act(() => {
        useTranscriptStore.getState().setTranscriptionError("API rate limited");
      });
      expect(useTranscriptStore.getState().transcriptionError).toBe(
        "API rate limited",
      );
    });

    it("setTranscriptionError(null) clears the error", () => {
      act(() => {
        useTranscriptStore
          .getState()
          .setTranscriptionError("Some transcription error");
        useTranscriptStore.getState().setTranscriptionError(null);
      });
      expect(useTranscriptStore.getState().transcriptionError).toBe(null);
    });
  });

  describe("TranscriptPanel configure link", () => {
    it("renders a link to /settings when provider not configured", async () => {
      const { TranscriptPanel } = await import(
        "../components/TranscriptPanel"
      );
      render(
        <MemoryRouter>
          <TranscriptPanel segments={[]} providerConfigured={false} />
        </MemoryRouter>,
      );
      const link = screen.getByRole("link", { name: /settings/i });
      expect(link).toBeInTheDocument();
      expect(link.getAttribute("href")).toBe("/settings");
    });
  });
});
