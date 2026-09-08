import {
  addDays,
  addWeeks,
  format,
  getISOWeek,
  getISOWeekYear,
  parseISO,
  startOfISOWeek,
} from "date-fns";

/** 'YYYY-MM-DD' for a local date. Never toISOString(): it shifts to UTC and can move the day. */
export function toDateKey(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

export function fromDateKey(key: string): Date {
  return parseISO(key);
}

/** ISO week id like '2026-W37'. Used in the URL so a week can be linked to. */
export function weekId(d: Date): string {
  return `${getISOWeekYear(d)}-W${String(getISOWeek(d)).padStart(2, "0")}`;
}

/** Monday of the week that contains the given date. */
export function weekStart(d: Date): Date {
  return startOfISOWeek(d);
}

/** Monday of the week from a '2026-W37' id, or the current week when the id is missing or malformed. */
export function weekStartFromId(id: string | null): Date {
  const m = id?.match(/^(\d{4})-W(\d{2})$/);
  if (!m) return weekStart(new Date());
  const year = Number(m[1]);
  const week = Number(m[2]);
  if (week < 1 || week > 53) return weekStart(new Date());
  // 4 January is always in ISO week 1.
  const jan4 = new Date(year, 0, 4);
  return addWeeks(startOfISOWeek(jan4), week - 1);
}

export function shiftWeek(monday: Date, by: number): Date {
  return addWeeks(monday, by);
}

export interface WeekDay {
  date: Date;
  key: string;
  /** 1 = Monday … 7 = Sunday (ISO). */
  isoDay: number;
  isWeekend: boolean;
  isToday: boolean;
}

export function daysOfWeek(monday: Date): WeekDay[] {
  const todayKey = toDateKey(new Date());
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(monday, i);
    const key = toDateKey(date);
    return {
      date,
      key,
      isoDay: i + 1,
      isWeekend: i >= 5,
      isToday: key === todayKey,
    };
  });
}

export function formatRange(monday: Date): string {
  const sunday = addDays(monday, 6);
  const sameMonth = monday.getMonth() === sunday.getMonth();
  return sameMonth
    ? `${format(monday, "d")}–${format(sunday, "d MMM")}`
    : `${format(monday, "d MMM")} – ${format(sunday, "d MMM")}`;
}

export const dayShort = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function formatHour(h: number): string {
  return `${String(h).padStart(2, "0")}:00`;
}

/** '18:00 - 21:00' */
export function slotLabel(start: number, end: number): string {
  return `${formatHour(start)} - ${formatHour(end)}`;
}

/** Editing is open from the Monday of the current week, and three months ahead. */
export const EDIT_DAYS_AHEAD = 92;

export function isPast(dateKey: string): boolean {
  return dateKey < toDateKey(weekStart(new Date()));
}

export function isTooFarAhead(dateKey: string): boolean {
  return dateKey > toDateKey(addDays(new Date(), EDIT_DAYS_AHEAD));
}

/** Can this day still be changed? */
export function isEditable(dateKey: string): boolean {
  return !isPast(dateKey) && !isTooFarAhead(dateKey);
}

/** A whole week is locked when its last day is behind us, or its first day is too far ahead. */
export function weekLock(monday: Date): "past" | "future" | null {
  const days = daysOfWeek(monday);
  if (isPast(days[6].key)) return "past";
  if (isTooFarAhead(days[0].key)) return "future";
  return null;
}
