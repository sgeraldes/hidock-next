import { describe, it, expect, beforeEach } from "vitest";
import { act } from "@testing-library/react";
import { useTranscriptStore } from "../store/useTranscriptStore";

describe("Summarization store integration", () => {
  beforeEach(() => {
    const state = useTranscriptStore.getState();
    state.clearSession("s1");
    act(() => {
      useTranscriptStore.setState({
        summaries: new Map(),
        summaryLoading: new Map(),
      });
    });
  });

  it("summaries defaults to empty Map", () => {
    const summaries = useTranscriptStore.getState().summaries;
    expect(summaries).toBeInstanceOf(Map);
    expect(summaries.size).toBe(0);
  });

  it("setSummary stores summary text for a session", () => {
    act(() => {
      useTranscriptStore.getState().setSummary("s1", "Meeting summary text.");
    });
    expect(useTranscriptStore.getState().summaries.get("s1")).toBe(
      "Meeting summary text.",
    );
  });

  it("appendSummaryChunk appends text to existing summary", () => {
    act(() => {
      useTranscriptStore.getState().appendSummaryChunk("s1", "Hello ");
    });
    expect(useTranscriptStore.getState().summaries.get("s1")).toBe("Hello ");

    act(() => {
      useTranscriptStore.getState().appendSummaryChunk("s1", "world.");
    });
    expect(useTranscriptStore.getState().summaries.get("s1")).toBe(
      "Hello world.",
    );
  });

  it("setSummaryLoading tracks loading state per session", () => {
    act(() => {
      useTranscriptStore.getState().setSummaryLoading("s1", true);
    });
    expect(useTranscriptStore.getState().summaryLoading.get("s1")).toBe(true);

    act(() => {
      useTranscriptStore.getState().setSummaryLoading("s1", false);
    });
    expect(useTranscriptStore.getState().summaryLoading.get("s1")).toBe(false);
  });

  it("clearSession also clears summary and loading state", () => {
    act(() => {
      useTranscriptStore.getState().setSummary("s1", "Some text");
      useTranscriptStore.getState().setSummaryLoading("s1", true);
    });
    act(() => {
      useTranscriptStore.getState().clearSession("s1");
    });
    expect(useTranscriptStore.getState().summaries.get("s1")).toBeUndefined();
    expect(
      useTranscriptStore.getState().summaryLoading.get("s1"),
    ).toBeUndefined();
  });
});
