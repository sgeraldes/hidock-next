import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import CalendarView from "../components/history/CalendarView";

const testDate = new Date(2026, 1, 24);
const makeLocalISO = (hour: number, min = 0) => {
  const d = new Date(2026, 1, 24, hour, min);
  return d.toISOString();
};

const mockSessions = [
  {
    id: "s1",
    title: "Sprint Planning",
    status: "complete",
    started_at: makeLocalISO(9),
    ended_at: makeLocalISO(10),
    meeting_type_id: null,
    summary: null,
    created_at: makeLocalISO(9),
  },
  {
    id: "s2",
    title: "Design Review",
    status: "complete",
    started_at: makeLocalISO(14),
    ended_at: makeLocalISO(15, 30),
    meeting_type_id: null,
    summary: null,
    created_at: makeLocalISO(14),
  },
];

describe("CalendarView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders time grid with hour labels", () => {
    render(
      <CalendarView
        sessions={mockSessions}
        currentDate={testDate}
        viewType="day"
        onSessionClick={vi.fn()}
      />,
    );

    expect(screen.getByText("9 AM")).toBeTruthy();
    expect(screen.getByText("10 AM")).toBeTruthy();
    expect(screen.getByText("12 PM")).toBeTruthy();
  });

  it("renders session blocks", () => {
    render(
      <CalendarView
        sessions={mockSessions}
        currentDate={testDate}
        viewType="day"
        onSessionClick={vi.fn()}
      />,
    );

    expect(screen.getByText("Sprint Planning")).toBeTruthy();
    expect(screen.getByText("Design Review")).toBeTruthy();
  });

  it("calls onSessionClick when session block clicked", () => {
    const onSessionClick = vi.fn();
    render(
      <CalendarView
        sessions={mockSessions}
        currentDate={testDate}
        viewType="day"
        onSessionClick={onSessionClick}
      />,
    );

    fireEvent.click(screen.getByText("Sprint Planning"));
    expect(onSessionClick).toHaveBeenCalledWith("s1");
  });

  it("shows empty state when no sessions for the date", () => {
    render(
      <CalendarView
        sessions={[]}
        currentDate={testDate}
        viewType="day"
        onSessionClick={vi.fn()}
      />,
    );

    expect(screen.getByText("9 AM")).toBeTruthy();
  });

  it("renders week view with day columns", () => {
    render(
      <CalendarView
        sessions={mockSessions}
        currentDate={testDate}
        viewType="week"
        onSessionClick={vi.fn()}
      />,
    );

    expect(screen.getByText(/Mon/)).toBeTruthy();
    expect(screen.getByText(/Tue/)).toBeTruthy();
  });

  it("renders month view with day-of-week headers", () => {
    render(
      <CalendarView
        sessions={mockSessions}
        currentDate={testDate}
        viewType="month"
        onSessionClick={vi.fn()}
      />,
    );

    expect(screen.getByText("Mon")).toBeTruthy();
    expect(screen.getByText("Tue")).toBeTruthy();
    expect(screen.getByText("Wed")).toBeTruthy();
    expect(screen.getByText("Thu")).toBeTruthy();
    expect(screen.getByText("Fri")).toBeTruthy();
    expect(screen.getByText("Sat")).toBeTruthy();
    expect(screen.getByText("Sun")).toBeTruthy();
  });

  it("renders month view with day numbers", () => {
    render(
      <CalendarView
        sessions={mockSessions}
        currentDate={testDate}
        viewType="month"
        onSessionClick={vi.fn()}
      />,
    );

    expect(screen.getAllByText("1").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("28").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("15")).toBeTruthy();
  });

  it("renders session dots in month view", () => {
    render(
      <CalendarView
        sessions={mockSessions}
        currentDate={testDate}
        viewType="month"
        onSessionClick={vi.fn()}
      />,
    );

    expect(screen.getByText("Sprint Planning")).toBeTruthy();
    expect(screen.getByText("Design Review")).toBeTruthy();
  });

  it("calls onSessionClick for month view session", () => {
    const onSessionClick = vi.fn();
    render(
      <CalendarView
        sessions={mockSessions}
        currentDate={testDate}
        viewType="month"
        onSessionClick={onSessionClick}
      />,
    );

    fireEvent.click(screen.getByText("Sprint Planning"));
    expect(onSessionClick).toHaveBeenCalledWith("s1");
  });
});
