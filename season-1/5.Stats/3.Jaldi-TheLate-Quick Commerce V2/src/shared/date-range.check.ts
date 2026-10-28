import assert from "node:assert/strict";
import { istDay, istHour, resolveRange } from "./date-range.js";

export function run(): void {
  // 2026-10-27 20:00 UTC = 2026-10-28 01:30 IST: already the next day in India
  const now = Date.parse("2026-10-27T20:00:00Z");
  assert.equal(istDay(now), "2026-10-28");
  assert.equal(istHour(now), 1);

  const today = resolveRange({}, now);
  assert.deepEqual([today.name, today.days, today.previous, today.hourly], ["today", ["2026-10-28"], ["2026-10-27"], true]);

  const yesterday = resolveRange({ range: "yesterday" }, now);
  assert.deepEqual(yesterday.days, ["2026-10-27"]);

  const week = resolveRange({ range: "7d" }, now);
  assert.equal(week.days.length, 7);
  assert.equal(week.days[0], "2026-10-22");
  assert.equal(week.previous.at(-1), "2026-10-21");
  assert.equal(week.hourly, false);

  const month = resolveRange({ range: "month" }, now);
  assert.equal(month.from, "2026-10-01");
  assert.equal(month.days.length, 28);

  const custom = resolveRange({ range: "custom", from: "2026-09-30", to: "2026-10-02" }, now);
  assert.deepEqual(custom.days, ["2026-09-30", "2026-10-01", "2026-10-02"]);
  assert.deepEqual(custom.previous, ["2026-09-27", "2026-09-28", "2026-09-29"]);

  assert.throws(() => resolveRange({ range: "custom", from: "2026-10-05", to: "2026-10-01" }, now), /on or before/);
  assert.throws(() => resolveRange({ range: "custom", from: "2026-10-01", to: "2026-12-01" }, now), /future/);
  assert.throws(() => resolveRange({ range: "custom", from: "bad" }, now), /YYYY-MM-DD/);
}
