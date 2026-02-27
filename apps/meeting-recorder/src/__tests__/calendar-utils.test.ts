import { describe, it, expect } from "vitest";
import {
  getMonthDates,
  isSameDay,
  getWeekDates,
  formatHourLabel,
  getHoursRange,
  formatDayHeader,
} from "../lib/calendar-utils";

describe("getMonthDates", () => {
  it("returns a grid of 6 weeks (42 dates) covering the month", () => {
    const dates = getMonthDates(new Date(2026, 1, 15));
    expect(dates.length % 7).toBe(0);
    expect(dates.length).toBeGreaterThanOrEqual(28);
  });

  it("starts grid on Monday", () => {
    const dates = getMonthDates(new Date(2026, 1, 15));
    expect(dates[0].getDay()).toBe(1);
  });

  it("ends grid on Sunday", () => {
    const dates = getMonthDates(new Date(2026, 1, 15));
    const lastDate = dates[dates.length - 1];
    expect(lastDate.getDay()).toBe(0);
  });

  it("includes all days of the target month", () => {
    const dates = getMonthDates(new Date(2026, 1, 10));
    const febDays = dates.filter((d) => d.getMonth() === 1 && d.getFullYear() === 2026);
    expect(febDays).toHaveLength(28);
  });

  it("includes leading days from previous month to fill first week", () => {
    const dates = getMonthDates(new Date(2026, 1, 1));
    const janDays = dates.filter((d) => d.getMonth() === 0);
    expect(janDays.length).toBeGreaterThan(0);
  });

  it("includes trailing days from next month to fill last week", () => {
    const dates = getMonthDates(new Date(2026, 1, 28));
    const marDays = dates.filter((d) => d.getMonth() === 2);
    expect(marDays.length).toBeGreaterThan(0);
  });
});

describe("isSameDay", () => {
  it("returns true for same date different times", () => {
    const a = new Date(2026, 1, 24, 9, 0);
    const b = new Date(2026, 1, 24, 17, 30);
    expect(isSameDay(a, b)).toBe(true);
  });

  it("returns false for different dates", () => {
    const a = new Date(2026, 1, 24);
    const b = new Date(2026, 1, 25);
    expect(isSameDay(a, b)).toBe(false);
  });
});

describe("getWeekDates", () => {
  it("returns 7 dates starting from Monday", () => {
    const dates = getWeekDates(new Date(2026, 1, 25));
    expect(dates).toHaveLength(7);
    expect(dates[0].getDay()).toBe(1);
    expect(dates[6].getDay()).toBe(0);
  });
});

describe("formatHourLabel", () => {
  it("formats noon as 12 PM", () => {
    expect(formatHourLabel(12)).toBe("12 PM");
  });

  it("formats midnight as 12 AM", () => {
    expect(formatHourLabel(0)).toBe("12 AM");
  });

  it("formats morning hours", () => {
    expect(formatHourLabel(9)).toBe("9 AM");
  });

  it("formats afternoon hours", () => {
    expect(formatHourLabel(15)).toBe("3 PM");
  });
});

describe("getHoursRange", () => {
  it("returns array of hours from START_HOUR to END_HOUR", () => {
    const hours = getHoursRange();
    expect(hours[0]).toBe(6);
    expect(hours[hours.length - 1]).toBe(22);
  });
});

describe("formatDayHeader", () => {
  it("formats date as day abbreviation and number", () => {
    expect(formatDayHeader(new Date(2026, 1, 25))).toBe("Wed 25");
  });
});
