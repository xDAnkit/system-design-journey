// Events -> per-day counters. Pure (no I/O), so pnpm check can test it. The analytics worker writes the result.
import { PINCODES } from "../locations/locations.service.js";
import { istDay, istHour } from "../shared/date-range.js";
import { LATENCY_BUCKETS_MS, type SearchEventDoc, type StatsKind } from "./analytics.models.js";
import type { AnalyticsEvent } from "./analytics.types.js";

export interface ProductMeta {
  name: string;
  brand: string;
  category: string;
}

interface Counter {
  kind: StatsKind;
  day: string;
  key: string;
  set: Record<string, unknown>;
  inc: Record<string, number>;
}

export interface Rollup {
  counters: Counter[];
  raw: SearchEventDoc[];
  /** unique visitors: "YYYY-MM-DD" and "YYYY-MM-DD|City" -> session ids */
  visitors: Map<string, Set<string>>;
  /** events per minute (epoch minute) in the last 2 hours, for the live ticker */
  live: Map<number, number>;
  /** vector-only matches seen in searches: AI suggested tag candidates */
  seenPairs: Map<string, { q: string; qDisplay: string; productId: string; searches: number; lastSeen: Date }>;
  /** clicks / ADDs on a (query, product) pair */
  clickedPairs: Map<string, { q: string; productId: string; clicks: number; adds: number; sessions: Set<string> }>;
  /** every searched query once: for the searched-queries collection */
  queries: Map<string, { q: string; script: string; count: number; lastSeen: number }>;
}

const IMPRESSIONS_PER_SEARCH = 10;
const LIVE_WINDOW_MS = 2 * 3600_000;

const bucketOf = (ms: number): number => LATENCY_BUCKETS_MS.findIndex((limit) => ms <= limit);

