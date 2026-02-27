import { describe, it, expect, beforeEach } from "vitest";
import { useHistoryStore } from "../store/useHistoryStore";

function parseISO(iso: string) {
  return new Date(iso);
}

describe("useHistoryStore", () => {
  beforeEach(() => {
    useHistoryStore.setState({
      displayMode: "calendar",
      calendarViewType: "week",
      currentDate: new Date("2026-02-12T00:00:00.000Z").toISOString(),
      searchQuery: "",
    });
  });

  it("starts with default displayMode=calendar and calendarViewType=week", () => {
    const state = useHistoryStore.getState();
    expect(state.displayMode).toBe("calendar");
    expect(state.calendarViewType).toBe("week");
  });

  describe("setDisplayMode", () => {
    it("switches to timeline", () => {
      useHistoryStore.getState().setDisplayMode("timeline");
      expect(useHistoryStore.getState().displayMode).toBe("timeline");
    });
  });

  describe("setCalendarViewType", () => {
    it("switches view type", () => {
      useHistoryStore.getState().setCalendarViewType("month");
      expect(useHistoryStore.getState().calendarViewType).toBe("month");
    });
  });

  describe("setSearchQuery", () => {
    it("updates search query", () => {
      useHistoryStore.getState().setSearchQuery("standup");
      expect(useHistoryStore.getState().searchQuery).toBe("standup");
    });
  });

  describe("navigatePrev / navigateNext", () => {
    it("navigatePrev moves back one week for week view", () => {
      useHistoryStore.getState().setCalendarViewType("week");
      const before = parseISO(useHistoryStore.getState().currentDate);

      useHistoryStore.getState().navigatePrev();

      const after = parseISO(useHistoryStore.getState().currentDate);
      const diffDays = (before.getTime() - after.getTime()) / (1000 * 60 * 60 * 24);
      expect(diffDays).toBeCloseTo(7, 0);
    });

    it("navigateNext moves forward one week for week view", () => {
      useHistoryStore.getState().setCalendarViewType("week");
      const before = parseISO(useHistoryStore.getState().currentDate);

      useHistoryStore.getState().navigateNext();

      const after = parseISO(useHistoryStore.getState().currentDate);
      const diffDays = (after.getTime() - before.getTime()) / (1000 * 60 * 60 * 24);
      expect(diffDays).toBeCloseTo(7, 0);
    });

    it("navigatePrev moves back one day for day view", () => {
      useHistoryStore.getState().setCalendarViewType("day");
      const before = parseISO(useHistoryStore.getState().currentDate);

      useHistoryStore.getState().navigatePrev();

      const after = parseISO(useHistoryStore.getState().currentDate);
      const diffDays = (before.getTime() - after.getTime()) / (1000 * 60 * 60 * 24);
      expect(diffDays).toBeCloseTo(1, 0);
    });

    it("navigateNext moves forward one day for day view", () => {
      useHistoryStore.getState().setCalendarViewType("day");
      const before = parseISO(useHistoryStore.getState().currentDate);

      useHistoryStore.getState().navigateNext();

      const after = parseISO(useHistoryStore.getState().currentDate);
      const diffDays = (after.getTime() - before.getTime()) / (1000 * 60 * 60 * 24);
      expect(diffDays).toBeCloseTo(1, 0);
    });

    it("navigatePrev moves back one week for workweek view", () => {
      useHistoryStore.getState().setCalendarViewType("workweek");
      const before = parseISO(useHistoryStore.getState().currentDate);

      useHistoryStore.getState().navigatePrev();

      const after = parseISO(useHistoryStore.getState().currentDate);
      const diffDays = (before.getTime() - after.getTime()) / (1000 * 60 * 60 * 24);
      expect(diffDays).toBeCloseTo(7, 0);
    });

    it("navigatePrev moves back one month for month view", () => {
      useHistoryStore.getState().setCalendarViewType("month");
      useHistoryStore.getState().setCurrentDate(new Date("2026-02-15T00:00:00.000Z"));
      const before = parseISO(useHistoryStore.getState().currentDate);

      useHistoryStore.getState().navigatePrev();

      const after = parseISO(useHistoryStore.getState().currentDate);
      expect(after.getMonth()).toBe(before.getMonth() - 1);
    });

    it("navigateNext moves forward one month for month view", () => {
      useHistoryStore.getState().setCalendarViewType("month");
      useHistoryStore.getState().setCurrentDate(new Date("2026-02-15T00:00:00.000Z"));
      const before = parseISO(useHistoryStore.getState().currentDate);

      useHistoryStore.getState().navigateNext();

      const after = parseISO(useHistoryStore.getState().currentDate);
      expect(after.getMonth()).toBe(before.getMonth() + 1);
    });
  });

  describe("navigateToday", () => {
    it("resets currentDate to approximately now", () => {
      useHistoryStore.getState().setCurrentDate(new Date("2020-06-15T12:00:00.000Z"));
      expect(parseISO(useHistoryStore.getState().currentDate).getFullYear()).toBe(2020);

      useHistoryStore.getState().navigateToday();

      const now = new Date();
      const result = parseISO(useHistoryStore.getState().currentDate);
      expect(Math.abs(result.getTime() - now.getTime())).toBeLessThan(5000);
    });
  });

  describe("setCurrentDate", () => {
    it("sets the currentDate from a Date object", () => {
      const d = new Date("2026-03-01T12:00:00.000Z");
      useHistoryStore.getState().setCurrentDate(d);
      expect(useHistoryStore.getState().currentDate).toBe(d.toISOString());
    });
  });
});
