import { httpError } from "./error.js";

// Days are counted in India time: a search at 23:30 IST belongs to that day, not to the next UTC one.
const IST_OFFSET_MS = 330 * 60 * 1000;
const DAY_MS = 86_400_000;
const MAX_DAYS = 366;

export type RangeName = "today" | "yesterday" | "7d" | "30d" | "month" | "custom";

export interface DateRange {
  name: RangeName;
  from: string;
  to: string;
  /** every IST day in the range, "YYYY-MM-DD" */
  days: string[];
  /** the same number of days right before, for "+12% vs previous period" */
  previous: string[];
  /** one day: charts go per hour */
  hourly: boolean;
}

export const istDay = (ms: number): string => new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
export const istHour = (ms: number): number => new Date(ms + IST_OFFSET_MS).getUTCHours();

const addDays = (day: string, n: number): string => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

const span = (from: string, to: string): string[] => {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
};

const isDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

/** ?range=today|yesterday|7d|30d|month or ?range=custom&from=YYYY-MM-DD&to=YYYY-MM-DD */
export function resolveRange(input: { range?: unknown; from?: unknown; to?: unknown }, nowMs = Date.now()): DateRange {
  const today = istDay(nowMs);
  let from = today;
  let to = today;
  let name: RangeName = "today";
  switch (input.range) {
    case "yesterday":
      from = to = addDays(today, -1);
      name = "yesterday";
      break;
    case "7d":
      from = addDays(today, -6);
      name = "7d";
      break;
    case "30d":
      from = addDays(today, -29);
      name = "30d";
      break;
    case "month":
      from = `${today.slice(0, 8)}01`;
      name = "month";
      break;
    case "custom": {
      if (!isDay(input.from) || !isDay(input.to)) throw httpError(400, "custom range needs from and to as YYYY-MM-DD");
      if (input.from > input.to) throw httpError(400, "from must be on or before to");
      if (input.to > today) throw httpError(400, "to cannot be in the future");
      from = input.from;
      to = input.to;
      name = "custom";
      break;
    }
  }
  const days = span(from, to);
  if (days.length > MAX_DAYS) throw httpError(400, `a range can be at most ${MAX_DAYS} days`);
  return { name, from, to, days, previous: span(addDays(from, -days.length), addDays(from, -1)), hourly: days.length === 1 };
}
