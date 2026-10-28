import assert from "node:assert/strict";
import type { AnalyticsEvent } from "./analytics.types.js";
import { buildRollup, toBulkOps } from "./rollup.js";

export function run(): void {
  const now = Date.parse("2026-10-27T12:00:00Z"); // 17:30 IST
  const ts = new Date(now - 60_000).toISOString();
  const events: AnalyticsEvent[] = [
    { type: "search", ts, sessionId: "session-aaaa", q: "Doodh", qNorm: "doodh", script: "Roman", results: 12, latencyMs: 80, shown: ["p1", "p2"], vectorOnly: ["p2"], city: "Bengaluru", pincode: "560034", storeId: "blr-koramangala" },
    { type: "search", ts, sessionId: "session-bbbb", q: "doodh", qNorm: "doodh", script: "Roman", results: 0, latencyMs: 400, shown: [], vectorOnly: [], outOfStock: true, city: "Bengaluru" },
    { type: "click", ts, sessionId: "session-aaaa", q: "Doodh", qNorm: "doodh", productId: "p2", position: 2, city: "Bengaluru" },
    { type: "add", ts, sessionId: "session-aaaa", q: "Doodh", qNorm: "doodh", productId: "p2", position: 2, city: "Bengaluru" },
    { type: "unserviceable", ts, sessionId: "session-cccc", q: "atta", qNorm: "atta", city: "Bengaluru", pincode: "560066" },
  ];
  const r = buildRollup(events, new Map([["p2", { name: "Amul Toned Milk 500 ml", brand: "Amul", category: "milk" }]]), now);
  const get = (kind: string, key: string) => r.counters.find((c) => c.kind === kind && c.key === key);

  const total = get("total", "all")!;
  assert.equal(total.day, "2026-10-27");
  assert.deepEqual(
    [total.inc.searches, total.inc.zero, total.inc.clicks, total.inc.adds, total.inc.unserviceable, total.inc.outOfStock, total.inc["hours.17"], total.inc["latency.1"], total.inc["latency.4"]],
    [2, 1, 1, 1, 1, 1, 2, 1, 1],
  );
  assert.deepEqual([get("query", "doodh")!.inc.searches, get("query", "doodh")!.inc.clicks], [2, 1]);
  assert.equal(get("product", "p2")!.set.name, "Amul Toned Milk 500 ml");
  assert.deepEqual([get("product", "p2")!.inc.impressions, get("product", "p2")!.inc.clicks, get("product", "p2")!.inc.positionSum], [1, 1, 2]);
  assert.equal(get("query_product", "doodh|p2")!.inc.adds, 1);
  assert.equal(get("pincode", "560066")!.inc.unserviceable, 1, "demand where no store delivers");
  assert.equal(get("pincode", "560034")!.set.area, "Koramangala");

  assert.equal(r.visitors.get("2026-10-27")!.size, 3);
  assert.equal(r.visitors.get("2026-10-27|Bengaluru")!.size, 3);
  assert.equal([...r.live.values()].reduce((a, b) => a + b, 0), 2, "live ticker counts searches");
  assert.equal(r.seenPairs.get("doodh|p2")!.searches, 1);
  assert.equal(r.clickedPairs.get("doodh|p2")!.clicks, 1);
  assert.equal(r.queries.get("doodh")!.count, 2);
  assert.equal(r.raw.length, 5);

  const op = toBulkOps([get("query", "doodh")!])[0].updateOne;
  assert.deepEqual(op.filter, { kind: "query", day: "2026-10-27", key: "doodh" });
  assert.equal(op.upsert, true);
}
