import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SessionList } from "../components/SessionList";
import { useSessionStore } from "../store/useSessionStore";

vi.mock("../store/useSessionStore", () => ({
  useSessionStore: vi.fn(),
}));

const mockSwitchView = vi.fn();

function setupStore(sessions: Array<{ id: string; status: string; started_at: string; title?: string | null }>, viewingId: string | null = null) {
  const sessionMap = new Map(sessions.map((s) => [s.id, s]));
  (useSessionStore as unknown as ReturnType<typeof vi.fn>).mockImplementation((selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      sessions: sessionMap,
      viewingSessionId: viewingId,
      switchView: mockSwitchView,
    }),
  );
}

describe("SessionList", () => {
  beforeEach(() => {
    mockSwitchView.mockClear();
  });

  it("shows empty state when no sessions", () => {
    setupStore([]);
    render(<SessionList />);
    expect(screen.getByText(/no sessions yet/i)).toBeInTheDocument();
  });

  it("renders session items from the store", () => {
    setupStore([
      { id: "abc12345", status: "active", started_at: "2026-01-01T10:00:00Z" },
    ]);
    render(<SessionList />);
    expect(screen.getByText("abc12345")).toBeInTheDocument();
  });

  it("uses title when available", () => {
    setupStore([
      { id: "abc12345", status: "active", started_at: "2026-01-01T10:00:00Z", title: "My Meeting" },
    ]);
    render(<SessionList />);
    expect(screen.getByText("My Meeting")).toBeInTheDocument();
  });

  it("calls switchView when a session is clicked", async () => {
    setupStore([
      { id: "abc12345", status: "inactive", started_at: "2026-01-01T10:00:00Z" },
    ]);
    render(<SessionList />);
    await userEvent.click(screen.getByText("abc12345"));
    expect(mockSwitchView).toHaveBeenCalledWith("abc12345");
  });

  it("highlights the currently viewed session", () => {
    setupStore(
      [{ id: "abc12345", status: "active", started_at: "2026-01-01T10:00:00Z" }],
      "abc12345",
    );
    render(<SessionList />);
    const button = screen.getByRole("button");
    expect(button.className).toContain("bg-accent");
  });
});
