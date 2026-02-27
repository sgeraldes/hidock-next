import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RightPanel } from "../components/RightPanel";
import { useSessionStore } from "../store/useSessionStore";
import { useTranscriptStore } from "../store/useTranscriptStore";

vi.mock("../store/useSessionStore", () => ({
  useSessionStore: vi.fn(),
}));

vi.mock("../store/useTranscriptStore", () => ({
  useTranscriptStore: vi.fn(),
}));

function setupStores(
  viewingId: string | null,
  topics: string[] = [],
  actionItems: Array<{ text: string; assignee?: string }> = [],
  summary: string | null = null,
  summaryLoading = false,
) {
  const topicsMap = new Map([[viewingId ?? "", topics]]);
  const actionItemsMap = new Map([[viewingId ?? "", actionItems]]);
  const summariesMap = new Map<string, string>();
  if (viewingId && summary) summariesMap.set(viewingId, summary);
  const summaryLoadingMap = new Map<string, boolean>();
  if (viewingId) summaryLoadingMap.set(viewingId, summaryLoading);

  const sessionsMap = new Map<string, { id: string; status: string }>();
  if (viewingId) {
    sessionsMap.set(viewingId, { id: viewingId, status: "complete" });
  }
  (useSessionStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (selector: (s: Record<string, unknown>) => unknown) =>
      selector({
        viewingSessionId: viewingId,
        activeSessionId: null,
        sessions: sessionsMap,
      }),
  );
  (useTranscriptStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (selector: (s: Record<string, unknown>) => unknown) =>
      selector({
        topics: topicsMap,
        actionItems: actionItemsMap,
        summaries: summariesMap,
        summaryLoading: summaryLoadingMap,
      }),
  );
}

describe("RightPanel", () => {
  beforeEach(() => {
    setupStores(null);
  });

  it("renders Topics tab by default", () => {
    setupStores(null);
    render(<RightPanel />);
    expect(screen.getByRole("button", { name: /topics/i })).toBeInTheDocument();
    expect(screen.getByText(/no topics detected yet/i)).toBeInTheDocument();
  });

  it("shows topics for the viewing session", () => {
    setupStores("session-1", ["AI Integration", "Budget Review"]);
    render(<RightPanel />);
    expect(screen.getByText("AI Integration")).toBeInTheDocument();
    expect(screen.getByText("Budget Review")).toBeInTheDocument();
  });

  it("switches to Actions tab on click", async () => {
    setupStores("session-1", [], [{ text: "Follow up with team" }]);
    render(<RightPanel />);
    await userEvent.click(screen.getByRole("button", { name: /actions/i }));
    expect(screen.getByText("Follow up with team")).toBeInTheDocument();
  });

  it("shows empty state when no action items", async () => {
    setupStores("session-1");
    render(<RightPanel />);
    await userEvent.click(screen.getByRole("button", { name: /actions/i }));
    expect(screen.getByText(/no action items yet/i)).toBeInTheDocument();
  });

  it("renders Summary tab", () => {
    setupStores("session-1");
    render(<RightPanel />);
    expect(
      screen.getByRole("button", { name: /summary/i }),
    ).toBeInTheDocument();
  });

  it("shows SummaryPanel when Summary tab is clicked", async () => {
    setupStores("session-1");
    render(<RightPanel />);
    await userEvent.click(screen.getByRole("button", { name: /summary/i }));
    expect(
      screen.getByRole("button", { name: /generate summary/i }),
    ).toBeInTheDocument();
  });

  it("shows existing summary text in Summary tab", async () => {
    setupStores("session-1", [], [], "This is the summary.", false);
    render(<RightPanel />);
    await userEvent.click(screen.getByRole("button", { name: /summary/i }));
    expect(screen.getByText("This is the summary.")).toBeInTheDocument();
  });

  it("shows generating state in Summary tab", async () => {
    setupStores("session-1", [], [], null, true);
    render(<RightPanel />);
    await userEvent.click(screen.getByRole("button", { name: /summary/i }));
    expect(screen.getByText(/generating/i)).toBeInTheDocument();
  });
});