export function buildRollup(events: AnalyticsEvent[], meta: Map<string, ProductMeta>, nowMs: number): Rollup {
  const counters = new Map<string, Counter>();
  const r: Rollup = { counters: [], raw: [], visitors: new Map(), live: new Map(), seenPairs: new Map(), clickedPairs: new Map(), queries: new Map() };

  const bump = (kind: StatsKind, day: string, key: string, set: Record<string, unknown>, inc: Record<string, number>): void => {
    const id = `${kind}|${day}|${key}`;
    let c = counters.get(id);
    if (!c) {
      c = { kind, day, key, set: {}, inc: {} };
      counters.set(id, c);
    }
    Object.assign(c.set, set);
    for (const [field, n] of Object.entries(inc)) if (n) c.inc[field] = (c.inc[field] ?? 0) + n;
  };
  const visit = (key: string, session: string): void => {
    let s = r.visitors.get(key);
    if (!s) r.visitors.set(key, (s = new Set()));
    s.add(session);
  };

  for (const e of events) {
    const ms = Date.parse(e.ts);
    if (Number.isNaN(ms)) continue;
    const day = istDay(ms);
    const hour = String(istHour(ms));
    const city = e.city;
    const pin = e.pincode ? PINCODES.get(e.pincode) : undefined;
    const pinSet = pin ? { pincode: pin.pin, city: pin.city, area: pin.area, lat: pin.lat, lng: pin.lng } : {};

    visit(day, e.sessionId);
    if (city) visit(`${day}|${city}`, e.sessionId);
    if (nowMs - ms <= LIVE_WINDOW_MS && ms <= nowMs) {
      const minute = Math.floor(ms / 60_000);
      r.live.set(minute, (r.live.get(minute) ?? 0) + (e.type === "search" ? 1 : 0));
    }

    if (e.type === "search") {
      const zero = e.results === 0 ? 1 : 0;
      const oos = e.outOfStock ? 1 : 0;
      bump("total", day, "all", {}, { searches: 1, zero, latencySum: e.latencyMs, latencyCount: 1, outOfStock: oos, [`hours.${hour}`]: 1, [`latency.${bucketOf(e.latencyMs)}`]: 1 });
      bump("query", day, e.qNorm, { q: e.qNorm, qDisplay: e.q, script: e.script }, { searches: 1, zero, resultsSum: e.results, outOfStock: oos });
      if (city) {
        bump("city", day, city, { city }, { searches: 1, zero, outOfStock: oos, [`hours.${hour}`]: 1 });
        bump("query_city", day, `${e.qNorm}|${city}`, { q: e.qNorm, qDisplay: e.q, script: e.script, city }, { searches: 1, zero, outOfStock: oos });
      }
      if (pin) bump("pincode", day, pin.pin, pinSet, { searches: 1, zero });
      if (e.storeId) bump("store", day, e.storeId, { storeId: e.storeId, city }, { searches: 1, zero, outOfStock: oos });
      for (const id of e.shown.slice(0, IMPRESSIONS_PER_SEARCH)) {
        bump("product", day, id, { productId: id, ...(meta.get(id) ?? {}) }, { impressions: 1 });
        if (city) bump("product_city", day, `${id}|${city}`, { productId: id, city, ...(meta.get(id) ?? {}) }, { impressions: 1 });
      }
      for (const id of e.vectorOnly) {
        const k = `${e.qNorm}|${id}`;
        const p = r.seenPairs.get(k) ?? { q: e.qNorm, qDisplay: e.q, productId: id, searches: 0, lastSeen: new Date(ms) };
        p.searches += 1;
        if (ms > p.lastSeen.getTime()) p.lastSeen = new Date(ms);
        r.seenPairs.set(k, p);
      }
      const q = r.queries.get(e.qNorm) ?? { q: e.q, script: e.script, count: 0, lastSeen: 0 };
      q.count += 1;
      q.lastSeen = Math.max(q.lastSeen, ms);
      r.queries.set(e.qNorm, q);
      r.raw.push({ ts: new Date(ms), meta: { type: "search", city }, sessionId: e.sessionId, q: e.q, qNorm: e.qNorm, script: e.script, results: e.results, latencyMs: e.latencyMs, pincode: e.pincode, storeId: e.storeId, outOfStock: e.outOfStock, vectorOnly: e.vectorOnly.length });
    } else if (e.type === "click" || e.type === "add") {
      const isClick = e.type === "click" ? 1 : 0;
      const counts = { clicks: isClick, adds: 1 - isClick };
      const product = { productId: e.productId, ...(meta.get(e.productId) ?? {}) };
      bump("total", day, "all", {}, counts);
      bump("product", day, e.productId, product, { ...counts, positionSum: isClick ? e.position : 0 });
      if (e.qNorm) {
        bump("query", day, e.qNorm, { q: e.qNorm, qDisplay: e.q }, counts);
        bump("query_product", day, `${e.qNorm}|${e.productId}`, { q: e.qNorm, qDisplay: e.q, ...product }, counts);
        const k = `${e.qNorm}|${e.productId}`;
        const p = r.clickedPairs.get(k) ?? { q: e.qNorm, productId: e.productId, clicks: 0, adds: 0, sessions: new Set<string>() };
        p.clicks += counts.clicks;
        p.adds += counts.adds;
        p.sessions.add(e.sessionId);
        r.clickedPairs.set(k, p);
      }
      if (city) {
        bump("city", day, city, { city }, counts);
        bump("product_city", day, `${e.productId}|${city}`, { ...product, city }, counts);
        if (e.qNorm) bump("query_city", day, `${e.qNorm}|${city}`, { q: e.qNorm, qDisplay: e.q, city }, counts);
      }
      if (pin) bump("pincode", day, pin.pin, pinSet, counts);
      if (e.storeId) bump("store", day, e.storeId, { storeId: e.storeId, city }, counts);
      r.raw.push({ ts: new Date(ms), meta: { type: e.type, city }, sessionId: e.sessionId, q: e.q, qNorm: e.qNorm, productId: e.productId, position: e.position, pincode: e.pincode, storeId: e.storeId });
    } else {
      bump("total", day, "all", {}, { unserviceable: 1 });
      if (city) bump("city", day, city, { city }, { unserviceable: 1 });
      if (pin) bump("pincode", day, pin.pin, pinSet, { unserviceable: 1 });
      r.raw.push({ ts: new Date(ms), meta: { type: "unserviceable", city }, sessionId: e.sessionId, q: e.q, qNorm: e.qNorm, pincode: e.pincode });
    }
  }

  r.counters = [...counters.values()];
  return r;
}

/** Counters -> Mongo bulkWrite upserts ($inc counters, $set the descriptive fields). */
export const toBulkOps = (counters: Counter[]) =>
  counters.map((c) => ({
    updateOne: {
      filter: { kind: c.kind, day: c.day, key: c.key },
      update: { $inc: c.inc, ...(Object.keys(c.set).length ? { $set: c.set } : {}) },
      upsert: true,
    },
  }));
