import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { CalendarViewType } from "../lib/calendar-utils";

interface HistoryState {
  displayMode: "calendar" | "timeline";
  calendarViewType: CalendarViewType;
  currentDate: string;
  searchQuery: string;

  setDisplayMode: (mode: "calendar" | "timeline") => void;
  setCalendarViewType: (type: CalendarViewType) => void;
  setCurrentDate: (date: Date) => void;
  setSearchQuery: (query: string) => void;
  navigatePrev: () => void;
  navigateNext: () => void;
  navigateToday: () => void;
}

function shiftDate(
  isoDate: string,
  viewType: CalendarViewType,
  delta: number,
): string {
  const d = new Date(isoDate);
  switch (viewType) {
    case "day":
      d.setDate(d.getDate() + delta);
      break;
    case "workweek":
    case "week":
      d.setDate(d.getDate() + delta * 7);
      break;
    case "month":
      d.setMonth(d.getMonth() + delta);
      break;
  }
  return d.toISOString();
}

export const useHistoryStore = create<HistoryState>()(
  persist(
    (set, get) => ({
      displayMode: "calendar",
      calendarViewType: "week",
      currentDate: new Date().toISOString(),
      searchQuery: "",

      setDisplayMode: (mode) => set({ displayMode: mode }),
      setCalendarViewType: (type) => set({ calendarViewType: type }),
      setCurrentDate: (date) => set({ currentDate: date.toISOString() }),
      setSearchQuery: (query) => set({ searchQuery: query }),

      navigatePrev: () => {
        const { currentDate, calendarViewType } = get();
        set({ currentDate: shiftDate(currentDate, calendarViewType, -1) });
      },
      navigateNext: () => {
        const { currentDate, calendarViewType } = get();
        set({ currentDate: shiftDate(currentDate, calendarViewType, 1) });
      },
      navigateToday: () => {
        set({ currentDate: new Date().toISOString() });
      },
    }),
    {
      name: "history-store",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        displayMode: state.displayMode,
        calendarViewType: state.calendarViewType,
      }),
    },
  ),
);
