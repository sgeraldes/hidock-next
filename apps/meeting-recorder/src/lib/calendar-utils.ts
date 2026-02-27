export const HOUR_HEIGHT = 60;
export const START_HOUR = 6;
export const END_HOUR = 22;

export type CalendarViewType = "day" | "workweek" | "week" | "month";

export function formatHourLabel(hour: number): string {
  if (hour === 0 || hour === 12) {
    return hour === 0 ? "12 AM" : "12 PM";
  }
  return hour < 12 ? `${hour} AM` : `${hour - 12} PM`;
}

export function getHoursRange(): number[] {
  const hours: number[] = [];
  for (let h = START_HOUR; h <= END_HOUR; h++) {
    hours.push(h);
  }
  return hours;
}

export function getWeekDates(date: Date): Date[] {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.setDate(diff));

  const dates: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const dd = new Date(monday);
    dd.setDate(monday.getDate() + i);
    dates.push(dd);
  }
  return dates;
}

export function getWorkWeekDates(date: Date): Date[] {
  return getWeekDates(date).slice(0, 5);
}

export function getMonthDates(date: Date): Date[] {
  const year = date.getFullYear();
  const month = date.getMonth();

  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);

  const startDow = firstDay.getDay();
  const daysBeforeFirst = startDow === 0 ? 6 : startDow - 1;
  const gridStart = new Date(firstDay);
  gridStart.setDate(gridStart.getDate() - daysBeforeFirst);

  const endDow = lastDay.getDay();
  const daysAfterLast = endDow === 0 ? 0 : 7 - endDow;
  const gridEnd = new Date(lastDay);
  gridEnd.setDate(gridEnd.getDate() + daysAfterLast);

  const dates: Date[] = [];
  const current = new Date(gridStart);
  while (current <= gridEnd) {
    dates.push(new Date(current));
    current.setDate(current.getDate() + 1);
  }

  return dates;
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function formatDayHeader(date: Date): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return `${days[date.getDay()]} ${date.getDate()}`;
}

export function getSessionTop(startedAt: string): number {
  const d = new Date(startedAt);
  const hours = d.getHours() + d.getMinutes() / 60;
  return (hours - START_HOUR) * HOUR_HEIGHT;
}

export function getSessionHeight(
  startedAt: string,
  endedAt: string | null,
): number {
  const start = new Date(startedAt);
  const end = endedAt ? new Date(endedAt) : new Date();
  const durationHours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
  return Math.max(durationHours * HOUR_HEIGHT, 20);
}
