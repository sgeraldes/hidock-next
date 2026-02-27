import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import TimelineView from "../components/history/TimelineView";

const mockSessions = [
  {
    id: "s1",
    title: "Morning Standup",
    status: "complete",
    started_at: new Date(2026, 1, 24, 9, 0).toISOString(),
    ended_at: new Date(2026, 1, 24, 9, 15).toISOString(),
    meeting_type_id: null,
    summary: null,
    created_at: new Date(2026, 1, 24, 9, 0).toISOString(),
  },
  {
    id: "s2",
    title: "Sprint Review",
    status: "complete",
    started_at: new Date(2026, 1, 24, 14, 0).toISOString(),
    ended_at: new Date(2026, 1, 24, 15, 0).toISOString(),
    meeting_type_id: null,
    summary: null,
    created_at: new Date(2026, 1, 24, 14, 0).toISOString(),
  },
  {
    id: "s3",
    title: "Design Sync",
    status: "complete",
    started_at: new Date(2026, 1, 25, 10, 0).toISOString(),
    ended_at: new Date(2026, 1, 25, 11, 0).toISOString(),
    meeting_type_id: null,
    summary: null,
    created_at: new Date(2026, 1, 25, 10, 0).toISOString(),
  },
];

describe("TimelineView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders sessions grouped by day", () => {
    render(
      <TimelineView sessions={mockSessions} onSessionClick={vi.fn()} />,
    );

    expect(screen.getByText("Morning Standup")).toBeTruthy();
    expect(screen.getByText("Sprint Review")).toBeTruthy();
    expect(screen.getByText("Design Sync")).toBeTruthy();
  });

  it("shows day group headers", () => {
    render(
      <TimelineView sessions={mockSessions} onSessionClick={vi.fn()} />,
    );

    const headers = screen.getAllByRole("heading");
    expect(headers.length).toBeGreaterThanOrEqual(2);
  });

  it("calls onSessionClick when session clicked", () => {
    const onSessionClick = vi.fn();
    render(
      <TimelineView
        sessions={mockSessions}
        onSessionClick={onSessionClick}
      />,
    );

    fireEvent.click(screen.getByText("Morning Standup"));
    expect(onSessionClick).toHaveBeenCalledWith("s1");
  });

  it("shows empty state when no sessions", () => {
    render(
      <TimelineView sessions={[]} onSessionClick={vi.fn()} />,
    );

    expect(screen.getByText(/no sessions/i)).toBeTruthy();
  });

  it("shows session status", () => {
    render(
      <TimelineView sessions={mockSessions} onSessionClick={vi.fn()} />,
    );

    const completeText = screen.getAllByText(/complete/i);
    expect(completeText.length).toBeGreaterThanOrEqual(1);
  });

  it("renders delete buttons for each session", () => {
    render(
      <TimelineView
        sessions={mockSessions}
        onSessionClick={vi.fn()}
        onSessionDelete={vi.fn()}
      />,
    );

    const deleteButtons = screen.getAllByLabelText(/delete/i);
    expect(deleteButtons).toHaveLength(3);
  });

  it("calls onSessionDelete when delete button clicked", () => {
    const onSessionDelete = vi.fn();
    render(
      <TimelineView
        sessions={mockSessions}
        onSessionClick={vi.fn()}
        onSessionDelete={onSessionDelete}
      />,
    );

    const deleteButtons = screen.getAllByLabelText(/delete/i);
    fireEvent.click(deleteButtons[0]);
    expect(onSessionDelete).toHaveBeenCalledWith("s1");
  });
});
